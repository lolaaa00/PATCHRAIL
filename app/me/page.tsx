"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useReleaseRead } from "@/lib/contract/useContracts";
import { useWallet } from "@/lib/wallet/WalletContext";
import { StatusBadge } from "@/components/StatusBadge";
import { NotDeployedNotice } from "@/components/NotDeployedNotice";
import { useDeploymentStatus } from "@/lib/contract/useContracts";
import type { ProjectRecord } from "@/lib/contract/types";

export default function MyProjectsPage() {
  const wallet = useWallet();
  const release = useReleaseRead();
  const { releaseDeployed } = useDeploymentStatus();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!release) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- kicks off a one-time load, not a render-cascade
    setLoading(true);
    (async () => {
      try {
        const ids = await release.listProjectIds();
        const all = await Promise.all(ids.map((pid) => release.getProject(pid)));
        if (!cancelled) setProjects(all);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load projects");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [release]);

  const mine = wallet.address
    ? projects.filter(
        (p) => p.client.toLowerCase() === wallet.address!.toLowerCase() || p.builder.toLowerCase() === wallet.address!.toLowerCase(),
      )
    : [];

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-titanium">My projects</p>
      <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">Projects you client or build</h1>

      {!releaseDeployed && <NotDeployedNotice contract="Release" />}
      {!wallet.address && <p className="mt-6 font-mono text-xs text-titanium">Connect a wallet to see your projects.</p>}
      {error && (
        <p role="alert" className="mt-4 font-mono text-xs text-coral">
          {error}
        </p>
      )}
      {loading && <p className="mt-6 font-mono text-xs text-titanium">Loading…</p>}

      <div className="mt-8 flex flex-col gap-3">
        {mine.map((p) => (
          <Link
            key={p.project_id}
            href={`/p/${p.project_id}`}
            className="flex items-center justify-between border border-phosphor/15 p-4 hover:border-blue"
          >
            <div>
              <p className="font-display text-lg">{p.title}</p>
              <p className="font-mono text-[11px] text-titanium">{p.project_id}</p>
            </div>
            <StatusBadge status={p.status} />
          </Link>
        ))}
        {wallet.address && !loading && mine.length === 0 && (
          <p className="font-mono text-xs text-titanium">No projects found for this address yet.</p>
        )}
      </div>
    </div>
  );
}
