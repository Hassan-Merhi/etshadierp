import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authorizeRemoteMouseControl,
  resetRemoteMouseCommandStateForTests,
} from "../server/services/remoteControlCommandService";
import {
  authorizeRemoteKeyboardControl,
  getRemoteKeyboardAuthorization,
  publishRemoteKeyboardCommand,
  publishRemoteKeyboardCommandResult,
  resetRemoteKeyboardCommandStateForTests,
  revokeRemoteKeyboardControl,
  subscribeRemoteKeyboardCommands,
  subscribeRemoteKeyboardResults,
} from "../server/services/remoteKeyboardCommandService";
import {
  getRemoteControlSession,
  registerRemoteControlTab,
  resetRemoteControlSessionStateForTests,
  startRemoteControlSession,
} from "../server/services/remoteControlSessionService";
import { restoreRemoteSupportBootDefaults, updateRemoteSupportFlags } from "../server/services/remoteSupportRuntime";
import { resetRemoteSupportRolloutForTests, updateRemoteSupportRollout } from "../server/services/remoteSupportRollout";

function buildSession() {
  const now = Date.now();
  registerRemoteControlTab({
    userId: "22",
    username: "employee",
    tabId: "erp-tab-1",
    companyId: 7,
    route: "/dashboard",
    now,
  });
  return startRemoteControlSession({
    targetUserId: "22",
    targetUsername: "employee",
    controllerUserId: "1",
    controllerUsername: "developer",
    controllerRole: "Developer",
    controllerCompanyId: 7,
    durationMs: 10 * 60 * 1000,
  });
}

function authorizeMouse(sessionId: string, now: number) {
  authorizeRemoteMouseControl({
    sessionId,
    controllerUserId: "1",
    passwordConfirmedAt: now,
    now,
  });
}

