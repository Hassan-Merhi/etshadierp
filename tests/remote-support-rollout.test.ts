import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertRemoteSupportRolloutEligible,
  evaluateRemoteSupportRollout,
  getRemoteSupportRolloutSnapshot,
  resetRemoteSupportRolloutForTests,
  rollbackRemoteSupportRollout,
  updateRemoteSupportRollout,
} from "../server/services/remoteSupportRollout";
import { restoreRemoteSupportBootDefaults, updateRemoteSupportFlags } from "../server/services/remoteSupportRuntime";

describe("remote support controlled rollout", () => {
  beforeEach(() => {
    resetRemoteSupportRolloutForTests();
    updateRemoteSupportFlags(
      {
        screenFeedEnabled: true,
        fastScreenFeed: true,
        remoteControl: true,
        keyboardControl: true,
        sensitiveActionProtection: true,
      },
      "test"
    );
  });

  afterEach(() => {
    resetRemoteSupportRolloutForTests();
    restoreRemoteSupportBootDefaults("test-cleanup");
  });

  it("defaults to disabled and reports a release blocker", () => {
    const snapshot = getRemoteSupportRolloutSnapshot();
    expect(snapshot.stage).toBe("disabled");
    expect(snapshot.readiness.ready).toBe(false);
    expect(snapshot.readiness.blockers).toContain("rollout-disabled");
  });

  it("limits internal rollout to developers or explicit controllers", () => {
    updateRemoteSupportRollout({ stage: "internal", internalControllerUserIds: ["controller-2"] }, "developer");

    expect(
      evaluateRemoteSupportRollout({
        companyId: 7,
        controllerUserId: "controller-1",
        controllerRole: "Developer",
      }).allowed
    ).toBe(true);
    expect(
      evaluateRemoteSupportRollout({
        companyId: 7,
        controllerUserId: "controller-2",
        controllerRole: "Admin",
      }).allowed
    ).toBe(true);
    expect(
      evaluateRemoteSupportRollout({
        companyId: 7,
        controllerUserId: "controller-3",
        controllerRole: "Admin",
      }).code
    ).toBe("REMOTE_SUPPORT_INTERNAL_ONLY");
  });

  it("allows only configured companies during canary rollout", () => {
    updateRemoteSupportRollout({ stage: "canary", canaryCompanyIds: [9, 7, 7] }, "developer");
    expect(getRemoteSupportRolloutSnapshot().canaryCompanyIds).toEqual([7, 9]);
    expect(
      evaluateRemoteSupportRollout({
        companyId: 7,
        controllerUserId: "controller-1",
        controllerRole: "Admin",
      }).allowed
    ).toBe(true);
    expect(
      evaluateRemoteSupportRollout({
        companyId: 8,
        controllerUserId: "controller-1",
        controllerRole: "Admin",
      }).code
    ).toBe("REMOTE_SUPPORT_CANARY_COMPANY_REQUIRED");
  });

  it("allows an authorized controller in general rollout", () => {
    updateRemoteSupportRollout({ stage: "general" }, "developer");
    expect(() =>
      assertRemoteSupportRolloutEligible({
        companyId: 7,
        controllerUserId: "controller-1",
        controllerRole: "Manager",
      })
    ).not.toThrow();
  });

  it("keeps runtime safety controls stronger than rollout stage", () => {
    updateRemoteSupportRollout({ stage: "general" }, "developer");
    updateRemoteSupportFlags({ remoteControl: false }, "emergency");
    const result = evaluateRemoteSupportRollout({
      companyId: 7,
      controllerUserId: "controller-1",
      controllerRole: "Developer",
    });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("REMOTE_SUPPORT_NOT_READY");
  });

  it("rolls back to disabled without losing the reviewed canary cohort", () => {
    updateRemoteSupportRollout({ stage: "canary", canaryCompanyIds: [7] }, "developer");
    const snapshot = rollbackRemoteSupportRollout("emergency");
    expect(snapshot.stage).toBe("disabled");
    expect(snapshot.canaryCompanyIds).toEqual([7]);
    expect(snapshot.updatedBy).toBe("emergency");
  });
});
