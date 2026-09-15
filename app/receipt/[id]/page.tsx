"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useReleaseRead, useVaultRead } from "@/lib/contract/useContracts";
import { StatusBadge } from "@/components/StatusBadge";
import { formatGen } from "@/lib/genlayer/gen";
import { explorerAddressUrl, shortHash } from "@/lib/genlayer/explorer";
import type { ProjectRecord, GateRecord } from "@/lib/contract/types";

/** Receipt id format: "<projectId>:<gateId>" */
export default function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [projectId, gateId] = id.includes(":") ? id.split(/:(.+)/) : [id, ""];
  const release = useReleaseRead();
  const vault = useVaultRead();

  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [gate, setGate] = useState<GateRecord | null>(null);
  const [claimed, setClaimed] = useState<boolean | null>(null);
  const [amount, setAmount] = useState<bigint>(0n);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!release || !vault || !gateId) return;
    let cancelled = false;
    (async () => {
      try {
        const [p, g, isClaimed, claimedAmount] = await Promise.all([
          release.getProject(projectId as string),
          release.getGate(projectId as string, gateId as string),
          vault.isClaimed(projectId as string, gateId as string),
          vault.getClaimedAmount(projectId as string, gateId as string),
        ]);
        if (cancelled) return;
        setProject(p);
        setGate(g);
        setClaimed(isClaimed);
        setAmount(isClaimed ? claimedAmount : await vault.getGatePayoutAmount(projectId as string, gateId as string));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load receipt");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [release, vault, projectId, gateId]);

  if (!gateId) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16">
        <p className="font-mono text-xs text-coral">A receipt id must be in the form projectId:gateId.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-6 py-16">
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-titanium">Payment receipt</p>
      {error && (
        <p role="alert" className="mt-4 font-mono text-xs text-coral">
          {error}
        </p>
      )}
      {project && gate && (
        <div className="mt-6 border border-phosphor/15 p-6">
          <div className="flex items-center justify-between">
            <p className="font-display text-xl">{gate.label}</p>
            <StatusBadge status={claimed ? "SATISFIED" : "INCONCLUSIVE"} />
          </div>
          <p className="mt-1 font-mono text-xs text-titanium">
            {project.title} · {(gate.payment_bps / 100).toFixed(2)}% of total
          </p>
          <p className="mt-6 font-display text-4xl">{formatGen(amount)} GEN</p>
          <p className="mt-1 font-mono text-xs text-titanium">{claimed ? "released" : "estimated — not yet claimed"}</p>

          <dl className="mt-6 flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between">
              <dt className="font-mono text-[11px] uppercase tracking-wide text-titanium">Beneficiary</dt>
              <dd>
                <a href={explorerAddressUrl(project.builder)} target="_blank" rel="noreferrer" className="text-blue underline">
                  {shortHash(project.builder)}
                </a>
              </dd>
            </div>
          </dl>

          <Link href={`/p/${projectId}/gates`} className="mt-8 inline-block font-mono text-xs text-blue underline">
            ← Back to gates
          </Link>
        </div>
      )}
    </div>
  );
}
