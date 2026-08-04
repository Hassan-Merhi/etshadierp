import { describe, expect, it } from "vitest";
import type { RemoteControlSessionView } from "@/hooks/use-remote-control-session";
import { shouldShowRemoteSupportIndicator } from "./remote-support-indicator-policy";

function session(mouse: boolean, status: RemoteControlSessionView["status"] = "active") {
  return {
    id: "session-1",
    targetUserId: "22",
    targetUsername: "employee",
    targetTabId: "tab-1",
    controllerUserId: "1",
    controllerUsername: "developer",
    controllerRole: "Developer",
    scope: "erp-browser-tab",
    status,
    startedAt: "2026-08-04T06:00:00.000Z",
    expiresAt: "2026-08-04T06:10:00.000Z",
    stoppedAt: status === "active" ? null : "2026-08-04T06:05:00.000Z",
    stopReason: status === "active" ? null : "stopped",
    capabilities: {
      mouse,
      keyboard: false,
      browserTabOnly: true,
    },
  } satisfies RemoteControlSessionView;
}

describe("remote support active indicator policy", () => {
  it("hides the indicator during passive screen viewing", () => {
    expect(shouldShowRemoteSupportIndicator(session(false))).toBe(false);
    expect(shouldShowRemoteSupportIndicator(null)).toBe(false);
  });

  it("shows the indicator only while mouse control is active", () => {
    expect(shouldShowRemoteSupportIndicator(session(true))).toBe(true);
    expect(shouldShowRemoteSupportIndicator(session(true, "stopped"))).toBe(false);
    expect(shouldShowRemoteSupportIndicator(session(true, "expired"))).toBe(false);
  });
});
