"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createProjectSchema, addGateSchema, gateBpsSumSchema } from "@/lib/validation/schemas";
import { useReleaseWrite } from "@/lib/contract/useContracts";
import { useTxLifecycle } from "@/lib/contract/txLifecycle";
import { waitForFinality } from "@/lib/genlayer/txWait";
import { parseGen } from "@/lib/genlayer/gen";
import { LifecycleTracker } from "@/components/LifecycleTracker";
import { Button } from "@/components/ui/Button";
import { FieldWrapper, TextArea, TextInput, Select } from "@/components/ui/Field";
import { useWallet } from "@/lib/wallet/WalletContext";
import type { GateType, EvidenceRole } from "@/lib/contract/types";

type DraftGate = {
  gateId: string;
  label: string;
  criterion: string;
  gateType: GateType;
  evidenceRequirements: EvidenceRole[];
  paymentPct: string;
  mandatory: boolean;
  dependencyGateId: string;
  sourcePolicy: string;
};

const EMPTY_GATE: DraftGate = {
  gateId: "",
  label: "",
  criterion: "",
  gateType: "CODE_QUALITY",
  evidenceRequirements: ["repo"],
  paymentPct: "",
  mandatory: true,
  dependencyGateId: "",
  sourcePolicy: "Validators must independently fetch and inspect the cited sources; builder-authored summaries are not evidence.",
};

const EVIDENCE_OPTIONS: EvidenceRole[] = ["repo", "deploy", "release", "tests"];

function toUnixSeconds(datetimeLocal: string): number {
  return Math.floor(new Date(datetimeLocal).getTime() / 1000);
}

