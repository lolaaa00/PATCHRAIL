"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useReleaseRead, useReleaseWrite, useVaultWrite } from "@/lib/contract/useContracts";
import { useTxLifecycle } from "@/lib/contract/txLifecycle";
import { waitForFinality } from "@/lib/genlayer/txWait";
import { formatGen } from "@/lib/genlayer/gen";
import { LifecycleTracker } from "@/components/LifecycleTracker";
import { Button } from "@/components/ui/Button";
import { useWallet } from "@/lib/wallet/WalletContext";
import type { ProjectRecord } from "@/lib/contract/types";

export default function FundProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const wallet = useWallet();
  const releaseRead = useReleaseRead();
  const releaseWrite = useReleaseWrite();
  const vaultWrite = useVaultWrite();
  const { state, run } = useTxLifecycle();
  const router = useRouter();

  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!releaseRead) return;
    releaseRead
      .getProject(id)
      .then(setProject)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load project"));
  }, [releaseRead, id]);

  async function onFund() {
    if (!vaultWrite || !releaseWrite || !project) return;
    const result = await run({
      chainId: wallet.chainId,
      write: () => vaultWrite.adapter.fundProject(id, BigInt(project.total_payment_amount)),
      wait: (hash) => waitForFinality(vaultWrite.client, hash),
      reread: async () => {
        const funded = await vaultWrite.adapter.isFunded(id);
        if (!funded) {
          throw new Error("Vault re-read after a finalized deposit still reports is_funded() = false");
        }
      },
    });
    if (result.stage !== "STATE_REREAD") return;

    setSyncing(true);
    try {
      const syncHash = await releaseWrite.adapter.syncFundingStatus(id);
      const syncResult = await waitForFinality(releaseWrite.client, syncHash);
      if (syncResult.status === "ERROR") {
        throw new Error(syncResult.message ?? "sync_funding_status execution failed");
      }
      const synced = await releaseWrite.adapter.getProject(id);
      if (synced.status !== "FUNDED") {
        throw new Error(`PatchrailRelease status after sync is '${synced.status}', expected FUNDED`);
      }
      router.push(`/p/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Funding succeeded but syncing PatchrailRelease's status failed — retry from the project page.");
    } finally {
      setSyncing(false);
    }
  }

  if (!project) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16">
        {error ? <p className="font-mono text-xs text-coral">{error}</p> : <p className="font-mono text-xs text-titanium">Loading…</p>}
      </div>
    );
  }

  if (project.status !== "DRAFT") {
    return (
      <div className="mx-auto max-w-lg px-6 py-16">
        <p className="font-mono text-xs text-titanium">
          This project is already {project.status} — funding is only available while a locked definition is DRAFT.
        </p>
      </div>
    );
  }

  if (!project.definition_locked) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16">
        <p className="font-mono text-xs text-coral">
          The client must lock the definition (gate bps summing to 100%) before this project can be funded.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-6 py-16">
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-titanium">Fund contract</p>
      <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">{project.title}</h1>
      <p className="mt-6 font-mono text-sm text-titanium">Exact deposit required</p>
      <p className="mt-1 font-display text-4xl">{formatGen(BigInt(project.total_payment_amount))} GEN</p>
      <p className="mt-4 text-sm text-titanium">
        The vault accepts only this exact amount, only once, and only from the project&apos;s client address. Gate
        payment percentages are already sealed by the definition hash and cannot change after this deposit.
      </p>
      <div className="mt-8">
        <Button onClick={onFund} disabled={!vaultWrite || !releaseWrite || syncing}>
          {vaultWrite ? (syncing ? "Syncing status…" : "Fund vault") : "Connect wallet on Studionet to fund"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-4 font-mono text-xs text-coral">
          {error}
        </p>
      )}
      <div className="mt-6">
        <LifecycleTracker state={state} />
      </div>
    </div>
  );
}
