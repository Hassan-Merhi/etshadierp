import { describe, expect, it } from "vitest";
import {
  buildRemoteSupportAuditChanges,
  remoteSupportCommandAuditDetails,
} from "../server/services/remoteSupportAuditService";
import type { RemoteControlSession } from "../server/services/remoteControlSessionService";

function session(): RemoteControlSession {
  return {
    id: "session-1",
    companyId: 7,
    targetUserId: "22",
    targetUsername: "employee",
    targetTabId: "tab-1",
    targetRoute: "/reports/sales",
    controllerUserId: "1",
    controllerUsername: "developer",
    controllerRole: "Developer",
    scope: "erp-browser-tab",
    status: "active",
    startedAt: 1000,
    expiresAt: 601000,
    lastControllerHeartbeatAt: 1000,
    lastTargetHeartbeatAt: 1000,
    stoppedAt: null,
    stopReason: null,
    capabilities: {
      mouse: true,
      keyboard: true,
      browserTabOnly: true,
    },
  };
}

describe("remote support permanent audit redaction", () => {
  it("records controller, target, route and capabilities without screen or field content", () => {
    const changes = buildRemoteSupportAuditChanges({
      event: "keyboard_command",
      session: session(),
      details: {
        capability: "keyboard",
        commandType: "insert-text",
        textLength: 12,
        sequence: 4,
        status: "requested",
        route: "/reports/sales",
      },
    });
    const serialized = JSON.stringify(changes);

    expect(changes.controllerUserId).toEqual({ new: "1" });
    expect(changes.targetUserId).toEqual({ new: "22" });
    expect(changes.targetRoute).toEqual({ new: "/reports/sales" });
    expect(changes.textLength).toEqual({ new: 12 });
    expect(changes.keyboardEnabled).toEqual({ new: true });
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("data:image");
    expect(serialized).not.toContain("fieldValue");
  });

  it("converts keyboard text to length and never returns the original value", () => {
    const secretText = "Never store this value";
    const details = remoteSupportCommandAuditDetails({
      capability: "keyboard",
      commandType: "insert-text",
      text: secretText,
      route: "/reports",
    });

    expect(details.textLength).toBe(Array.from(secretText).length);
    expect(details).not.toHaveProperty("text");
    expect(JSON.stringify(details)).not.toContain(secretText);
  });

  it("bounds routes, reasons, keys and command types", () => {
    const changes = buildRemoteSupportAuditChanges({
      event: "command_blocked",
      session: session(),
      details: {
        capability: "keyboard",
        commandType: "x".repeat(200),
        key: "y".repeat(200),
        reason: "z".repeat(500),
        route: `/${"r".repeat(500)}`,
        status: "blocked",
      },
    });

    expect(String(changes.commandType.new)).toHaveLength(80);
    expect(String(changes.key.new)).toHaveLength(80);
    expect(String(changes.reason.new)).toHaveLength(120);
    expect(String(changes.route.new)).toHaveLength(300);
  });

  it("ignores details outside the explicit metadata allowlist", () => {
    const details = {
      capability: "mouse" as const,
      status: "executed" as const,
      password: "hidden",
      fieldValue: "hidden",
      screenFrame: "data:image/jpeg;base64,AAAA",
    };
    const changes = buildRemoteSupportAuditChanges({
      event: "mouse_result",
      session: session(),
      details,
    });

    expect(changes).not.toHaveProperty("password");
    expect(changes).not.toHaveProperty("fieldValue");
    expect(changes).not.toHaveProperty("screenFrame");
  });
});
