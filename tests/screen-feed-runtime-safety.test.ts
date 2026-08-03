import { beforeEach, describe, expect, it } from "vitest";
import {
  emergencyDisableRemoteSupport,
  getRemoteSupportRuntimeSnapshot,
  recordRemoteSupportMetric,
  resetRemoteSupportMetrics,
  restoreRemoteSupportBootDefaults,
  updateRemoteSupportFlags,
} from "../server/services/remoteSupportRuntime";

describe("screen feed runtime safety", () => {
  beforeEach(() => {
    restoreRemoteSupportBootDefaults("test");
    resetRemoteSupportMetrics();
  });

  it("keeps all future capabilities off by default", () => {
    const snapshot = getRemoteSupportRuntimeSnapshot();

    expect(snapshot.flags.fastScreenFeed).toBe(false);
    expect(snapshot.flags.remoteControl).toBe(false);
    expect(snapshot.flags.keyboardControl).toBe(false);
    expect(snapshot.flags.sensitiveActionProtection).toBe(true);
  });

  it("turns dependent capabilities off with the screen feed", () => {
    const snapshot = updateRemoteSupportFlags({ screenFeedEnabled: false }, "test");

    expect(snapshot.flags.screenFeedEnabled).toBe(false);
    expect(snapshot.flags.fastScreenFeed).toBe(false);
    expect(snapshot.flags.remoteControl).toBe(false);
    expect(snapshot.flags.keyboardControl).toBe(false);
  });

  it("provides an immediate rollback", () => {
    const snapshot = emergencyDisableRemoteSupport("developer");

    expect(snapshot.flags).toEqual({
      screenFeedEnabled: false,
      fastScreenFeed: false,
      remoteControl: false,
      keyboardControl: false,
      sensitiveActionProtection: true,
    });
    expect(snapshot.updatedBy).toBe("developer");
  });

  it("records lightweight feed measurements", () => {
    recordRemoteSupportMetric("watcherStatusPoll");
    recordRemoteSupportMetric("viewerPoll");
    recordRemoteSupportMetric("frameAccepted", 1200);
    recordRemoteSupportMetric("frameAccepted", 800);
    recordRemoteSupportMetric("frameRejected");

    const metrics = getRemoteSupportRuntimeSnapshot().metrics;

    expect(metrics.watcherStatusPolls).toBe(1);
    expect(metrics.viewerPolls).toBe(1);
    expect(metrics.framesAccepted).toBe(2);
    expect(metrics.framesRejected).toBe(1);
    expect(metrics.totalFrameBytes).toBe(2000);
    expect(metrics.averageFrameBytes).toBe(1000);
    expect(metrics.lastFrameBytes).toBe(800);
  });
});
