import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RemoteControlSessionError,
  cleanupRemoteControlState,
  getActiveRemoteControlSession,
  heartbeatRemoteControlController,
  isRemoteControlControllerRole,
  registerRemoteControlTab,
  resetRemoteControlSessionStateForTests,
  setRemoteControlKeyboardCapability,
  setRemoteControlMouseCapability,
  startRemoteControlSession,
  stopRemoteControlSession,
} from "../server/services/remoteControlSessionService";
import { restoreRemoteSupportBootDefaults, updateRemoteSupportFlags } from "../server/services/remoteSupportRuntime";

const now = Date.now();

function registerTab(userId = "22", tabId = "erp-tab-1") {
  return registerRemoteControlTab({
    userId,
    username: `user-${userId}`,
    tabId,
    route: "/dashboard",
    now,
  });
}

function startSession(controllerUserId = "1", targetUserId = "22") {
  return startRemoteControlSession({
    targetUserId,
    targetUsername: `user-${targetUserId}`,
    controllerUserId,
    controllerUsername: `developer-${controllerUserId}`,
    controllerRole: "Developer",
    durationMs: 5 * 60 * 1000,
  });
}

describe("remote control session safety", () => {
  beforeEach(() => {
    resetRemoteControlSessionStateForTests();
    updateRemoteSupportFlags(
      {
        screenFeedEnabled: true,
        fastScreenFeed: true,
        remoteControl: true,
        keyboardControl: true,
        sensitiveActionProtection: true,
      },
      "phase-6-test"
    );
  });

  afterEach(() => {
    resetRemoteControlSessionStateForTests();
    restoreRemoteSupportBootDefaults("phase-6-test-cleanup");
  });

  it("allows only configured controller roles", () => {
    expect(isRemoteControlControllerRole("Developer")).toBe(true);
    expect(isRemoteControlControllerRole("Admin")).toBe(false);
    expect(() =>
      startRemoteControlSession({
        targetUserId: "22",
        controllerUserId: "3",
        controllerUsername: "admin",
        controllerRole: "Admin",
      })
    ).toThrow(RemoteControlSessionError);
  });

  it("binds a passive session to one active ERP browser tab", () => {
    registerTab("22", "erp-tab-1");
    registerRemoteControlTab({
      userId: "22",
      username: "user-22",
      tabId: "erp-tab-2",
      route: "/dashboard",
      now: now + 1,
    });
    const session = startSession();

    expect(session.scope).toBe("erp-browser-tab");
    expect(session.targetTabId).toBe("erp-tab-2");
    expect(session.capabilities).toEqual({ mouse: false, keyboard: false, browserTabOnly: true });
    expect(getActiveRemoteControlSession("22", "erp-tab-2")?.id).toBe(session.id);
    expect(getActiveRemoteControlSession("22", "erp-tab-1")).toBeNull();
  });

  it("enforces mouse before keyboard and disables keyboard with mouse", () => {
    registerTab();
    const session = startSession();

    expect(setRemoteControlKeyboardCapability(session.id, true)).toBeNull();
    expect(setRemoteControlMouseCapability(session.id, true)?.capabilities.mouse).toBe(true);
    expect(setRemoteControlKeyboardCapability(session.id, true)?.capabilities.keyboard).toBe(true);
    expect(getActiveRemoteControlSession("22")?.capabilities).toMatchObject({ mouse: true, keyboard: true });

    const mouseStopped = setRemoteControlMouseCapability(session.id, false);
    expect(mouseStopped?.capabilities).toMatchObject({ mouse: false, keyboard: false });
  });

  it("disables active keyboard capability when the runtime flag is turned off", () => {
    registerTab();
    const session = startSession();
    setRemoteControlMouseCapability(session.id, true);
    setRemoteControlKeyboardCapability(session.id, true);

    updateRemoteSupportFlags({ keyboardControl: false }, "test-disable-keyboard");
    cleanupRemoteControlState(now + 1000);

    expect(getActiveRemoteControlSession("22")?.capabilities).toMatchObject({ mouse: true, keyboard: false });
  });

  it("prevents two different controllers from controlling the same user", () => {
    registerTab();
    startSession("1");
    expect(() => startSession("2")).toThrowError(
      expect.objectContaining({ code: "TARGET_ALREADY_CONTROLLED", statusCode: 409 })
    );
  });

  it("keeps reconnects by the same controller idempotent", () => {
    registerTab();
    const first = startSession("1");
    const second = startSession("1");
    expect(second.id).toBe(first.id);
  });

  it("supports controller heartbeat, target stop, and automatic expiration", () => {
    registerTab();
    const session = startSession();
    setRemoteControlMouseCapability(session.id, true);
    setRemoteControlKeyboardCapability(session.id, true);
    expect(heartbeatRemoteControlController(session.id, "1", now + 5000)?.id).toBe(session.id);

    const stopped = stopRemoteControlSession(session.id, "target-emergency-stop", now + 6000);
    expect(stopped?.status).toBe("stopped");
    expect(stopped?.capabilities).toMatchObject({ mouse: false, keyboard: false });
    expect(stopped?.stopReason).toBe("target-emergency-stop");
    expect(getActiveRemoteControlSession("22")).toBeNull();

    registerTab("23", "erp-tab-3");
    const expiring = startSession("1", "23");
    cleanupRemoteControlState(expiring.expiresAt + 1);
    expect(getActiveRemoteControlSession("23")).toBeNull();
  });

  it("refuses to start without a live ERP browser tab", () => {
    expect(() => startSession()).toThrowError(
      expect.objectContaining({ code: "TARGET_TAB_UNAVAILABLE", statusCode: 409 })
    );
  });
});
