import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { browserMutationFailClosedBoundary } from "../server/security/browserMutationBoundary";

const TEST_CSRF_TOKEN = "csrf-token-for-browser-boundary-tests";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.header("X-Test-User");
    if (userId) {
      const csrfToken = req.header("X-Test-Session-Csrf");
      Object.defineProperty(req, "session", {
        configurable: true,
        value: {
          userId,
          ...(csrfToken ? { csrfToken } : {}),
        },
      });
    }
    next();
  });
  app.use(browserMutationFailClosedBoundary);
  app.post("/api/test-mutation", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("browser mutation fail-closed boundary", () => {
  it("rejects opaque browser origins instead of treating them as native clients", async () => {
    const response = await request(buildApp())
      .post("/api/test-mutation")
      .set("X-Test-User", "security-test-user")
      .set("Origin", "null")
      .send({ value: 1 });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("CSRF_ORIGIN_INVALID");
  });

  it("requires the established session CSRF token for authenticated same-origin browser mutations", async () => {
    const response = await request(buildApp())
      .post("/api/test-mutation")
      .set("Host", "127.0.0.1")
      .set("X-Test-User", "security-test-user")
      .set("Origin", "http://127.0.0.1")
      .send({ value: 1 });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("CSRF_TOKEN_REQUIRED");
  });

  it("allows authenticated same-origin browser mutations with the exact session CSRF token", async () => {
    const response = await request(buildApp())
      .post("/api/test-mutation")
      .set("Host", "127.0.0.1")
      .set("X-Test-User", "security-test-user")
      .set("X-Test-Session-Csrf", TEST_CSRF_TOKEN)
      .set("Origin", "http://127.0.0.1")
      .set("X-CSRF-Token", TEST_CSRF_TOKEN)
      .send({ value: 1 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it("keeps authenticated native clients compatible when Origin and Referer are absent", async () => {
    const response = await request(buildApp())
      .post("/api/test-mutation")
      .set("X-Test-User", "security-test-user")
      .send({ value: 1 });

    expect(response.status).toBe(200);
  });

  it("recognizes Capacitor origins and still enforces CSRF", async () => {
    const response = await request(buildApp())
      .post("/api/test-mutation")
      .set("X-Test-User", "security-test-user")
      .set("Origin", "capacitor://localhost")
      .send({ value: 1 });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("CSRF_TOKEN_REQUIRED");
  });
});
