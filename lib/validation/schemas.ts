import { z } from "zod";

const HTTPS_URL = z
  .string()
  .max(512)
  .refine((v) => v.startsWith("https://"), "must be an https:// URL")
  .refine((v) => !v.includes("#"), "must not include a fragment")
  .refine((v) => !/:\/\/[^/]*@/.test(v), "must not embed credentials")
  .refine((v) => {
    const host = v.slice("https://".length).split("/")[0]?.toLowerCase() ?? "";
    return (
      !["localhost", "127.0.0.1", "0.0.0.0", "::1"].some((f) => host === f || host.startsWith(f)) &&
      !host.startsWith("10.") &&
      !host.startsWith("192.168.") &&
      !host.startsWith("169.254.") &&
      !host.startsWith("127.")
    );
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
    mandatory: z.boolean(),
    dependencyGateId: z.string().max(64).default(""),
    sourcePolicy: z.string().min(1).max(300),
  })
  .refine((v) => v.dependencyGateId !== v.gateId, {
    message: "a gate cannot depend on itself",
    path: ["dependencyGateId"],
  });
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
