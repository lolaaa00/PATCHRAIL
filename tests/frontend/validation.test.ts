import { describe, expect, it } from "vitest";
import { createProjectSchema, addGateSchema, submitRcSchema, gateBpsSumSchema, idSchema } from "@/lib/validation/schemas";

const FUTURE = Math.floor(Date.now() / 1000) + 100000;

describe("idSchema", () => {
  it("accepts safe ids", () => {
    expect(idSchema.safeParse("acme-billing_v2").success).toBe(true);
  });
  it("rejects ids with unsafe characters", () => {
    expect(idSchema.safeParse("acme billing!").success).toBe(false);
  });
});

describe("createProjectSchema", () => {
  const base = {
    projectId: "p1",
    builder: "0x1111111111111111111111111111111111111111",
    title: "Title",
    repoUrl: "https://github.com/org/repo",
    deployUrl: "https://app.example.com",
    maxRcRevisions: 3,
    totalPaymentAmount: "1000",
    deadline: FUTURE,
  };

  it("accepts a valid project", () => {
    expect(createProjectSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a non-https repo URL", () => {
    expect(createProjectSchema.safeParse({ ...base, repoUrl: "http://github.com/org/repo" }).success).toBe(false);
  });

  it("rejects a private-host deploy URL", () => {
    expect(createProjectSchema.safeParse({ ...base, deployUrl: "https://localhost:3000" }).success).toBe(false);
  });

  it("rejects a 172.16.0.0/12 private-range deploy URL", () => {
    expect(createProjectSchema.safeParse({ ...base, deployUrl: "https://172.20.0.5" }).success).toBe(false);
  });

  it("accepts a 172.x host outside the private /12 range", () => {
    expect(createProjectSchema.safeParse({ ...base, deployUrl: "https://172.99.0.5" }).success).toBe(true);
  });

  it("rejects a CGNAT (100.64.0.0/10) deploy URL", () => {
    expect(createProjectSchema.safeParse({ ...base, deployUrl: "https://100.64.1.1" }).success).toBe(false);
  });

  it("rejects a deadline in the past", () => {
    expect(createProjectSchema.safeParse({ ...base, deadline: Math.floor(Date.now() / 1000) - 10 }).success).toBe(false);
  });
});

describe("addGateSchema", () => {
  const base = {
    projectId: "p1",
    gateId: "quality",
    label: "Quality",
    criterion: "Code must pass CI with no TODOs left",
    gateType: "CODE_QUALITY" as const,
    evidenceRequirements: ["repo" as const],
    paymentBps: 2500,
    mandatory: true as const,
    dependencyGateId: "",
    sourcePolicy: "MUST_MATCH_BOTH_PROJECT_HOSTS" as const,
  };

  it("accepts a valid gate", () => {
    expect(addGateSchema.safeParse(base).success).toBe(true);
  });

  it("rejects an optional (non-mandatory) gate", () => {
    expect(addGateSchema.safeParse({ ...base, mandatory: false }).success).toBe(false);
  });

  it("rejects a free-text source policy", () => {
    expect(addGateSchema.safeParse({ ...base, sourcePolicy: "some free text" }).success).toBe(false);
  });

  it("rejects a gate depending on itself", () => {
    expect(addGateSchema.safeParse({ ...base, dependencyGateId: "quality" }).success).toBe(false);
  });

  it("rejects a criterion that is too short", () => {
    expect(addGateSchema.safeParse({ ...base, criterion: "ok" }).success).toBe(false);
  });
});

describe("gateBpsSumSchema", () => {
  it("accepts bps summing to exactly 10000", () => {
    expect(gateBpsSumSchema.safeParse([2500, 1500, 3000, 3000]).success).toBe(true);
  });
  it("rejects bps summing to anything else", () => {
    expect(gateBpsSumSchema.safeParse([2500, 1500, 3000, 2999]).success).toBe(false);
    expect(gateBpsSumSchema.safeParse([2500, 1500, 3000, 3001]).success).toBe(false);
  });
});

describe("submitRcSchema", () => {
  const base = {
    projectId: "p1",
    commitSha: "abc1234deadbeef",
    repoEvidenceUrl: "https://github.com/org/repo/commit/abc1234",
    deploymentUrl: "https://app.example.com/build/1",
    releaseNotesUrl: "https://github.com/org/repo/releases/tag/v1",
    testArtifactUrl: "",
  };
  it("accepts a valid RC", () => {
    expect(submitRcSchema.safeParse(base).success).toBe(true);
  });
  it("rejects a non-hex commit sha", () => {
    expect(submitRcSchema.safeParse({ ...base, commitSha: "not-a-hash!" }).success).toBe(false);
  });
  it("rejects a too-short commit sha", () => {
    expect(submitRcSchema.safeParse({ ...base, commitSha: "abc12" }).success).toBe(false);
  });
});
