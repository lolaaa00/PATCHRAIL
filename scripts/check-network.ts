/**
 * CI/pre-deploy check: confirms the canonical network module resolves to
 * chain 61999 / https://studio.genlayer.com/api. Run via `npm run check:network`.
 */
import { NETWORK, CANONICAL_CHAIN_ID, CANONICAL_RPC_URL, assertCanonicalNetwork } from "../lib/genlayer/network";

const result = assertCanonicalNetwork(NETWORK);

console.log("Effective network:");
console.log(`  chain id : ${NETWORK.id}`);
console.log(`  rpc      : ${NETWORK.rpcUrls?.default?.http?.[0]}`);
console.log(`  expected : chain ${CANONICAL_CHAIN_ID} @ ${CANONICAL_RPC_URL}`);

if (!result.ok) {
  console.error(`FAIL: ${result.reason}`);
  process.exit(1);
}

console.log("PASS: resolved network matches canonical Studionet configuration.");
