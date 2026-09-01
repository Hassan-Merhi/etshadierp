import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { upload } from "../server/routes/helpers/uploadHelpers";
import { getDatabaseScopeRuntimeContext } from "../server/services/security/databaseScopeRuntimeContext";

describe("multipart upload tenant scope continuity", () => {
  it("restores the authenticated session company scope after Multer completes", async () => {
    const app = express();

    app.use((req, _res, next) => {
      req.session = {
        userId: "user-1",
        currentCompanyId: 12,
      } as typeof req.session;
      next();
    });

    app.post("/upload", upload.single("file"), (req, res) => {
      const scope = getDatabaseScopeRuntimeContext();
      res.json({
        companyId: scope?.kind === "tenant" ? scope.companyId : null,
        fileName: req.file?.originalname ?? null,
      });
    });

    const response = await request(app)
      .post("/upload")
      .attach("file", Buffer.from("scope-probe"), "probe.txt");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ companyId: 12, fileName: "probe.txt" });
  });

  it("does not invent a tenant scope for an unauthenticated upload", async () => {
    const app = express();

    app.post("/upload", upload.single("file"), (_req, res) => {
      const scope = getDatabaseScopeRuntimeContext();
      res.json({ kind: scope?.kind ?? null });
    });

    const response = await request(app)
      .post("/upload")
      .attach("file", Buffer.from("scope-probe"), "probe.txt");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ kind: null });
  });
});
