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

async function deployOne(client: ReturnType<typeof createClient>, path: string, label: string, args: unknown[] = []) {
  const code = readFileSync(path);
  const sha256 = createHash("sha256").update(code).digest("hex");

  console.log(`\n[${label}] deploying ${path} (${code.length} bytes, sha256 ${sha256})`);

  const txHash = await client.deployContract({ code, args: args as never[] });
  console.log(`[${label}] deploy tx: ${txHash}`);

  const receipt = await client.waitForTransactionReceipt({
    hash: txHash as never,
    status: "FINALIZED" as never,
    retries: 60,
    interval: 3000,
  });

  const decoded = (receipt as { txDataDecoded?: { contractAddress?: string } }).txDataDecoded;
  const address = decoded?.contractAddress;
  const statusName = (receipt as { statusName?: string }).statusName;
  const executionResultName = (receipt as { txExecutionResultName?: string }).txExecutionResultName;

  if (!address) {
    throw new Error(`[${label}] deployment did not return a contract address — receipt: ${JSON.stringify(receipt)}`);
  }

  return { label, path, sha256, bytes: code.length, txHash, address, statusName, executionResultName };
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
  const wireReceipt = await client.waitForTransactionReceipt({
    hash: wireTx as never,
    status: "FINALIZED" as never,
    retries: 60,
    interval: 3000,
  });
  const wireStatus = (wireReceipt as { statusName?: string }).statusName;
  const wireResult = (wireReceipt as { txExecutionResultName?: string }).txExecutionResultName;
  console.log(`Wiring tx: ${wireTx} (${wireStatus} / ${wireResult})`);
  if (wireResult === "FINISHED_WITH_ERROR") {
    throw new Error(`set_vault_address failed: ${JSON.stringify((wireReceipt as { data?: unknown }).data)}`);
  }

  const record = {
    network: { chainId: NETWORK.id, rpc: NETWORK.rpcUrls?.default?.http?.[0] },
    gitSha,
    signer: account.address,
    deployedAt: new Date().toISOString(),
    contracts: [release, vault],
    wiring: { tx: wireTx, statusName: wireStatus, executionResultName: wireResult },
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
