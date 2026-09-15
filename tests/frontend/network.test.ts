import { describe, expect, it } from "vitest";
import { NETWORK, CANONICAL_CHAIN_ID, CANONICAL_RPC_URL, assertCanonicalNetwork } from "@/lib/genlayer/network";

describe("network guard", () => {
  it("accepts the real configured Studionet chain", () => {
    expect(assertCanonicalNetwork(NETWORK)).toEqual({ ok: true });
    expect(CANONICAL_CHAIN_ID).toBe(61999);
    expect(CANONICAL_RPC_URL).toBe("https://studio.genlayer.com/api");
  });

  it("rejects a mismatched chain id", () => {
    const result = assertCanonicalNetwork({ id: 61997 });
    expect(result.ok).toBe(false);
  });

  it("rejects a mismatched rpc url", () => {
    const result = assertCanonicalNetwork({
      id: 61999,
      rpcUrls: { default: { http: ["https://studio-dev.genlayer.com/api"] } },
    });
    expect(result.ok).toBe(false);
  });
});
