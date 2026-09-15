"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { useReleaseRead } from "@/lib/contract/useContracts";
import { StatusBadge } from "@/components/StatusBadge";
import type { ReleaseCandidateRecord, GateFindingRecord } from "@/lib/contract/types";

export default function RcDossierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const release = useReleaseRead();
  const [rc, setRc] = useState<ReleaseCandidateRecord | null>(null);
  const [findings, setFindings] = useState<{ gateId: string; finding: GateFindingRecord }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!release) return;
    let cancelled = false;
    (async () => {
      try {
        const record = await release.getRc(id);
        if (cancelled) return;
        setRc(record);
        const gateIds = await release.listGateIds(record.project_id);
        const loaded: { gateId: string; finding: GateFindingRecord }[] = [];
        for (const gid of gateIds) {
          try {
            const finding = await release.getFinding(record.project_id, gid, id);
            loaded.push({ gateId: gid, finding });
          } catch {
            // no finding recorded yet for this gate on this RC
          }
        }
        if (!cancelled) setFindings(loaded);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load release candidate");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [release, id]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-titanium">Release candidate dossier</p>
      {error && (
        <p role="alert" className="mt-4 font-mono text-xs text-coral">
          {error}
        </p>
      )}
      {rc && (
        <>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">
            {rc.project_id} · rc{rc.revision}
          </h1>
          <p className="mt-2 font-mono text-xs text-titanium">
            commit <span className="text-phosphor">{rc.commit_sha}</span> · submitted{" "}
            {new Date(rc.submitted_at * 1000).toLocaleString()}
          </p>

          <dl className="mt-6 flex flex-col gap-2 text-sm">
            <EvidenceLink label="Repository evidence" url={rc.repo_evidence_url} />
            <EvidenceLink label="Deployment" url={rc.deployment_url} />
            <EvidenceLink label="Release notes" url={rc.release_notes_url} />
            {rc.test_artifact_url && <EvidenceLink label="Test artifact" url={rc.test_artifact_url} />}
          </dl>

          <div className="mt-8 flex flex-col gap-4">
            {findings.map(({ gateId, finding }) => (
              <div key={gateId} className="border border-phosphor/15 p-4">
                <div className="flex items-center justify-between">
                  <p className="font-mono text-xs uppercase tracking-wide text-titanium">{gateId}</p>
                  <StatusBadge status={finding.finding} />
                </div>
                <p className="mt-2 text-sm text-titanium">{finding.reason}</p>
              </div>
            ))}
            {findings.length === 0 && <p className="font-mono text-xs text-titanium">No gates evaluated against this RC yet.</p>}
          </div>

          <Link href={`/p/${rc.project_id}`} className="mt-8 inline-block font-mono text-xs text-blue underline">
            ← Back to project rail
          </Link>
        </>
      )}
    </div>
  );
}

function EvidenceLink({ label, url }: { label: string; url: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="font-mono text-[11px] uppercase tracking-wide text-titanium">{label}</dt>
      <dd className="flex items-center gap-1 truncate">
        <a href={url} target="_blank" rel="noreferrer" className="truncate text-blue underline">
          {url}
        </a>
        <ExternalLink size={12} className="shrink-0 text-blue" aria-hidden />
      </dd>
    </div>
  );
}
