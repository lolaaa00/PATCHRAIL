"use client";

import { use, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useReleaseRead, useVaultRead, useDeploymentStatus } from "@/lib/contract/useContracts";
import { NotDeployedNotice } from "@/components/NotDeployedNotice";
import { StatusBadge } from "@/components/StatusBadge";
import { GateRail, type RailGate } from "@/components/GateRail";
import { Button } from "@/components/ui/Button";
import { formatGen } from "@/lib/genlayer/gen";
import { explorerAddressUrl, shortHash } from "@/lib/genlayer/explorer";
import type { ProjectRecord, GateRecord } from "@/lib/contract/types";

type GateWithState = GateRecord & { railState: RailGate["state"] };

export default function ProjectRailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { releaseDeployed, vaultDeployed } = useDeploymentStatus();
  const release = useReleaseRead();
  const vault = useVaultRead();

  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [gates, setGates] = useState<GateWithState[]>([]);
  const [funded, setFunded] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!release) return;
    try {
      const p = await release.getProject(id);
      setProject(p);
      const gateIds = await release.listGateIds(id);
      const rcId = p.current_rc_revision > 0 ? await release.listRcIds(id).then((ids) => ids[ids.length - 1]) : null;
      const loaded = await Promise.all(
        gateIds.map(async (gid) => {
          const gate = await release.getGate(id, gid);
          let railState: RailGate["state"] = "PENDING";
          if (rcId) {
            try {
              const finding = await release.getFinding(id, gid, rcId);
              railState = finding.finding as RailGate["state"];
            } catch {
              railState = "PENDING";
            }
          }
          return { ...gate, railState };
        }),
      );
      setGates(loaded);
      if (vault) setFunded(await vault.isFunded(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load project");
    }
  }, [release, vault, id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time data load on mount / id change
    load();
  }, [load]);

  const railGates: RailGate[] = gates
    .sort((a, b) => a.order_index - b.order_index)
    .map((g) => ({ gate_id: g.gate_id, label: g.label, state: g.railState }));

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      {!releaseDeployed && <NotDeployedNotice contract="Release" />}
      {!vaultDeployed && <NotDeployedNotice contract="Vault" />}
      {error && (
        <p role="alert" className="font-mono text-xs text-coral">
          {error}
        </p>
      )}

      {project && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-titanium">{id}</p>
              <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">{project.title}</h1>
            </div>
            <StatusBadge status={project.status} />
          </div>

          <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-3">
            <Field label="Client" value={shortHash(project.client)} href={explorerAddressUrl(project.client)} />
            <Field label="Builder" value={shortHash(project.builder)} href={explorerAddressUrl(project.builder)} />
            <Field label="Total value" value={`${formatGen(BigInt(project.total_payment_amount))} GEN`} />
            <Field label="RC revision" value={`${project.current_rc_revision} / ${project.max_rc_revisions}`} />
            <Field label="Deadline" value={new Date(project.deadline * 1000).toLocaleString()} />
            <Field label="Definition hash" value={project.definition_hash ? shortHash(project.definition_hash, 8, 6) : "—"} />
          </dl>

          <div className="mt-10 border border-phosphor/15 bg-phosphor/[0.03] p-6">
            <GateRail gates={railGates} />
          </div>

          <div className="mt-8 flex flex-wrap gap-4">
            {project.status === "DRAFT" && (
              <Link href={`/p/${id}/fund`}>
                <Button>Fund this project</Button>
              </Link>
            )}
            {(project.status === "FUNDED" || project.status === "ACTIVE" || project.status === "RELEASE_CANDIDATE") && (
              <Link href={`/p/${id}/rc`}>
                <Button>Submit release candidate</Button>
              </Link>
            )}
            <Link href={`/p/${id}/gates`}>
              <Button variant="secondary">Acceptance gates</Button>
            </Link>
          </div>

          {funded === false && project.status !== "DRAFT" && (
            <p className="mt-4 font-mono text-xs text-coral">
              PatchrailRelease reports this project as {project.status} but the vault has not confirmed funding.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Field({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div>
      <dt className="font-mono text-[11px] uppercase tracking-wide text-titanium">{label}</dt>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="text-blue underline">
          {value}
        </a>
      ) : (
        <dd className="mt-0.5">{value}</dd>
      )}
    </div>
  );
}
