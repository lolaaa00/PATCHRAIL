"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { submitRcSchema } from "@/lib/validation/schemas";
import { useReleaseWrite } from "@/lib/contract/useContracts";
import { useTxLifecycle } from "@/lib/contract/txLifecycle";
import { waitForFinality } from "@/lib/genlayer/txWait";
import { LifecycleTracker } from "@/components/LifecycleTracker";
import { Button } from "@/components/ui/Button";
import { FieldWrapper, TextInput } from "@/components/ui/Field";
import { useWallet } from "@/lib/wallet/WalletContext";

export default function SubmitRcPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const wallet = useWallet();
  const release = useReleaseWrite();
  const { state, run } = useTxLifecycle();
  const router = useRouter();

  const [commitSha, setCommitSha] = useState("");
  const [repoEvidenceUrl, setRepoEvidenceUrl] = useState("");
  const [deploymentUrl, setDeploymentUrl] = useState("");
  const [releaseNotesUrl, setReleaseNotesUrl] = useState("");
  const [testArtifactUrl, setTestArtifactUrl] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    const parsed = submitRcSchema.safeParse({
      projectId: id,
      commitSha,
      repoEvidenceUrl,
      deploymentUrl,
      releaseNotesUrl,
      testArtifactUrl,
    });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) errs[String(issue.path[0])] = issue.message;
      setFieldErrors(errs);
      return;
    }
    if (!release) return;

    const result = await run({
      chainId: wallet.chainId,
      write: () =>
        release.adapter.submitReleaseCandidate({
          projectId: id,
          commitSha: parsed.data.commitSha,
          repoEvidenceUrl: parsed.data.repoEvidenceUrl,
          deploymentUrl: parsed.data.deploymentUrl,
          releaseNotesUrl: parsed.data.releaseNotesUrl,
          testArtifactUrl: parsed.data.testArtifactUrl,
        }),
      wait: (hash) => waitForFinality(release.client, hash),
      reread: async () => {
        await release.adapter.getProject(id);
      },
    });
    if (result.stage === "STATE_REREAD") {
      router.push(`/p/${id}/gates`);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-titanium">Release candidate</p>
      <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">Submit an immutable RC</h1>
      <p className="mt-3 text-sm text-titanium">
        Evidence freezes the instant this is finalized. A failed gate does not let you edit this record — it
        creates a new RC revision instead.
      </p>

      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-5">
        <FieldWrapper label="Commit SHA" htmlFor="commitSha" error={fieldErrors.commitSha}>
          <TextInput id="commitSha" value={commitSha} onChange={(e) => setCommitSha(e.target.value)} placeholder="a1b2c3d4e5f6..." />
        </FieldWrapper>
        <FieldWrapper label="Repository evidence URL (commit or release page)" htmlFor="repoEvidenceUrl" error={fieldErrors.repoEvidenceUrl}>
          <TextInput
            id="repoEvidenceUrl"
            value={repoEvidenceUrl}
            onChange={(e) => setRepoEvidenceUrl(e.target.value)}
            placeholder="https://github.com/org/repo/commit/a1b2c3d"
          />
        </FieldWrapper>
        <FieldWrapper label="Deployment URL" htmlFor="deploymentUrl" error={fieldErrors.deploymentUrl}>
          <TextInput id="deploymentUrl" value={deploymentUrl} onChange={(e) => setDeploymentUrl(e.target.value)} placeholder="https://app.example.com" />
        </FieldWrapper>
        <FieldWrapper label="Release notes URL" htmlFor="releaseNotesUrl" error={fieldErrors.releaseNotesUrl}>
          <TextInput
            id="releaseNotesUrl"
            value={releaseNotesUrl}
            onChange={(e) => setReleaseNotesUrl(e.target.value)}
            placeholder="https://github.com/org/repo/releases/tag/v1"
          />
        </FieldWrapper>
        <FieldWrapper label="Test artifact / CI URL (optional)" htmlFor="testArtifactUrl" error={fieldErrors.testArtifactUrl}>
          <TextInput
            id="testArtifactUrl"
            value={testArtifactUrl}
            onChange={(e) => setTestArtifactUrl(e.target.value)}
            placeholder="https://github.com/org/repo/actions/runs/123"
          />
        </FieldWrapper>

        <Button type="submit" disabled={!release}>
          {release ? "Submit release candidate" : "Connect wallet on Studionet to submit"}
        </Button>

        <LifecycleTracker state={state} />
      </form>
    </div>
  );
}
