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

  // The fast transport ships dark. "Phase 5 complete faster remote viewing transport" (6ad040e)
  // moved the boot default from !HARD_DISABLED to false without updating this expectation, leaving
  // the suite asserting a default the runtime no longer had. Off is the safer of the two — the fast
  // path is opt-in per deployment rather than enabled for everyone on upgrade — so the runtime keeps
  // its default and the assertion follows it. Flipping it back on is a product decision, not a
  // test fix.
  it("leaves every remote-support capability opt-in by default", () => {
    const snapshot = getRemoteSupportRuntimeSnapshot();

    expect(snapshot.flags.fastScreenFeed).toBe(false);
    expect(snapshot.flags.remoteControl).toBe(false);
    expect(snapshot.flags.keyboardControl).toBe(false);
    expect(snapshot.flags.sensitiveActionProtection).toBe(true);
  });

  it("still enables the fast feed when an operator turns it on", () => {
    const snapshot = updateRemoteSupportFlags({ fastScreenFeed: true }, "test");

    expect(snapshot.flags.fastScreenFeed).toBe(true);
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

  it("records polling and live feed measurements", () => {
    recordRemoteSupportMetric("watcherStatusPoll");
    recordRemoteSupportMetric("viewerPoll");
    recordRemoteSupportMetric("liveStatusConnected");
    recordRemoteSupportMetric("liveViewerConnected");
    recordRemoteSupportMetric("frameAccepted", 1200);
    recordRemoteSupportMetric("frameAccepted", 800);
    recordRemoteSupportMetric("framePushed", 2);
    recordRemoteSupportMetric("frameRejected");

    const metrics = getRemoteSupportRuntimeSnapshot().metrics;

    expect(metrics.watcherStatusPolls).toBe(1);
    expect(metrics.viewerPolls).toBe(1);
    expect(metrics.liveStatusConnections).toBe(1);
    expect(metrics.liveViewerConnections).toBe(1);
    expect(metrics.framesAccepted).toBe(2);
    expect(metrics.framesRejected).toBe(1);
    expect(metrics.framesPushed).toBe(2);
    expect(metrics.totalFrameBytes).toBe(2000);
    expect(metrics.averageFrameBytes).toBe(1000);
    expect(metrics.lastFrameBytes).toBe(800);
  });
});
