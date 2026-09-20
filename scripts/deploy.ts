/**
 * Deploys PatchrailRelease and PatchrailVault to GenLayer Studionet (61999)
 * using a funded signer, wires PatchrailRelease's vault_address to the
 * deployed vault, and records real, verifiable deployment evidence.
 *
 * Usage:
 *   PRIVATE_KEY=0x... npx tsx scripts/deploy.ts
 *
 * PRIVATE_KEY must never be committed. This script reads it only from the
 * environment and never writes it to disk or logs.
 *
 * Requires: an account funded with GEN on Studionet. Without one, this
 * script fails fast rather than fabricating a deployment record.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { createClient, createAccount } from "genlayer-js";
import { NETWORK, CANONICAL_CHAIN_ID, assertCanonicalNetworkOrThrow } from "../lib/genlayer/network";
import { getFinalizedReceipt } from "../lib/genlayer/txWait";

async function deployOne(client: ReturnType<typeof createClient>, path: string, label: string, args: unknown[] = []) {
  const code = readFileSync(path);
  const sha256 = createHash("sha256").update(code).digest("hex");

  console.log(`\n[${label}] deploying ${path} (${code.length} bytes, sha256 ${sha256})`);

  const txHash = await client.deployContract({ code, args: args as never[] });
  console.log(`[${label}] deploy tx: ${txHash}`);

  // Use the same fail-closed finality classification as the frontend
  // (lib/genlayer/txWait.ts) rather than a separately maintained check —
  // a FINALIZED status with a missing/unrecognized execution_result must
  // never be recorded as a successful deployment.
  const { receipt, result } = await getFinalizedReceipt(client, txHash as `0x${string}`);
  if (result.status === "ERROR") {
    throw new Error(`[${label}] deployment did not finalize successfully: ${result.message}`);
  }

  // The real receipt has no `txDataDecoded` field (confirmed live) — for a
  // deploy transaction the new contract's address is `data.contract_address`,
  // mirrored at the top-level `to_address`/`recipient`.
  const address =
    (receipt.data?.contract_address as string | undefined) ?? receipt.to_address ?? receipt.recipient;
  const statusName = receipt.status_name;
  const executionResult = receipt.consensus_data?.leader_receipt?.[0]?.execution_result;

  if (!address) {
    throw new Error(`[${label}] deployment did not return a contract address — receipt: ${JSON.stringify(receipt)}`);
  }

  return { label, path, sha256, bytes: code.length, txHash, address, statusName, executionResult };
}

async function main() {
  assertCanonicalNetworkOrThrow(NETWORK);

  const privateKey = process.env.PRIVATE_KEY as `0x${string}` | undefined;
  if (!privateKey) {
    console.error("PRIVATE_KEY env var is required (funded Studionet signer). Refusing to fabricate a deployment.");
    process.exit(1);
  }

  const account = createAccount(privateKey);
  const client = createClient({ chain: NETWORK, account });

  console.log(`Signer: ${account.address}`);
  console.log(`Chain : ${NETWORK.id} (expected ${CANONICAL_CHAIN_ID})`);

  const gitSha = execSync("git rev-parse HEAD").toString().trim();

  const release = await deployOne(client, "contracts/patchrail_release.py", "PatchrailRelease");
  const vault = await deployOne(client, "contracts/patchrail_vault.py", "PatchrailVault", [release.address]);

  console.log("\nWiring PatchrailRelease.vault_address -> PatchrailVault...");
  const wireTx = await client.writeContract({
    address: release.address as `0x${string}`,
    functionName: "set_vault_address",
    args: [vault.address],
    value: 0n,
  });
  const { receipt: wireReceipt, result: wireOutcome } = await getFinalizedReceipt(client, wireTx as `0x${string}`);
  const wireStatus = wireReceipt.status_name;
  const wireResult = wireReceipt.consensus_data?.leader_receipt?.[0]?.execution_result;
  console.log(`Wiring tx: ${wireTx} (${wireStatus} / ${wireResult})`);
  if (wireOutcome.status === "ERROR") {
    throw new Error(`set_vault_address did not finalize successfully: ${wireOutcome.message}`);
  }

  const record = {
    network: { chainId: NETWORK.id, rpc: NETWORK.rpcUrls?.default?.http?.[0] },
    gitSha,
    signer: account.address,
    deployedAt: new Date().toISOString(),
    contracts: [release, vault],
    wiring: { tx: wireTx, statusName: wireStatus, executionResult: wireResult },
  };

  writeFileSync("docs/DEPLOYMENT_RECORD.json", JSON.stringify(record, null, 2));
  console.log("\nWrote docs/DEPLOYMENT_RECORD.json");
  console.log(
    `\nSet these in .env.local:\nNEXT_PUBLIC_RELEASE_ADDRESS=${release.address}\nNEXT_PUBLIC_VAULT_ADDRESS=${vault.address}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
