import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("View Only passive lifecycle write gating", () => {
  it("allows only the exact passive presence and screen-feed writes before the View Only denial", () => {
    const auth = source("server/auth.ts");

    expect(auth).toContain('"PATCH /api/user-presence"');
    expect(auth).toContain('"DELETE /api/user-presence"');
    expect(auth).toContain('"POST /api/user-presence/leave"');
    expect(auth).toContain('"POST /api/screen-feed"');
    expect(auth).toContain('"POST /api/screen-feed/pointer"');
    expect(auth).toContain('"POST /api/screen-feed/control/tab-heartbeat"');
    expect(auth).toContain("commands\\/[^/]+\\/result$");
    expect(auth).toContain("keyboard-commands\\/[^/]+\\/result$");
    expect(auth).toContain("sessions\\/[^/]+\\/stop$");

    const lifecycleGate = auth.indexOf("if (isViewOnlyPassiveLifecycleWrite(req)) return next();");
    const viewOnlyBlock = auth.indexOf('if (role === "View Only")');
    expect(lifecycleGate).toBeGreaterThan(-1);
    expect(viewOnlyBlock).toBeGreaterThan(lifecycleGate);

    // Do not ever broaden this to all screen-feed writes: controller/admin
    // mutations still need the normal View Only write protection.
    expect(auth).not.toContain('req.path.startsWith("/api/screen-feed")');
    expect(auth).toContain("View Only accounts cannot make changes");
  });

  it("keeps route-level authentication and target authorization behind the passive exceptions", () => {
    const screenFeed = source("server/routes/screenFeedRoutes.ts");
    const control = source("server/routes/remoteControlSessionRoutes.ts");
    const keyboard = source("server/routes/remoteKeyboardControlRoutes.ts");
    const presence = source("server/routes/userPresenceRoutes.ts");

    expect(screenFeed).toContain('app.post("/api/screen-feed/pointer", requireLogin');
    expect(screenFeed).toContain('app.post("/api/screen-feed", requireLogin');
    expect(control).toContain('app.post("/api/screen-feed/control/tab-heartbeat", requireLogin');
    expect(control).toContain("targetUserId: sessionUserId(req)");
    expect(control).toContain("targetTabId: req.body?.tabId");
    expect(control).toContain("const actorIsTarget = session.targetUserId === actorUserId");
    expect(keyboard).toContain("targetUserId: sessionUserId(req)");
    expect(keyboard).toContain("targetTabId: req.body?.tabId");
    expect(presence).toContain('app.patch("/api/user-presence", requireAuth');
  });

  it("does not restart remote-support polling after auth has already been lost", () => {
    const runtime = source("client/src/components/RemoteSupportRuntime.tsx");

    expect(runtime).toContain("isRemoteSupportAuthLost");
    expect(runtime).toContain("useState(() => !isRemoteSupportAuthLost())");
    expect(runtime).toContain("subscribeRemoteSupportAuthLost");
    expect(runtime).not.toContain("resetRemoteSupportAuthLifecycle");
  });
});
