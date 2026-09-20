import { describe, expect, it } from "vitest";
import { waitForFinality } from "@/lib/genlayer/txWait";

function clientReturning(receipt: unknown) {
  return { waitForTransactionReceipt: async () => receipt } as never;
}

const HASH = "0xabc" as `0x${string}`;

describe("waitForFinality", () => {
  it("reports SUCCESS on the real raw shape: status_name + leader_receipt.execution_result 'SUCCESS'", async () => {
    // Confirmed live: client.waitForTransactionReceipt returns the raw
    // snake_case GenVM shape (status_name), not the camelCase statusName the
    // SDK's TypeScript types declare — and leader_receipt execution_result
    // is the raw string "SUCCESS", not the declared ExecutionResult enum
    // name "FINISHED_WITH_RETURN".
    const client = clientReturning({
      status_name: "FINALIZED",
      consensus_data: { leader_receipt: [{ execution_result: "SUCCESS" }] },
    });
    const result = await waitForFinality(client, HASH);
    expect(result.status).toBe("SUCCESS");
  });

  it("reports ERROR on the real raw shape with execution_result 'ERROR'", async () => {
    // Confirmed against a different live Studionet deploy receipt (one that
    // genuinely failed with a contract-load NameError).
    const client = clientReturning({
      status_name: "FINALIZED",
      consensus_data: { leader_receipt: [{ execution_result: "ERROR" }] },
      data: { message: "NameError: name 'Any' is not defined" },
    });
    const result = await waitForFinality(client, HASH);
    expect(result.status).toBe("ERROR");
    expect(result.message).toContain("NameError");
  });

  it("also accepts camelCase statusName as a defensive fallback if a future/different call shape returns it", async () => {
    const client = clientReturning({
      statusName: "FINALIZED",
      consensus_data: { leader_receipt: [{ execution_result: "SUCCESS" }] },
    });
    const result = await waitForFinality(client, HASH);
    expect(result.status).toBe("SUCCESS");
  });

  it("also accepts the SDK's declared ExecutionResult enum names (FINISHED_WITH_RETURN / FINISHED_WITH_ERROR)", async () => {
    const ok = clientReturning({
      status_name: "FINALIZED",
      consensus_data: { leader_receipt: [{ execution_result: "FINISHED_WITH_RETURN" }] },
    });
    expect((await waitForFinality(ok, HASH)).status).toBe("SUCCESS");

    const bad = clientReturning({
      status_name: "FINALIZED",
      consensus_data: { leader_receipt: [{ execution_result: "FINISHED_WITH_ERROR" }] },
      data: { message: "reverted" },
    });
    const badResult = await waitForFinality(bad, HASH);
    expect(badResult.status).toBe("ERROR");
    expect(badResult.message).toContain("reverted");
  });

  it("fails closed (ERROR) when FINALIZED but no leader_receipt is present at all", async () => {
    const client = clientReturning({ status_name: "FINALIZED" });
    const result = await waitForFinality(client, HASH);
    expect(result.status).toBe("ERROR");
  });

  it("fails closed (ERROR) on an unrecognized execution_result value", async () => {
    const client = clientReturning({
      status_name: "FINALIZED",
      consensus_data: { leader_receipt: [{ execution_result: "SOMETHING_NEW" }] },
    });
    const result = await waitForFinality(client, HASH);
    expect(result.status).toBe("ERROR");
  });

  it("reports ERROR when the status never reached FINALIZED", async () => {
    const client = clientReturning({
      status_name: "VALIDATORS_TIMEOUT",
      consensus_data: { leader_receipt: [{ execution_result: "SUCCESS" }] },
    });
    const result = await waitForFinality(client, HASH);
    expect(result.status).toBe("ERROR");
  });

  it("reports ERROR when status_name is entirely absent (the exact real bug that hid for three live deploy attempts)", async () => {
    const client = clientReturning({
      consensus_data: { leader_receipt: [{ execution_result: "SUCCESS" }] },
    });
    const result = await waitForFinality(client, HASH);
    expect(result.status).toBe("ERROR");
  });

  it("requires every leader receipt to agree — a mixed set is an ERROR, not a success", async () => {
    const client = clientReturning({
      status_name: "FINALIZED",
      consensus_data: {
        leader_receipt: [{ execution_result: "SUCCESS" }, { execution_result: "ERROR" }],
      },
    });
    const result = await waitForFinality(client, HASH);
    expect(result.status).toBe("ERROR");
  });
});
