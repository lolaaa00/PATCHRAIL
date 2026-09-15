/**
 * Client factories. Reads use an unsigned/ephemeral client — no wallet
 * required, safe for server components and public pages. Writes require
 * the user's injected EIP-1193 wallet and are only ever created client-side.
 */
import { createClient, createAccount } from "genlayer-js";
import { NETWORK, assertCanonicalNetworkOrThrow } from "./network";

assertCanonicalNetworkOrThrow(NETWORK);

let readClient: ReturnType<typeof createClient> | null = null;

/** Unsigned/ephemeral read client — safe for public reads, no signer. */
export function getReadClient() {
  if (!readClient) {
    const ephemeralAccount = createAccount();
    readClient = createClient({
      chain: NETWORK,
      account: ephemeralAccount,
    });
  }
  return readClient;
}

/** Write client bound to the user's connected wallet. Never cached across accounts. */
export function createWriteClient(walletAddress: `0x${string}`, provider: unknown) {
  assertCanonicalNetworkOrThrow(NETWORK);
  return createClient({
    chain: NETWORK,
    account: walletAddress,
    provider: provider as never,
  });
}
