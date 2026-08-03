import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const routeSource = fs.readFileSync(
  path.join(process.cwd(), "server/routes/screenFeedRoutes.ts"),
  "utf8"
);

const runtimeSource = fs.readFileSync(
  path.join(process.cwd(), "server/services/remoteSupportRuntime.ts"),
  "utf8"
);

describe("remote support Phase 2 fast transport safety", () => {
  it("keeps fast transport behind the Phase 1 runtime flag", () => {
    expect(routeSource).toContain('isRemoteSupportEnabled("fastScreenFeed")');
    expect(runtimeSource).toMatch(/fastScreenFeed:\s*false/);
  });

  it("preserves the legacy endpoint and adds conditional transfer savings", () => {
    expect(routeSource).toContain('app.get("/api/screen-feed/:userId"');
    expect(routeSource).toContain('req.headers["if-none-match"] === etag');
    expect(routeSource).toContain("res.status(304).end()");
    expect(routeSource).toContain('"legacy"');
  });

  it("enforces Developer-only viewing and bounded identifiers", () => {
    expect(routeSource).toContain("if (!requireDeveloper(req, res)) return;");
    expect(routeSource).toContain("MAX_USER_ID_LENGTH");
    expect(routeSource).toContain("isValidWatchedUserId");
  });

  it("enforces payload and producer backpressure limits", () => {
    expect(routeSource).toContain("FAST_MAX_FRAME_SIZE");
    expect(routeSource).toContain("FAST_MIN_UPLOAD_INTERVAL_MS");
    expect(routeSource).toContain("res.status(429)");
    expect(routeSource).toContain("res.status(413)");
  });

  it("retains the emergency stop and clears fast transport state", () => {
    expect(routeSource).toContain('app.post("/api/screen-feed/admin/runtime/emergency-stop"');
    expect(routeSource).toContain("lastFastUploadAt.clear()");
    expect(routeSource).toContain("watcherPollStore.clear()");
  });
});
