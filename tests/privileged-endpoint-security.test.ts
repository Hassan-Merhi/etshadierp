import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import {
  privilegedConcurrencyLimit,
  privilegedDestructiveRateLimit,
  privilegedRequestBudget,
} from "../server/middleware/privilegedEndpointSecurity";

describe("privileged endpoint security", () => {
  it("rejects privileged request bodies above the configured byte budget", async () => {
    const app = express();
    app.use(express.json({ limit: "32kb" }));
    app.post("/privileged", privilegedRequestBudget({ maxBodyBytes: 128, maxCollectionItems: 100 }), (_req, res) =>
      res.status(200).json({ ok: true })
    );

    const response = await request(app)
      .post("/privileged")
      .send({ value: "x".repeat(256) })
      .expect(413);
    expect(response.body.code).toBe("PRIVILEGED_BODY_TOO_LARGE");
  });

  it("rejects oversized nested collections before privileged work starts", async () => {
    const app = express();
    app.use(express.json());
    app.post("/privileged", privilegedRequestBudget({ maxBodyBytes: 16 * 1024, maxCollectionItems: 2 }), (_req, res) =>
      res.status(200).json({ ok: true })
    );

    const response = await request(app)
      .post("/privileged")
      .send({ payload: { items: [{ id: 1 }, { id: 2 }, { id: 3 }] } })
      .expect(413);

    expect(response.body).toMatchObject({
      code: "PRIVILEGED_COLLECTION_TOO_LARGE",
      field: "body.payload.items",
      maxCollectionItems: 2,
    });
  });

  it("allows requests inside the configured budget", async () => {
    const app = express();
    app.use(express.json());
    app.post("/privileged", privilegedRequestBudget({ maxBodyBytes: 16 * 1024, maxCollectionItems: 10 }), (_req, res) =>
      res.status(200).json({ ok: true })
    );

    await request(app)
      .post("/privileged")
      .send({ items: [{ id: 1 }, { id: 2 }] })
      .expect(200, { ok: true });
  });

  it("rate-limits destructive privileged operations", async () => {
    const app = express();
    app.post("/destructive", privilegedDestructiveRateLimit, (_req, res) => res.status(200).json({ ok: true }));

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await request(app).post("/destructive").expect(200);
    }

    const response = await request(app).post("/destructive").expect(429);
    expect(response.body.code).toBe("PRIVILEGED_DESTRUCTIVE_RATE_LIMITED");
  });

  it("rejects overlapping expensive work for the same actor", async () => {
    const app = express();
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });

    app.post("/expensive", privilegedConcurrencyLimit({ scope: "privileged-test" }), async (_req, res) => {
      markFirstStarted();
      await firstCanFinish;
      res.status(200).json({ ok: true });
    });

    const firstRequest = request(app)
      .post("/expensive")
      .then((response) => response);
    await firstStarted;

    const overlapping = await request(app).post("/expensive").expect(429);
    expect(overlapping.body.code).toBe("PRIVILEGED_OPERATION_IN_PROGRESS");

    releaseFirst();
    const firstResponse = await firstRequest;
    expect(firstResponse.status).toBe(200);
  });
});
