import type { getReadClient } from "./client";

type AnyClient = ReturnType<typeof getReadClient>;

export type WaitResult = { status: "SUCCESS" | "ERROR"; message?: string };

type LeaderReceiptLike = { execution_result?: unknown };
type ReceiptLike = {
  statusName?: string;
  txExecutionResultName?: string;
  data?: Record<string, unknown>;
  consensus_data?: { leader_receipt?: LeaderReceiptLike[] };
};

const RECOGNIZED_EXECUTION_RESULTS = new Set(["FINISHED_WITH_RETURN", "FINISHED_WITH_ERROR"]);

/**
 * Waits for GenVM consensus to finalize a transaction, then inspects the
 * *execution* result. A FINALIZED status is not itself success — and a
 * missing/unrecognized execution_result is never treated as success either.
 *
 * The authoritative per-validator field is `consensus_data.leader_receipt[].
 * execution_result` (present on real Studionet receipts even when the SDK's
 * derived `txExecutionResultName` convenience field is absent). We check the
 * leader receipts first and only fall back to `txExecutionResultName` when no
 * leader receipt is present. If neither source yields a recognized value,
 * this fails closed as ERROR rather than defaulting to success.
 */
export async function waitForFinality(client: AnyClient, hash: `0x${string}`): Promise<WaitResult> {
  const receipt = (await client.waitForTransactionReceipt({
    hash: hash as never,
    status: "FINALIZED" as never,
    retries: 60,
    interval: 3000,
  })) as ReceiptLike;

  const statusName = receipt.statusName;
  if (statusName !== "FINALIZED") {
    return { status: "ERROR", message: `consensus did not reach FINALIZED: ${statusName ?? "unknown status"}` };
  }

  const leaderResults = (receipt.consensus_data?.leader_receipt ?? [])
    .map((r) => r.execution_result)
    .filter((r): r is string => typeof r === "string" && r.length > 0);

  const resultsToCheck =
    leaderResults.length > 0
      ? leaderResults
      : typeof receipt.txExecutionResultName === "string" && receipt.txExecutionResultName.length > 0
        ? [receipt.txExecutionResultName]
        : [];

  if (resultsToCheck.length === 0) {
    return {
      status: "ERROR",
      message: "finalized receipt carried no execution_result — cannot confirm the write actually succeeded",
    };
  }

  if (resultsToCheck.some((r) => r === "FINISHED_WITH_ERROR")) {
    const data = receipt.data;
    const message = data && typeof data === "object" ? JSON.stringify(data) : "execution reverted";
    return { status: "ERROR", message };
  }

  if (!resultsToCheck.every((r) => RECOGNIZED_EXECUTION_RESULTS.has(r))) {
    return {
      status: "ERROR",
      message: `finalized receipt carried an unrecognized execution_result: ${JSON.stringify(resultsToCheck)}`,
    };
  }

  return { status: "SUCCESS" };
}
