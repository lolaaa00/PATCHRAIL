import type { getReadClient } from "./client";

type AnyClient = ReturnType<typeof getReadClient>;

export type WaitResult = { status: "SUCCESS" | "ERROR"; message?: string };

type LeaderReceiptLike = { execution_result?: unknown };
export type ReceiptLike = {
  // The real `client.waitForTransactionReceipt` return value is the raw
  // snake_case GenVM transaction shape — confirmed live against three
  // Studionet transactions by printing `Object.keys(receipt)` directly:
  // `status_name` / `result_name`, NOT the camelCase `statusName` /
  // `txExecutionResultName` the SDK's TypeScript types declare (those
  // apparently only appear on a differently-decorated object from a
  // different call, never observed from this method in practice). Both
  // spellings are still accepted below in case a future SDK version or a
  // different client method does return the camelCase shape.
  status_name?: string;
  statusName?: string;
  data?: Record<string, unknown>;
  consensus_data?: { leader_receipt?: LeaderReceiptLike[] };
  // No `txDataDecoded` field was present on any live receipt observed. For a
  // deploy transaction, the new contract's address is `data.contract_address`
  // (also mirrored at the top-level `to_address`/`recipient`).
  to_address?: string;
  recipient?: string;
};

// Confirmed against three live Studionet receipts (one failed deploy, two
// successful ones): `consensus_data.leader_receipt[].execution_result`
// actually carries the raw strings "SUCCESS" / "ERROR" — NOT the SDK's
// declared `ExecutionResult` enum names ("FINISHED_WITH_RETURN" /
// "FINISHED_WITH_ERROR"). Both vocabularies are accepted since only the
// leader-receipt field's real values have been directly observed live.
const SUCCESS_EXECUTION_RESULTS = new Set(["SUCCESS", "FINISHED_WITH_RETURN"]);
const ERROR_EXECUTION_RESULTS = new Set(["ERROR", "FINISHED_WITH_ERROR"]);

/**
 * Fetches the finalized receipt and classifies its execution result. A
 * FINALIZED status is not itself success — and a missing/unrecognized
 * execution_result is never treated as success either.
 *
 * The authoritative per-validator field is `consensus_data.leader_receipt[].
 * execution_result`. If no leader receipt or recognized status is present,
 * this fails closed as ERROR rather than defaulting to success.
 *
 * Exported (not just `waitForFinality`) so any caller that also needs the
 * raw receipt — e.g. `scripts/deploy.ts` extracting a deployed contract
 * address — uses the exact same fail-closed classification rather than a
 * separately maintained, easily-drifted copy of it.
 */
export async function getFinalizedReceipt(
  client: AnyClient,
  hash: `0x${string}`,
): Promise<{ receipt: ReceiptLike; result: WaitResult }> {
  const receipt = (await client.waitForTransactionReceipt({
    hash: hash as never,
    status: "FINALIZED" as never,
    retries: 60,
    interval: 3000,
  })) as ReceiptLike;

  const statusName = receipt.status_name ?? receipt.statusName;
  if (statusName !== "FINALIZED") {
    return {
      receipt,
      result: { status: "ERROR", message: `consensus did not reach FINALIZED: ${statusName ?? "unknown status"}` },
    };
  }

  const leaderResults = (receipt.consensus_data?.leader_receipt ?? [])
    .map((r) => r.execution_result)
    .filter((r): r is string => typeof r === "string" && r.length > 0);

  if (leaderResults.length === 0) {
    return {
      receipt,
      result: {
        status: "ERROR",
        message: "finalized receipt carried no leader_receipt execution_result — cannot confirm the write actually succeeded",
      },
    };
  }

  if (leaderResults.some((r) => ERROR_EXECUTION_RESULTS.has(r))) {
    const data = receipt.data;
    const message = data && typeof data === "object" ? JSON.stringify(data) : "execution reverted";
    return { receipt, result: { status: "ERROR", message } };
  }

  if (!leaderResults.every((r) => SUCCESS_EXECUTION_RESULTS.has(r))) {
    return {
      receipt,
      result: {
        status: "ERROR",
        message: `finalized receipt carried an unrecognized execution_result: ${JSON.stringify(leaderResults)}`,
      },
    };
  }

  return { receipt, result: { status: "SUCCESS" } };
}

export async function waitForFinality(client: AnyClient, hash: `0x${string}`): Promise<WaitResult> {
  return (await getFinalizedReceipt(client, hash)).result;
}
