/**
 * Single source of truth for the target GenLayer network.
 * Every read/write path in this app must import chain config from here —
 * never construct a chain object inline elsewhere.
 */
import { studionet } from "genlayer-js/chains";

export const CANONICAL_CHAIN_ID = 61999;
export const CANONICAL_RPC_URL = "https://studio.genlayer.com/api";
export const CANONICAL_EXPLORER_URL = "https://explorer-studio.genlayer.com";
export const CANONICAL_CURRENCY = "GEN";

export const NETWORK = studionet;

export type NetworkAssertion =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Verifies the resolved chain config matches the canonical Studionet
 * parameters. Call this before any funded write and in CI.
 */
export function assertCanonicalNetwork(chain: {
  id: number;
  rpcUrls?: { default?: { http?: readonly string[] } };
}): NetworkAssertion {
  if (chain.id !== CANONICAL_CHAIN_ID) {
    return {
      ok: false,
      reason: `chain id ${chain.id} does not match canonical ${CANONICAL_CHAIN_ID}`,
    };
  }
  const rpc = chain.rpcUrls?.default?.http?.[0];
  if (rpc && !rpc.startsWith(CANONICAL_RPC_URL)) {
    return {
      ok: false,
      reason: `rpc url ${rpc} does not match canonical ${CANONICAL_RPC_URL}`,
    };
  }
  return { ok: true };
}

export function assertCanonicalNetworkOrThrow(chain: {
  id: number;
  rpcUrls?: { default?: { http?: readonly string[] } };
}): void {
  const result = assertCanonicalNetwork(chain);
  if (!result.ok) {
    throw new Error(`[network guard] ${result.reason}`);
  }
}

export function explorerTxUrl(txHash: string): string {
  return `${CANONICAL_EXPLORER_URL}/tx/${txHash}`;
}

export function explorerAddressUrl(address: string): string {
  return `${CANONICAL_EXPLORER_URL}/address/${address}`;
}
