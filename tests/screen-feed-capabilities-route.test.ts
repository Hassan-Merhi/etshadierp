import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/auth", () => ({
  requireAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireLogin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../server/lib/permissionMiddleware", () => ({
  requireActionAccess: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { registerScreenFeedRoutes } = await import("../server/routes/screenFeedRoutes");
const { restoreRemoteSupportBootDefaults, updateRemoteSupportFlags } =
  await import("../server/services/remoteSupportRuntime");

function appForRole(role: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as Request & { session: Record<string, unknown> }).session = {
      userId: "42",
      username: "watcher",
      currentRole: role,
      currentCompanyId: 1,
    };
    next();
  });
  registerScreenFeedRoutes(app);
  return app;
}

describe("screen feed capabilities endpoint", () => {
  afterEach(() => {
    restoreRemoteSupportBootDefaults("test");
  });

  it("lets every authorized support controller read the transport capabilities", async () => {
    // Managers, Owners and Admins watch employees too. Gating this behind the
    // Developer-only admin runtime snapshot silently pinned them to polling.
    for (const role of ["Developer", "Admin", "Owner", "Manager"]) {
      const response = await request(appForRole(role)).get("/api/screen-feed/capabilities");
      expect(response.status, role).toBe(200);
      expect(response.body.flags, role).toMatchObject({ screenFeedEnabled: expect.any(Boolean) });
    }
  });

  it("refuses roles that cannot control a support session", async () => {
    const response = await request(appForRole("Employee")).get("/api/screen-feed/capabilities");
    expect(response.status).toBe(403);
  });

  it("reports the live transport as available only when it is actually on", async () => {
    updateRemoteSupportFlags({ screenFeedEnabled: true, fastScreenFeed: true }, "test");
    let response = await request(appForRole("Manager")).get("/api/screen-feed/capabilities");
    expect(response.body.flags.fastScreenFeed).toBe(true);

    updateRemoteSupportFlags({ fastScreenFeed: false }, "test");
    response = await request(appForRole("Manager")).get("/api/screen-feed/capabilities");
    expect(response.body.flags.fastScreenFeed).toBe(false);

    updateRemoteSupportFlags({ screenFeedEnabled: false }, "test");
    response = await request(appForRole("Manager")).get("/api/screen-feed/capabilities");
    expect(response.body.flags).toMatchObject({ screenFeedEnabled: false, fastScreenFeed: false });
  });

  it("does not expose the capability probe as a watched user lookup", async () => {
    // The generic /api/screen-feed/:userId frame route is registered later, so
    // the literal path must keep winning.
    const response = await request(appForRole("Manager")).get("/api/screen-feed/capabilities");
    expect(response.body).not.toHaveProperty("dataUrl");
  });
});
