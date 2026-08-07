import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

const controllerContext = read("client/src/components/RemoteControllerSessionContext.tsx");
const watchdog = read("client/src/components/RemoteControlSessionWatchdog.tsx");
const mouseController = read("client/src/components/RemoteMouseControllerOverlay.tsx");
const keyboardController = read("client/src/components/RemoteKeyboardControllerOverlay.tsx");
const mouseTarget = read("client/src/components/RemoteMouseControlTarget.tsx");
const keyboardTarget = read("client/src/components/RemoteKeyboardControlTarget.tsx");
const controllerTargetRoute = read("server/routes/remoteControllerTargetRoute.ts");
const screenFeedRoutes = read("server/routes/screenFeedRoutes.ts");
const screenFeedService = read("server/services/screenFeedService.ts");

describe("remote support Phase 4 control reliability contracts", () => {
  it("binds the controller to the exact watched user with one shared session source", () => {
    expect(controllerContext).toContain("controller-target/${encodeURIComponent(activeTarget.userId)}");
    expect(controllerTargetRoute).toContain("candidate.targetUserId === targetUserId");
    expect(controllerTargetRoute).toContain("candidate.companyId === companyId");
    expect(mouseController).not.toContain("sessions[0]");
    expect(keyboardController).not.toContain("sessions[0]");
    expect(mouseController).not.toContain("useQuery");
    expect(keyboardController).not.toContain("useQuery");
    expect(watchdog).toContain("useRemoteControllerSession");
  });

  it("coalesces high-volume controller input while keeping actions ordered", () => {
    expect(mouseController).toContain("POINTER_COALESCE_MS = 125");
    expect(mouseController).toContain("SCROLL_COALESCE_MS = 100");
    expect(mouseController).toContain("commandTailRef.current");
    expect(keyboardController).toContain("TEXT_BATCH_DELAY_MS = 45");
    expect(keyboardController).toContain("MAX_TEXT_BATCH_CODE_POINTS = 32");
    expect(keyboardController).toContain("commandTailRef.current");
  });

  it("keeps target command streams stable and rejects replayed commands", () => {
    expect(mouseTarget).toContain("duplicate-command");
    expect(mouseTarget).toContain("lastSequenceRef");
    expect(keyboardTarget).toContain("duplicate-command");
    expect(keyboardTarget).toContain("lastSequenceRef");
    expect(mouseTarget).not.toContain("[session, tabId]");
    expect(keyboardTarget).not.toContain("[session, tabId]");
  });

  it("treats pointer telemetry as recoverable and tolerates browser clock skew", () => {
    expect(screenFeedService).toContain("MAX_POINTER_CLOCK_SKEW_MS = 5 * 60 * 1000");
    expect(screenFeedService).toContain("clampedNormalizedCoordinate");
    expect(screenFeedRoutes).toContain('app.post("/api/screen-feed/pointer"');
    expect(screenFeedRoutes).toContain("if (!cursor) return res.status(204).end()");
    expect(screenFeedRoutes).not.toContain('res.status(400).json({ message: "Invalid pointer update." })');
  });

  it("cleans up the owned support session when the watched target changes or closes", () => {
    expect(controllerContext).toContain('reason: "controller-viewer-closed"');
    expect(controllerContext).toContain('document.visibilityState !== "visible"');
    expect(watchdog).toContain("HEARTBEAT_INTERVAL_MS = 5000");
  });
});