export function NewProjectForm() {
  const wallet = useWallet();
  const release = useReleaseWrite();
  const { state, run } = useTxLifecycle();
  const router = useRouter();

  const [projectId, setProjectId] = useState("");
  const [builder, setBuilder] = useState("");
  const [title, setTitle] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [deployUrl, setDeployUrl] = useState("");
  const [maxRcRevisions, setMaxRcRevisions] = useState("3");
  const [totalPaymentAmount, setTotalPaymentAmount] = useState("");
  const [deadline, setDeadline] = useState("");
  const [gates, setGates] = useState<DraftGate[]>([{ ...EMPTY_GATE, gateId: "quality" }]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [steps, setSteps] = useState<{ label: string; ok: boolean; error?: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);

  function updateGate(i: number, patch: Partial<DraftGate>) {
    setGates((gs) => gs.map((g, idx) => (idx === i ? { ...g, ...patch } : g)));
  }

  function addGateRow() {
    setGates((gs) => [...gs, { ...EMPTY_GATE, gateId: "" }]);
  }

  function removeGateRow(i: number) {
    setGates((gs) => gs.filter((_, idx) => idx !== i));
  }

  const pctSum = gates.reduce((acc, g) => acc + (Number(g.paymentPct) || 0), 0);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setSteps([]);

    let totalBase: bigint;
    try {
      totalBase = parseGen(totalPaymentAmount || "0");
    } catch (err) {
      setFieldErrors({ totalPaymentAmount: err instanceof Error ? err.message : "invalid amount" });
      return;
    }

    const projectParsed = createProjectSchema.safeParse({
      projectId,
      builder,
      title,
      repoUrl,
      deployUrl,
      maxRcRevisions,
      totalPaymentAmount,
      deadline: deadline ? toUnixSeconds(deadline) : 0,
    });
    if (!projectParsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of projectParsed.error.issues) errs[String(issue.path[0])] = issue.message;
      setFieldErrors(errs);
      return;
    }

    const bpsList = gates.map((g) => Math.round((Number(g.paymentPct) || 0) * 100));
    const bpsCheck = gateBpsSumSchema.safeParse(bpsList);
    if (!bpsCheck.success) {
      setFieldErrors({ gates: "Gate payment percentages must sum to exactly 100%." });
      return;
    }

    const parsedGates = gates.map((g, i) =>
      addGateSchema.safeParse({
        projectId,
        gateId: g.gateId,
        label: g.label,
        criterion: g.criterion,
        gateType: g.gateType,
        evidenceRequirements: g.evidenceRequirements,
        paymentBps: bpsList[i],
        mandatory: g.mandatory,
        dependencyGateId: g.dependencyGateId,
        sourcePolicy: g.sourcePolicy,
      }),
    );
    const firstBad = parsedGates.find((p) => !p.success);
    if (firstBad && !firstBad.success) {
      setFieldErrors({ gates: firstBad.error.issues[0]?.message ?? "invalid gate" });
      return;
    }

    if (!release) return;
    setSubmitting(true);
    const localSteps: { label: string; ok: boolean; error?: string }[] = [];

    const createResult = await run({
      chainId: wallet.chainId,
      write: () =>
        release.adapter.createProject({
          projectId,
          builder: builder as `0x${string}`,
          title,
          repoUrl,
          deployUrl,
          maxRcRevisions: Number(maxRcRevisions),
          totalPaymentAmount: totalBase,
          deadline: toUnixSeconds(deadline),
        }),
      wait: (hash) => waitForFinality(release.client, hash),
      reread: async () => {
        await release.adapter.getProject(projectId);
      },
    });
    localSteps.push({ label: "Create project", ok: createResult.stage === "STATE_REREAD", error: createResult.errorMessage ?? undefined });
    setSteps([...localSteps]);
    if (createResult.stage !== "STATE_REREAD") {
      setSubmitting(false);
      return;
    }

    for (let i = 0; i < parsedGates.length; i++) {
      const g = parsedGates[i];
      if (!g || !g.success) continue;
      const data = g.data;
      const result = await run({
        chainId: wallet.chainId,
        write: () => release.adapter.addGate(data),
        wait: (hash) => waitForFinality(release.client, hash),
        reread: async () => {
          await release.adapter.getGate(projectId, data.gateId);
        },
      });
      localSteps.push({ label: `Add gate: ${data.label}`, ok: result.stage === "STATE_REREAD", error: result.errorMessage ?? undefined });
      setSteps([...localSteps]);
      if (result.stage !== "STATE_REREAD") {
        setSubmitting(false);
        return;
      }
    }

    const lockResult = await run({
      chainId: wallet.chainId,
      write: () => release.adapter.lockDefinition(projectId),
      wait: (hash) => waitForFinality(release.client, hash),
      reread: async () => {
        await release.adapter.getProject(projectId);
      },
    });
    localSteps.push({ label: "Lock definition", ok: lockResult.stage === "STATE_REREAD", error: lockResult.errorMessage ?? undefined });
    setSteps([...localSteps]);
    setSubmitting(false);

    if (lockResult.stage === "STATE_REREAD") {
      router.push(`/p/${projectId}`);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-8">
      <div className="grid gap-5 sm:grid-cols-2">
        <FieldWrapper label="Project ID" htmlFor="projectId" error={fieldErrors.projectId}>
          <TextInput id="projectId" value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="acme-billing-v2" />
        </FieldWrapper>
        <FieldWrapper label="Builder address" htmlFor="builder" error={fieldErrors.builder}>
          <TextInput id="builder" value={builder} onChange={(e) => setBuilder(e.target.value)} placeholder="0x…" />
        </FieldWrapper>
      </div>

      <FieldWrapper label="Title" htmlFor="title" error={fieldErrors.title}>
        <TextInput id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Acme Billing v2 rebuild" />
      </FieldWrapper>

      <div className="grid gap-5 sm:grid-cols-2">
        <FieldWrapper label="Repository URL" htmlFor="repoUrl" error={fieldErrors.repoUrl}>
          <TextInput id="repoUrl" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/org/repo" />
        </FieldWrapper>
        <FieldWrapper label="Deployment URL" htmlFor="deployUrl" error={fieldErrors.deployUrl}>
          <TextInput id="deployUrl" value={deployUrl} onChange={(e) => setDeployUrl(e.target.value)} placeholder="https://app.example.com" />
        </FieldWrapper>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <FieldWrapper label="Max RC revisions" htmlFor="maxRc" error={fieldErrors.maxRcRevisions}>
          <TextInput id="maxRc" type="number" min={1} max={20} value={maxRcRevisions} onChange={(e) => setMaxRcRevisions(e.target.value)} />
        </FieldWrapper>
        <FieldWrapper label="Total value (GEN)" htmlFor="total" error={fieldErrors.totalPaymentAmount}>
          <TextInput id="total" value={totalPaymentAmount} onChange={(e) => setTotalPaymentAmount(e.target.value)} placeholder="1000" />
        </FieldWrapper>
        <FieldWrapper label="Deadline" htmlFor="deadline" error={fieldErrors.deadline}>
          <TextInput id="deadline" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </FieldWrapper>
      </div>

      <div className="flex flex-col gap-4 border-t border-phosphor/15 pt-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-medium">Gates</h2>
          <span className={`font-mono text-xs ${pctSum === 100 ? "text-green" : "text-coral"}`}>{pctSum}% of 100%</span>
        </div>
        {fieldErrors.gates && (
          <p role="alert" className="text-xs text-coral">
            {fieldErrors.gates}
          </p>
        )}
        {gates.map((g, i) => (
          <div key={i} className="flex flex-col gap-4 border border-phosphor/15 p-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-wide text-titanium">Gate {i + 1}</span>
              {gates.length > 1 && (
                <button type="button" onClick={() => removeGateRow(i)} className="font-mono text-[11px] text-coral underline">
                  Remove
                </button>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldWrapper label="Gate ID" htmlFor={`gate-id-${i}`}>
                <TextInput id={`gate-id-${i}`} value={g.gateId} onChange={(e) => updateGate(i, { gateId: e.target.value })} placeholder="quality" />
              </FieldWrapper>
              <FieldWrapper label="Label" htmlFor={`gate-label-${i}`}>
                <TextInput id={`gate-label-${i}`} value={g.label} onChange={(e) => updateGate(i, { label: e.target.value })} placeholder="Code Quality" />
              </FieldWrapper>
            </div>
            <FieldWrapper label="Acceptance criterion" htmlFor={`gate-criterion-${i}`} hint="State a material, checkable condition.">
              <TextArea
                id={`gate-criterion-${i}`}
                rows={2}
                value={g.criterion}
                onChange={(e) => updateGate(i, { criterion: e.target.value })}
                placeholder="CI passes on the RC commit and no TODO markers remain in the critical path."
              />
            </FieldWrapper>
            <div className="grid gap-4 sm:grid-cols-3">
              <FieldWrapper label="Gate type" htmlFor={`gate-type-${i}`}>
                <Select id={`gate-type-${i}`} value={g.gateType} onChange={(e) => updateGate(i, { gateType: e.target.value as GateType })}>
                  {["CODE_QUALITY", "DOCUMENTATION", "DEPLOYMENT", "BEHAVIOR", "SECURITY_DISCLOSURE", "OTHER"].map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </FieldWrapper>
              <FieldWrapper label="Payment %" htmlFor={`gate-pct-${i}`}>
                <TextInput id={`gate-pct-${i}`} value={g.paymentPct} onChange={(e) => updateGate(i, { paymentPct: e.target.value })} placeholder="25" />
              </FieldWrapper>
              <FieldWrapper label="Depends on gate ID" htmlFor={`gate-dep-${i}`} hint="Blank = no dependency">
                <TextInput id={`gate-dep-${i}`} value={g.dependencyGateId} onChange={(e) => updateGate(i, { dependencyGateId: e.target.value })} placeholder="quality" />
              </FieldWrapper>
            </div>
            <div className="flex flex-wrap gap-4">
              {EVIDENCE_OPTIONS.map((role) => (
                <label key={role} className="flex items-center gap-2 font-mono text-xs uppercase tracking-wide text-titanium">
                  <input
                    type="checkbox"
                    checked={g.evidenceRequirements.includes(role)}
                    onChange={(e) =>
                      updateGate(i, {
                        evidenceRequirements: e.target.checked
                          ? [...g.evidenceRequirements, role]
                          : g.evidenceRequirements.filter((r) => r !== role),
                      })
                    }
                  />
                  {role}
                </label>
              ))}
              <label className="ml-auto flex items-center gap-2 font-mono text-xs uppercase tracking-wide text-titanium">
                <input type="checkbox" checked={g.mandatory} onChange={(e) => updateGate(i, { mandatory: e.target.checked })} />
                Mandatory
              </label>
            </div>
          </div>
        ))}
        <Button type="button" variant="secondary" onClick={addGateRow} className="self-start">
          + Add gate
        </Button>
      </div>

      <Button type="submit" disabled={!release || submitting}>
        {release ? (submitting ? "Submitting…" : "Create rail") : "Connect wallet on Studionet to create"}
      </Button>

      {steps.length > 0 && (
        <ol className="flex flex-col gap-1 font-mono text-xs">
          {steps.map((s, i) => (
            <li key={i} className={s.ok ? "text-green" : "text-coral"}>
              {s.ok ? "✓" : "✗"} {s.label} {s.error ? `— ${s.error}` : ""}
            </li>
          ))}
        </ol>
      )}

      <LifecycleTracker state={state} />
    </form>
  );
}
