import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveReleaseIdentity } from "../server/releaseIdentityPolicy.mjs";
import {
  createReleaseEvidence,
  validateReleaseEvidence,
} from "../scripts/releaseEvidencePolicy.mjs";

const root = path.resolve(process.cwd());
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");
const policy = JSON.parse(read("config/release-readiness.json"));
const COMMIT = "1234567890abcdef1234567890abcdef12345678";

function completeEvidence() {
  const evidence = createReleaseEvidence(policy, COMMIT);
  evidence.release.deployedCommitSha = COMMIT;
  evidence.release.releaseId = "erp-2026-07-30";
  evidence.release.deploymentId = "render-deploy-123";
  evidence.release.previousHealthyDeployment = "render-deploy-122";

  for (const result of Object.values(evidence.checks) as Array<any>) {
    result.status = "passed";
    result.completedAt = "2026-07-30T10:00:00.000Z";
    result.evidence = "Recorded command output artifact";
  }
  for (const result of Object.values(evidence.sections) as Array<any>) {
    result.status = "passed";
    result.completedAt = "2026-07-30T10:05:00.000Z";
    result.evidence = "Reviewed operator evidence";
  }
  for (const result of Object.values(evidence.smokeModules) as Array<any>) {
    result.status = "passed";
    result.completedAt = "2026-07-30T10:10:00.000Z";
    result.evidence = "Smoke result recorded";
  }
  evidence.approval.approver = "release-owner";
  evidence.approval.approvedAt = "2026-07-30T10:15:00.000Z";
  evidence.approval.rollbackOwner = "rollback-owner";
  return evidence;
}

describe("Phase 13 release identity", () => {
  it("accepts and verifies the exact approved runtime commit", () => {
    expect(
      resolveReleaseIdentity(
        {
          NODE_ENV: "production",
          RENDER_GIT_COMMIT: COMMIT,
          RELEASE_EXPECTED_COMMIT: COMMIT,
          RELEASE_ID: "erp-2026-07-30",
        },
        true,
      ),
    ).toEqual({
      commitSha: COMMIT,
      expectedCommitSha: COMMIT,
      commitVerified: true,
      releaseId: "erp-2026-07-30",
    });
  });

  it("requires an approved commit for every production startup", () => {
    expect(() =>
      resolveReleaseIdentity(
        {
          NODE_ENV: "production",
          RENDER_GIT_COMMIT: COMMIT,
        },
        true,
      ),
    ).toThrow("RELEASE_EXPECTED_COMMIT is required in production");
  });

  it("fails closed when the deployed commit differs from approval", () => {
    expect(() =>
      resolveReleaseIdentity(
        {
          NODE_ENV: "production",
          RENDER_GIT_COMMIT: COMMIT,
          RELEASE_EXPECTED_COMMIT: "abcdef1234567890abcdef1234567890abcdef12",
        },
        true,
      ),
    ).toThrow("does not match approved release commit");
  });

  it("rejects abbreviated commit identities and unsafe release IDs", () => {
    expect(() =>
      resolveReleaseIdentity(
        {
          RENDER_GIT_COMMIT: "12345678",
          RELEASE_EXPECTED_COMMIT: COMMIT,
        },
        true,
      ),
    ).toThrow("full 40-character Git SHA");
    expect(() =>
      resolveReleaseIdentity({ RELEASE_ID: "release id with spaces" }, false),
    ).toThrow("letters, numbers, dots, underscores, and hyphens");
  });
});

describe("Phase 13 release evidence", () => {
  it("creates an intentionally incomplete template", () => {
    const evidence = createReleaseEvidence(policy, COMMIT);
    expect(evidence.release.commitSha).toBe(COMMIT);
    expect(evidence.checks["production-build"].command).toBe("npm run build");
    expect(validateReleaseEvidence(evidence, policy).length).toBeGreaterThan(0);
  });

  it("accepts complete evidence for the exact deployed commit", () => {
    expect(validateReleaseEvidence(completeEvidence(), policy)).toEqual([]);
  });

  it("rejects changed commands, dangerous controls and commit drift", () => {
    const evidence = completeEvidence();
    evidence.checks["production-build"].command = "npm run build --skip-checks";
    evidence.dangerousControls.autoDeployEnabled = true;
    evidence.release.deployedCommitSha = "abcdef1234567890abcdef1234567890abcdef12";

    const failures = validateReleaseEvidence(evidence, policy);
    expect(failures).toContain("checks.production-build.command must remain npm run build");
    expect(failures).toContain("dangerousControls.autoDeployEnabled must be false");
    expect(failures).toContain("release.deployedCommitSha must match release.commitSha");
  });
});

describe("Phase 13 deployment contracts", () => {
  it("requires manual Render promotion and the database-aware health endpoint", () => {
    const render = read("render.yaml");
    expect(render).toContain("autoDeploy: false");
    expect(render).toContain("healthCheckPath: /api/health/ready");
    expect(render).toContain("value: 20.19.2");
    for (const key of policy.requiredManualRenderEnvironmentKeys) {
      expect(render).toContain(`key: ${key}`);
    }
    expect(render.match(/sync: false/g)).toHaveLength(policy.requiredManualRenderEnvironmentKeys.length);
    for (const key of policy.forbiddenRenderEnvironmentKeys) {
      expect(render).not.toContain(`key: ${key}`);
    }
  });

  it("keeps dangerous operations outside startup", () => {
    const packageJson = JSON.parse(read("package.json"));
    expect(packageJson.scripts.start).not.toContain("run-versioned-migrations");
    expect(packageJson.scripts.start).not.toContain("historical-replay");
    expect(packageJson.scripts.start).not.toContain("MASTER_PASSWORD");
  });

  it("freezes the reviewed migration debt rather than permitting new warnings", () => {
    const debt = JSON.parse(read("config/migration-registry-debt.json"));
    expect(debt.legacyMissingRegisteredTags.map((entry: any) => entry.tag)).toEqual([
      "0000_conscious_william_stryker",
      "0001_parallel_guardian",
      "0002_married_loa",
    ]);
    expect(debt.approvedUnregisteredSqlFiles.map((entry: any) => entry.file)).toEqual([
      "20260717_factory_recalc_undo_log.sql",
      "20260717_phase3_heavy_read_indexes.sql",
      "20260718_post_offload_charge_edit_undo.sql",
      "20260720_001_financial_close_audit.sql",
      "20260721_001_factory_mix_batch_sources_inventory_supplier.sql",
      "20260721_fix_pos_location_pool_crash.sql",
    ]);
  });

  it("removes the stale automatic production-ready declaration", () => {
    const checklist = read("docs/production-deployment-checklist.md");
    expect(checklist).not.toContain("✅ READY FOR DEPLOYMENT");
    expect(checklist).not.toContain("No `render.yaml` is present");
    expect(checklist).toContain("No release is ready until evidence verification passes");
  });
});
