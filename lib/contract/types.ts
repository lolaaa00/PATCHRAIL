export type ProjectStatus =
  | "DRAFT"
  | "FUNDED"
  | "ACTIVE"
  | "RELEASE_CANDIDATE"
  | "ACCEPTED"
  | "EXPIRED"
  | "CANCELLED";

export type GateType =
  | "CODE_QUALITY"
  | "DOCUMENTATION"
  | "DEPLOYMENT"
  | "BEHAVIOR"
  | "SECURITY_DISCLOSURE"
  | "OTHER";

export type EvidenceRole = "repo" | "deploy" | "release" | "tests";

export type SourcePolicy =
  | "ANY_HTTPS"
  | "MUST_MATCH_PROJECT_REPO_HOST"
  | "MUST_MATCH_PROJECT_DEPLOY_HOST"
  | "MUST_MATCH_BOTH_PROJECT_HOSTS";

export type Finding = "SATISFIED" | "NOT_SATISFIED" | "INCONCLUSIVE" | "UNAVAILABLE";
export type CommitMatch = "YES" | "NO" | "UNCLEAR";
export type DeploymentRelation = "MATCHES_RC" | "STALE" | "UNRELATED" | "UNCLEAR";

export type ProjectRecord = {
  project_id: string;
  client: `0x${string}`;
  builder: `0x${string}`;
  title: string;
  repo_url: string;
  deploy_url: string;
  max_rc_revisions: number;
  gate_count: number;
  total_payment_amount: bigint;
  start_time: number;
  deadline: number;
  definition_hash: string;
  definition_locked: boolean;
  status: ProjectStatus;
  current_rc_revision: number;
  accepted_rc_id: string;
};

export type GateRecord = {
  gate_id: string;
  project_id: string;
  label: string;
  criterion: string;
  gate_type: GateType;
  evidence_requirements: EvidenceRole[];
  payment_bps: number;
  mandatory: boolean;
  dependency_gate_id: string;
  source_policy: SourcePolicy;
  order_index: number;
};

export type ReleaseCandidateRecord = {
  rc_id: string;
  project_id: string;
  revision: number;
  commit_sha: string;
  repo_evidence_url: string;
  deployment_url: string;
  release_notes_url: string;
  test_artifact_url: string;
  submitted_at: number;
  status: string;
};

export type EvidenceItemRecord = { source: EvidenceRole; excerpt: string };

export type GateFindingRecord = {
  finding_id: string;
  project_id: string;
  gate_id: string;
  rc_id: string;
  finding: Finding;
  commit_match: CommitMatch;
  deployment_relation: DeploymentRelation;
  evidence: EvidenceItemRecord[];
  reason: string;
  evaluated_at: number;
};
