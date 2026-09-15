import type { getReadClient } from "@/lib/genlayer/client";
import type { ProjectRecord, GateRecord, ReleaseCandidateRecord, GateFindingRecord } from "./types";

type AnyClient = ReturnType<typeof getReadClient>;

export function releaseAdapter(client: AnyClient, address: `0x${string}`) {
  return {
    async getProject(projectId: string): Promise<ProjectRecord> {
      return (await client.readContract({ address, functionName: "get_project", args: [projectId] })) as unknown as ProjectRecord;
    },
    async listProjectIds(): Promise<string[]> {
      return (await client.readContract({ address, functionName: "list_project_ids", args: [] })) as unknown as string[];
    },
    async getGate(projectId: string, gateId: string): Promise<GateRecord> {
      return (await client.readContract({ address, functionName: "get_gate", args: [projectId, gateId] })) as unknown as GateRecord;
    },
    async listGateIds(projectId: string): Promise<string[]> {
      return (await client.readContract({ address, functionName: "list_gate_ids", args: [projectId] })) as unknown as string[];
    },
    async getRc(rcId: string): Promise<ReleaseCandidateRecord> {
      return (await client.readContract({ address, functionName: "get_rc", args: [rcId] })) as unknown as ReleaseCandidateRecord;
    },
    async listRcIds(projectId: string): Promise<string[]> {
      return (await client.readContract({ address, functionName: "list_rc_ids", args: [projectId] })) as unknown as string[];
    },
    async getFinding(projectId: string, gateId: string, rcId: string): Promise<GateFindingRecord> {
      return (await client.readContract({
        address,
        functionName: "get_finding",
        args: [projectId, gateId, rcId],
      })) as unknown as GateFindingRecord;
    },
    async gateIsSatisfied(projectId: string, gateId: string): Promise<boolean> {
      return (await client.readContract({
        address,
        functionName: "gate_is_satisfied",
        args: [projectId, gateId],
      })) as unknown as boolean;
    },
    async createProject(args: {
      projectId: string;
      builder: `0x${string}`;
      title: string;
      repoUrl: string;
      deployUrl: string;
      maxRcRevisions: number;
      totalPaymentAmount: bigint;
      deadline: number;
    }): Promise<`0x${string}`> {
      return client.writeContract({
        address,
        functionName: "create_project",
        args: [
          args.projectId,
          args.builder,
          args.title,
          args.repoUrl,
          args.deployUrl,
          args.maxRcRevisions,
          args.totalPaymentAmount,
          args.deadline,
        ],
        value: 0n,
      });
    },
    async addGate(args: {
      projectId: string;
      gateId: string;
      label: string;
      criterion: string;
      gateType: string;
      evidenceRequirements: string[];
      paymentBps: number;
      mandatory: boolean;
      dependencyGateId: string;
      sourcePolicy: string;
    }): Promise<`0x${string}`> {
      return client.writeContract({
        address,
        functionName: "add_gate",
        args: [
          args.projectId,
          args.gateId,
          args.label,
          args.criterion,
          args.gateType,
          args.evidenceRequirements,
          args.paymentBps,
          args.mandatory,
          args.dependencyGateId,
          args.sourcePolicy,
        ],
        value: 0n,
      });
    },
    async lockDefinition(projectId: string): Promise<`0x${string}`> {
      return client.writeContract({ address, functionName: "lock_definition", args: [projectId], value: 0n });
    },
    async cancelProject(projectId: string): Promise<`0x${string}`> {
      return client.writeContract({ address, functionName: "cancel_project", args: [projectId], value: 0n });
    },
    async syncFundingStatus(projectId: string): Promise<`0x${string}`> {
      return client.writeContract({ address, functionName: "sync_funding_status", args: [projectId], value: 0n });
    },
    async expireProject(projectId: string): Promise<`0x${string}`> {
      return client.writeContract({ address, functionName: "expire_project", args: [projectId], value: 0n });
    },
    async submitReleaseCandidate(args: {
      projectId: string;
      commitSha: string;
      repoEvidenceUrl: string;
      deploymentUrl: string;
      releaseNotesUrl: string;
      testArtifactUrl: string;
    }): Promise<`0x${string}`> {
      return client.writeContract({
        address,
        functionName: "submit_release_candidate",
        args: [
          args.projectId,
          args.commitSha,
          args.repoEvidenceUrl,
          args.deploymentUrl,
          args.releaseNotesUrl,
          args.testArtifactUrl,
        ],
        value: 0n,
      });
    },
    async evaluateGate(projectId: string, gateId: string): Promise<`0x${string}`> {
      return client.writeContract({ address, functionName: "evaluate_gate", args: [projectId, gateId], value: 0n });
    },
  };
}

export type ReleaseAdapter = ReturnType<typeof releaseAdapter>;
