import { z } from "zod";

const HTTPS_URL = z
  .string()
  .max(512)
  .refine((v) => v.startsWith("https://"), "must be an https:// URL")
  .refine((v) => !v.includes("#"), "must not include a fragment")
  .refine((v) => !/:\/\/[^/]*@/.test(v), "must not embed credentials")
  .refine((v) => {
    const host = v.slice("https://".length).split("/")[0]?.toLowerCase() ?? "";
    const hostOnly = host.split(":")[0] ?? "";
    const secondOctet = Number(hostOnly.split(".")[1]);
    const isPrivate172 = hostOnly.startsWith("172.") && secondOctet >= 16 && secondOctet <= 31;
    return (
      !["localhost", "127.0.0.1", "0.0.0.0", "::1"].some((f) => hostOnly === f || hostOnly.startsWith(f)) &&
      !hostOnly.startsWith("10.") &&
      !hostOnly.startsWith("192.168.") &&
      !hostOnly.startsWith("169.254.") &&
      !hostOnly.startsWith("127.") &&
      !hostOnly.startsWith("100.64.") &&
      !hostOnly.endsWith(".local") &&
      !hostOnly.endsWith(".internal") &&
      !isPrivate172
    );
    // Note: this is a string-level check on the literal host in the URL —
    // it cannot detect a public-looking hostname that a DNS rebinding attack
    // later resolves to a private address at fetch time. The contract-side
    // check (contracts/patchrail_release.py::_validate_url) has the same
    // limitation; see docs/SECURITY.md for the residual risk and why GenVM's
    // evidence fetch (not this client-side form) is the actual trust
    // boundary for anything security-relevant.
  }, "must not resolve to a private/local host");

export const idSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/, "letters, numbers, dash, underscore only");

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a valid 0x address");

export const gateTypeSchema = z.enum([
  "CODE_QUALITY",
  "DOCUMENTATION",
  "DEPLOYMENT",
  "BEHAVIOR",
  "SECURITY_DISCLOSURE",
  "OTHER",
]);

export const evidenceRoleSchema = z.enum(["repo", "deploy", "release", "tests"]);

// No unbound "ANY_HTTPS" option — every value binds evidence to a frozen
// project identity. The contract (contracts/patchrail_release.py) is the
// authoritative enforcement point and rejects this independently of the
// frontend; this schema exists so a user gets the same rejection before
// ever submitting a transaction.
export const sourcePolicySchema = z.enum([
  "MUST_MATCH_PROJECT_REPO_HOST",
  "MUST_MATCH_PROJECT_DEPLOY_HOST",
  "MUST_MATCH_BOTH_PROJECT_HOSTS",
]);

export const createProjectSchema = z
  .object({
    projectId: idSchema,
    builder: addressSchema,
    title: z.string().min(1).max(200),
    repoUrl: HTTPS_URL,
    deployUrl: HTTPS_URL,
    maxRcRevisions: z.coerce.number().int().min(1).max(20),
    totalPaymentAmount: z.string().min(1, "total payment amount is required"),
    deadline: z.coerce.number().int(),
  })
  .refine((v) => v.deadline * 1000 > Date.now(), {
    message: "deadline must be in the future",
    path: ["deadline"],
  });
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const addGateSchema = z
  .object({
    projectId: idSchema,
    gateId: idSchema,
    label: z.string().min(1).max(120),
    criterion: z.string().min(10, "criterion must state a material, checkable condition").max(1000),
    gateType: gateTypeSchema,
    evidenceRequirements: z.array(evidenceRoleSchema).min(1).max(4),
    paymentBps: z.coerce.number().int().min(1).max(10000),
    mandatory: z.literal(true),
    dependencyGateId: z.string().max(64).default(""),
    sourcePolicy: sourcePolicySchema,
  })
  .refine((v) => v.dependencyGateId !== v.gateId, {
    message: "a gate cannot depend on itself",
    path: ["dependencyGateId"],
  })
  .refine(
    (v) => {
      const needsRepoBinding = v.evidenceRequirements.some((r) => r === "repo" || r === "release" || r === "tests");
      if (!needsRepoBinding) return true;
      return v.sourcePolicy === "MUST_MATCH_PROJECT_REPO_HOST" || v.sourcePolicy === "MUST_MATCH_BOTH_PROJECT_HOSTS";
    },
    {
      message: "a gate requiring repo/release/tests evidence must use a source_policy that binds it to the registered repository",
      path: ["sourcePolicy"],
    },
  )
  .refine(
    (v) => {
      const needsDeployBinding = v.evidenceRequirements.includes("deploy");
      if (!needsDeployBinding) return true;
      return v.sourcePolicy === "MUST_MATCH_PROJECT_DEPLOY_HOST" || v.sourcePolicy === "MUST_MATCH_BOTH_PROJECT_HOSTS";
    },
    {
      message: "a gate requiring deploy evidence must use a source_policy that binds it to the registered deployment origin",
      path: ["sourcePolicy"],
    },
  );
export type AddGateInput = z.infer<typeof addGateSchema>;

export const submitRcSchema = z.object({
  projectId: idSchema,
  commitSha: z
    .string()
    .min(7, "commit_sha must be at least 7 characters")
    .max(64)
    .regex(/^[0-9a-fA-F]+$/, "commit_sha must be a hexadecimal git hash"),
  repoEvidenceUrl: HTTPS_URL,
  deploymentUrl: HTTPS_URL,
  releaseNotesUrl: HTTPS_URL,
  testArtifactUrl: z.union([HTTPS_URL, z.literal("")]),
});
export type SubmitRcInput = z.infer<typeof submitRcSchema>;

export const evaluateGateSchema = z.object({
  projectId: idSchema,
  gateId: idSchema,
});
export type EvaluateGateInput = z.infer<typeof evaluateGateSchema>;

export const gateBpsSumSchema = z
  .array(z.number().int().min(1).max(10000))
  .refine((bpsList) => bpsList.reduce((a, b) => a + b, 0) === 10000, {
    message: "gate payment_bps must sum exactly to 10000",
  });
