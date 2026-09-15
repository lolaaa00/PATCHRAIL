"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useReleaseRead, useReleaseWrite, useVaultRead, useVaultWrite } from "@/lib/contract/useContracts";
import { useTxLifecycle } from "@/lib/contract/txLifecycle";
import { waitForFinality } from "@/lib/genlayer/txWait";
import { formatGen } from "@/lib/genlayer/gen";
import { StatusBadge } from "@/components/StatusBadge";
import { LifecycleTracker } from "@/components/LifecycleTracker";
import { Button } from "@/components/ui/Button";
import { useWallet } from "@/lib/wallet/WalletContext";
import type { ProjectRecord, GateRecord, GateFindingRecord } from "@/lib/contract/types";

type Row = {
  gate: GateRecord;
  finding: GateFindingRecord | null;
  satisfied: boolean;
  claimed: boolean;
  payout: bigint;
};

export default function GatesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const wallet = useWallet();
  const releaseRead = useReleaseRead();
  const releaseWrite = useReleaseWrite();
  const vaultRead = useVaultRead();
  const vaultWrite = useVaultWrite();
  const { state, run } = useTxLifecycle();

  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busyGate, setBusyGate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refundable, setRefundable] = useState<bigint | null>(null);

  const load = useCallback(async () => {
    if (!releaseRead) return;
    try {
      const p = await releaseRead.getProject(id);
      setProject(p);
      const gateIds = await releaseRead.listGateIds(id);
      const rcIds = await releaseRead.listRcIds(id);
      const latestRc = rcIds[rcIds.length - 1] ?? null;
      const loaded = await Promise.all(
        gateIds.map(async (gid) => {
          const gate = await releaseRead.getGate(id, gid);
          let finding: GateFindingRecord | null = null;
          if (latestRc) {
            try {
              finding = await releaseRead.getFinding(id, gid, latestRc);
            } catch {
              finding = null;
            }
          }
          const satisfied = await releaseRead.gateIsSatisfied(id, gid);
          let claimed = false;
          let payout = 0n;
          if (vaultRead) {
            claimed = await vaultRead.isClaimed(id, gid);
            payout = await vaultRead.getGatePayoutAmount(id, gid).catch(() => 0n);
          }
          return { gate, finding, satisfied, claimed, payout };
        }),
      );
      setRows(loaded.sort((a, b) => a.gate.order_index - b.gate.order_index));
      if (vaultRead) setRefundable(await vaultRead.getRefundableEstimate(id).catch(() => null));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load gates");
    }
  }, [releaseRead, vaultRead, id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time data load on mount / id change
    load();
  }, [load]);

  async function onEvaluate(gateId: string) {
    if (!releaseWrite) return;
    setBusyGate(gateId);
    await run({
      chainId: wallet.chainId,
      write: () => releaseWrite.adapter.evaluateGate(id, gateId),
      wait: (hash) => waitForFinality(releaseWrite.client, hash),
      reread: load,
    });
    setBusyGate(null);
  }

  async function onClaim(gateId: string) {
    if (!vaultWrite) return;
    setBusyGate(gateId);
    await run({
      chainId: wallet.chainId,
      write: () => vaultWrite.adapter.claimGate(id, gateId),
      wait: (hash) => waitForFinality(vaultWrite.client, hash),
      reread: load,
    });
    setBusyGate(null);
  }

  async function onRefund() {
    if (!vaultWrite) return;
    setBusyGate("__refund__");
    await run({
      chainId: wallet.chainId,
      write: () => vaultWrite.adapter.refundUnearned(id),
      wait: (hash) => waitForFinality(vaultWrite.client, hash),
      reread: load,
    });
    setBusyGate(null);
  }

  async function onExpire() {
    if (!releaseWrite) return;
    setBusyGate("__expire__");
    await run({
      chainId: wallet.chainId,
      write: () => releaseWrite.adapter.expireProject(id),
      wait: (hash) => waitForFinality(releaseWrite.client, hash),
      reread: load,
    });
    setBusyGate(null);
  }

  const [now] = useState(() => Math.floor(Date.now() / 1000));
  const canExpire = project && now > project.deadline && !["ACCEPTED", "EXPIRED", "CANCELLED", "DRAFT"].includes(project.status);

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-titanium">Acceptance gates</p>
      {project && <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">{project.title}</h1>}
      {error && (
        <p role="alert" className="mt-4 font-mono text-xs text-coral">
          {error}
        </p>
      )}

      <div className="mt-8 flex flex-col gap-4">
        {rows.map(({ gate, finding, satisfied, claimed, payout }) => (
          <div key={gate.gate_id} className="border border-phosphor/15 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-wide text-titanium">
                  {gate.gate_type} · {(gate.payment_bps / 100).toFixed(2)}% · {gate.mandatory ? "mandatory" : "optional"}
                  {gate.dependency_gate_id ? ` · depends on ${gate.dependency_gate_id}` : ""}
                </p>
                <p className="mt-1 font-display text-xl">{gate.label}</p>
              </div>
              <StatusBadge status={finding?.finding ?? "PENDING"} />
            </div>
            <p className="mt-3 text-sm text-titanium">{gate.criterion}</p>

            {finding && (
              <div className="mt-4 border-t border-phosphor/10 pt-4 text-xs">
                <p className="font-mono text-titanium">
                  commit_match {finding.commit_match} · deployment_relation {finding.deployment_relation}
                </p>
                <p className="mt-1 text-phosphor/80">{finding.reason}</p>
                {finding.evidence.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1">
                    {finding.evidence.map((ev, i) => (
                      <li key={i} className="font-mono text-titanium">
                        [{ev.source}] “{ev.excerpt}”
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                onClick={() => onEvaluate(gate.gate_id)}
                disabled={!releaseWrite || busyGate === gate.gate_id || (project?.current_rc_revision ?? 0) === 0}
              >
                {busyGate === gate.gate_id ? "Working…" : "Evaluate gate"}
              </Button>
              <Button variant="primary" onClick={() => onClaim(gate.gate_id)} disabled={!vaultWrite || !satisfied || claimed}>
                {claimed ? `Claimed ${formatGen(payout)} GEN` : `Claim ${formatGen(payout)} GEN`}
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-10 flex flex-wrap items-center gap-4 border-t border-phosphor/15 pt-6">
        {canExpire && (
          <Button variant="secondary" onClick={onExpire} disabled={busyGate === "__expire__"}>
            Mark expired
          </Button>
        )}
        {refundable !== null && refundable > 0n && (
          <Button variant="danger" onClick={onRefund} disabled={busyGate === "__refund__"}>
            Refund unearned {formatGen(refundable)} GEN to client
          </Button>
        )}
        <Link href={`/p/${id}`} className="font-mono text-xs text-titanium underline">
          Back to project rail
        </Link>
      </div>

      <div className="mt-6">
        <LifecycleTracker state={state} />
      </div>
    </div>
  );
}
