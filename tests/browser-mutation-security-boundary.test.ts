import express from "express";
import session from "express-session";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { browserMutationFailClosedBoundary } from "../server/security/browserMutationBoundary";

const TEST_CSRF_TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: "phase-14-security-reaudit-test-secret",
      resave: false,
      saveUninitialized: false,
    }),
  );

  app.get("/__test/authenticate", (req, res) => {
    req.session.userId = "security-test-user";
    if (req.query.withCsrf === "1") req.session.csrfToken = TEST_CSRF_TOKEN;
    res.sendStatus(204);
  });

  app.use(browserMutationFailClosedBoundary);
  app.post("/api/protected", (_req, res) => res.status(200).json({ ok: true }));
  app.post("/api/user-presence/leave", (_req, res) => res.status(200).json({ ok: true }));
  return app;
}

describe("browser mutation fail-closed boundary", () => {
  it("rejects opaque or malformed browser origins instead of treating them as native clients", async () => {
    const response = await request(buildApp())
      .post("/api/protected")
      .set("Host", "erp.example.test")
      .set("Origin", "null")
      .send({});

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("CSRF_ORIGIN_INVALID");
  });

  it("rejects a cross-origin browser mutation", async () => {
    const response = await request(buildApp())
      .post("/api/protected")
      .set("Host", "erp.example.test")
      .set("Origin", "https://evil.example.test")
      .send({});

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("CSRF_ORIGIN_MISMATCH");
  });

  it("requires an established CSRF token once a browser session is authenticated", async () => {
    const app = buildApp();
    const agent = request.agent(app);

    await agent.get("/__test/authenticate").set("Host", "erp.example.test").expect(204);
    const response = await agent
      .post("/api/protected")
      .set("Host", "erp.example.test")
      .set("Origin", "https://erp.example.test")
      .send({});

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("CSRF_TOKEN_REQUIRED");
  });

  it("allows an authenticated same-origin browser mutation with the exact session token", async () => {
    const app = buildApp();
    const agent = request.agent(app);

    await agent
      .get("/__test/authenticate?withCsrf=1")
      .set("Host", "erp.example.test")
      .expect(204);
    const response = await agent
      .post("/api/protected")
      .set("Host", "erp.example.test")
      .set("Origin", "https://erp.example.test")
      .set("X-CSRF-Token", TEST_CSRF_TOKEN)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it("preserves native authenticated clients that omit Origin and Referer", async () => {
    const app = buildApp();
    const agent = request.agent(app);

    await agent.get("/__test/authenticate").expect(204);
    const response = await agent.post("/api/protected").send({});

    expect(response.status).toBe(200);
  });

  it("preserves the sendBeacon presence-leave exemption", async () => {
    const response = await request(buildApp())
      .post("/api/user-presence/leave")
      .set("Host", "erp.example.test")
      .set("Origin", "null")
      .send({});

    expect(response.status).toBe(200);
  });

  it("requires the CSRF token for authenticated Capacitor browser mutations", async () => {
    const app = buildApp();
    const agent = request.agent(app);

    await agent.get("/__test/authenticate?withCsrf=1").expect(204);

    await agent
      .post("/api/protected")
      .set("Origin", "capacitor://localhost")
      .send({})
      .expect(403);

    await agent
      .post("/api/protected")
      .set("Origin", "capacitor://localhost")
      .set("X-CSRF-Token", TEST_CSRF_TOKEN)
      .send({})
      .expect(200);
  });
});
