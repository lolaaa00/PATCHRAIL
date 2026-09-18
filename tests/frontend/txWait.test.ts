import { describe, expect, it } from "vitest";
import { waitForFinality } from "@/lib/genlayer/txWait";

function clientReturning(receipt: unknown) {
  return { waitForTransactionReceipt: async () => receipt } as never;
}

const HASH = "0xabc" as `0x${string}`;

describe("waitForFinality", () => {
  it("reports SUCCESS when the leader receipt execution_result is FINISHED_WITH_RETURN", async () => {
    const client = clientReturning({
      statusName: "FINALIZED",
      consensus_data: { leader_receipt: [{ execution_result: "FINISHED_WITH_RETURN" }] },
    });
    const result = await waitForFinality(client, HASH);
    expect(result.status).toBe("SUCCESS");
  });

  it("reports ERROR when a leader receipt says FINISHED_WITH_ERROR, even if txExecutionResultName is absent", async () => {
    const client = clientReturning({
      statusName: "FINALIZED",
      consensus_data: { leader_receipt: [{ execution_result: "FINISHED_WITH_ERROR" }] },
      data: { message: "reverted" },
    });
    const result = await waitForFinality(client, HASH);
    expect(result.status).toBe("ERROR");
    expect(result.message).toContain("reverted");
  });

  it("falls back to txExecutionResultName only when no leader receipt is present", async () => {
    const client = clientReturning({
      statusName: "FINALIZED",
      txExecutionResultName: "FINISHED_WITH_RETURN",
    });
    const result = await waitForFinality(client, HASH);
    expect(result.status).toBe("SUCCESS");
  });

  it("fails closed (ERROR) when FINALIZED but no execution_result is present anywhere", async () => {
    const client = clientReturning({ statusName: "FINALIZED" });
    const result = await waitForFinality(client, HASH);
    expect(result.status).toBe("ERROR");
  });

  it("fails closed (ERROR) on an unrecognized execution_result value", async () => {
    const client = clientReturning({
      statusName: "FINALIZED",
      consensus_data: { leader_receipt: [{ execution_result: "SOMETHING_NEW" }] },
    });
    const result = await waitForFinality(client, HASH);
    expect(result.status).toBe("ERROR");
  });

  it("reports ERROR when the status never reached FINALIZED", async () => {
    const client = clientReturning({
      statusName: "VALIDATORS_TIMEOUT",
      consensus_data: { leader_receipt: [{ execution_result: "FINISHED_WITH_RETURN" }] },
    });
    const result = await waitForFinality(client, HASH);
    expect(result.status).toBe("ERROR");
  });

  it("requires every leader receipt to agree — a mixed set is an ERROR, not a success", async () => {
    const client = clientReturning({
      statusName: "FINALIZED",
      consensus_data: {
        leader_receipt: [{ execution_result: "FINISHED_WITH_RETURN" }, { execution_result: "FINISHED_WITH_ERROR" }],
      },
    });
    const result = await waitForFinality(client, HASH);
    expect(result.status).toBe("ERROR");
  });
});