describe("remote keyboard command safety", () => {
  beforeEach(() => {
    resetRemoteSupportRolloutForTests();
    resetRemoteKeyboardCommandStateForTests();
    resetRemoteMouseCommandStateForTests();
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
    updateRemoteSupportRollout({ stage: "general" }, "remote-support-test");
  });

  afterEach(() => {
    resetRemoteKeyboardCommandStateForTests();
    resetRemoteMouseCommandStateForTests();
    resetRemoteControlSessionStateForTests();
    resetRemoteSupportRolloutForTests();
    restoreRemoteSupportBootDefaults("phase-6-test-cleanup");
  });

  it("requires active mouse control before keyboard authorization", () => {
    const session = buildSession();
    expect(() =>
      authorizeRemoteKeyboardControl({
        sessionId: session.id,
        controllerUserId: "1",
        passwordConfirmedAt: Date.now(),
      })
    ).toThrowError(expect.objectContaining({ code: "MOUSE_CONTROL_REQUIRED", statusCode: 409 }));
  });

  it("requires a fresh password confirmation and activates keyboard for at most five minutes", () => {
    const session = buildSession();
    const now = Date.now();
    authorizeMouse(session.id, now);

    expect(() =>
      authorizeRemoteKeyboardControl({
        sessionId: session.id,
        controllerUserId: "1",
        passwordConfirmedAt: now - 6 * 60 * 1000,
        now,
      })
    ).toThrowError(expect.objectContaining({ code: "PASSWORD_CONFIRMATION_REQUIRED", statusCode: 428 }));

    const authorization = authorizeRemoteKeyboardControl({
      sessionId: session.id,
      controllerUserId: "1",
      passwordConfirmedAt: now,
      now,
    });
    expect(authorization.expiresAt).toBe(now + 5 * 60 * 1000);
    expect(getRemoteControlSession(session.id)?.capabilities.keyboard).toBe(true);
    expect(getRemoteKeyboardAuthorization(session.id, "1", now + 1000)?.sessionId).toBe(session.id);
    expect(getRemoteKeyboardAuthorization(session.id, "1", authorization.expiresAt + 1)).toBeNull();
    expect(getRemoteControlSession(session.id)?.capabilities.keyboard).toBe(false);
  });

  it("accepts bounded text and only explicitly allowed keys", () => {
    const session = buildSession();
    const now = Date.now();
    authorizeMouse(session.id, now);
    authorizeRemoteKeyboardControl({
      sessionId: session.id,
      controllerUserId: "1",
      passwordConfirmedAt: now,
      now,
    });
    const listener = vi.fn();
    subscribeRemoteKeyboardCommands({
      sessionId: session.id,
      targetUserId: "22",
      targetTabId: "erp-tab-1",
      listener,
    });

    const text = publishRemoteKeyboardCommand({
      sessionId: session.id,
      controllerUserId: "1",
      type: "insert-text",
      text: "search value",
      now: now + 1,
    });
    const key = publishRemoteKeyboardCommand({
      sessionId: session.id,
      controllerUserId: "1",
      type: "key",
      key: "Backspace",
      now: now + 2,
    });

    expect(text.sequence).toBe(1);
    expect(text.text).toBe("search value");
    expect(key.sequence).toBe(2);
    expect(key.key).toBe("Backspace");
    expect(listener).toHaveBeenCalledTimes(2);

    expect(() =>
      publishRemoteKeyboardCommand({
        sessionId: session.id,
        controllerUserId: "1",
        type: "key",
        key: "Control",
        now: now + 3,
      })
    ).toThrowError(expect.objectContaining({ code: "INVALID_KEY", statusCode: 400 }));
    expect(() =>
      publishRemoteKeyboardCommand({
        sessionId: session.id,
        controllerUserId: "1",
        type: "insert-text",
        text: "x".repeat(65),
        now: now + 4,
      })
    ).toThrowError(expect.objectContaining({ code: "INVALID_KEYBOARD_TEXT", statusCode: 400 }));
    expect(() =>
      publishRemoteKeyboardCommand({
        sessionId: session.id,
        controllerUserId: "1",
        type: "insert-text",
        text: "bad\ntext",
        now: now + 5,
      })
    ).toThrowError(expect.objectContaining({ code: "INVALID_KEYBOARD_TEXT", statusCode: 400 }));
  });

  it("binds command and result streams to the exact target tab", () => {
    const session = buildSession();
    const now = Date.now();
    authorizeMouse(session.id, now);
    authorizeRemoteKeyboardControl({
      sessionId: session.id,
      controllerUserId: "1",
      passwordConfirmedAt: now,
      now,
    });

    expect(() =>
      subscribeRemoteKeyboardCommands({
        sessionId: session.id,
        targetUserId: "23",
        targetTabId: "erp-tab-1",
        listener: vi.fn(),
      })
    ).toThrowError(expect.objectContaining({ code: "TARGET_MISMATCH", statusCode: 403 }));

    subscribeRemoteKeyboardCommands({
      sessionId: session.id,
      targetUserId: "22",
      targetTabId: "erp-tab-1",
      listener: vi.fn(),
    });
    const resultListener = vi.fn();
    subscribeRemoteKeyboardResults({
      sessionId: session.id,
      controllerUserId: "1",
      listener: resultListener,
    });
    const command = publishRemoteKeyboardCommand({
      sessionId: session.id,
      controllerUserId: "1",
      type: "key",
      key: "Tab",
      now: now + 1,
    });

    expect(() =>
      publishRemoteKeyboardCommandResult({
        sessionId: session.id,
        commandId: command.id,
        targetUserId: "22",
        targetTabId: "wrong-tab",
        status: "executed",
      })
    ).toThrowError(expect.objectContaining({ code: "TARGET_MISMATCH", statusCode: 403 }));

    const result = publishRemoteKeyboardCommandResult({
      sessionId: session.id,
      commandId: command.id,
      targetUserId: "22",
      targetTabId: "erp-tab-1",
      status: "blocked",
      reason: "no-safe-editable-focus",
      now: now + 2,
    });
    expect(resultListener).toHaveBeenCalledWith(result);
  });

  it("fails closed without a target stream and rate limits command floods", () => {
    const session = buildSession();
    const now = Date.now();
    authorizeMouse(session.id, now);
    authorizeRemoteKeyboardControl({
      sessionId: session.id,
      controllerUserId: "1",
      passwordConfirmedAt: now,
      now,
    });

    expect(() =>
      publishRemoteKeyboardCommand({
        sessionId: session.id,
        controllerUserId: "1",
        type: "key",
        key: "Tab",
        now,
      })
    ).toThrowError(expect.objectContaining({ code: "TARGET_KEYBOARD_CHANNEL_UNAVAILABLE", statusCode: 409 }));

    subscribeRemoteKeyboardCommands({
      sessionId: session.id,
      targetUserId: "22",
      targetTabId: "erp-tab-1",
      listener: vi.fn(),
    });
    for (let index = 0; index < 30; index += 1) {
      publishRemoteKeyboardCommand({
        sessionId: session.id,
        controllerUserId: "1",
        type: "key",
        key: "ArrowRight",
        now: now + 100,
      });
    }
    expect(() =>
      publishRemoteKeyboardCommand({
        sessionId: session.id,
        controllerUserId: "1",
        type: "key",
        key: "ArrowRight",
        now: now + 100,
      })
    ).toThrowError(expect.objectContaining({ code: "KEYBOARD_RATE_LIMITED", statusCode: 429 }));
  });

  it("revokes keyboard without ending mouse control or passive viewing", () => {
    const session = buildSession();
    const now = Date.now();
    authorizeMouse(session.id, now);
    authorizeRemoteKeyboardControl({
      sessionId: session.id,
      controllerUserId: "1",
      passwordConfirmedAt: now,
      now,
    });

    revokeRemoteKeyboardControl({ sessionId: session.id, controllerUserId: "1" });

    const active = getRemoteControlSession(session.id);
    expect(active?.status).toBe("active");
    expect(active?.capabilities.mouse).toBe(true);
    expect(active?.capabilities.keyboard).toBe(false);
  });

  it("isolates broken keyboard command and result listeners", () => {
    const session = buildSession();
    const now = Date.now();
    authorizeMouse(session.id, now);
    authorizeRemoteKeyboardControl({
      sessionId: session.id,
      controllerUserId: "1",
      passwordConfirmedAt: now,
      now,
    });
    const healthyCommandListener = vi.fn();
    subscribeRemoteKeyboardCommands({
      sessionId: session.id,
      targetUserId: "22",
      targetTabId: "erp-tab-1",
      listener: () => {
        throw new Error("closed command stream");
      },
    });
    subscribeRemoteKeyboardCommands({
      sessionId: session.id,
      targetUserId: "22",
      targetTabId: "erp-tab-1",
      listener: healthyCommandListener,
    });
    const healthyResultListener = vi.fn();
    subscribeRemoteKeyboardResults({
      sessionId: session.id,
      controllerUserId: "1",
      listener: () => {
        throw new Error("closed result stream");
      },
    });
    subscribeRemoteKeyboardResults({
      sessionId: session.id,
      controllerUserId: "1",
      listener: healthyResultListener,
    });

    const command = publishRemoteKeyboardCommand({
      sessionId: session.id,
      controllerUserId: "1",
      type: "key",
      key: "Escape",
      now: now + 1,
    });
    const result = publishRemoteKeyboardCommandResult({
      sessionId: session.id,
      commandId: command.id,
      targetUserId: "22",
      targetTabId: "erp-tab-1",
      status: "executed",
      now: now + 2,
    });

    expect(healthyCommandListener).toHaveBeenCalledWith(command);
    expect(healthyResultListener).toHaveBeenCalledWith(result);
  });
});
