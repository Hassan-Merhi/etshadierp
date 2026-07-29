import type { Express } from "express";

import { requireAuth, requireNonPOS } from "../../auth";
import { interCompanyTransferService } from "./interCompanyTransferService";
import { sendTransferRouteError } from "./transferErrors";
import {
  getActiveTransferCompanyId,
  getTransferUserId,
  requireCompanyAccountAccess,
} from "./transferRequestContext";
import { simpleCompanyTransferService } from "./simpleCompanyTransferService";
import { parseCompanyId, parseTransferId } from "./transferValidation";

export function registerCompanyTransferRoutes(app: Express) {
  app.get("/api/inter-company-transfers", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = getActiveTransferCompanyId(req);
      return res.json(await interCompanyTransferService.list(companyId));
    } catch (error: unknown) {
      return sendTransferRouteError(res, error, 500);
    }
  });

  app.post("/api/inter-company-transfers", requireAuth, requireNonPOS, async (req, res) => {
    try {
      getActiveTransferCompanyId(req);
      const transfer = await interCompanyTransferService.create(req.body);
      return res.status(201).json(transfer);
    } catch (error: unknown) {
      return sendTransferRouteError(res, error, 400);
    }
  });

  app.get("/api/company-accounts/:companyId", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = parseCompanyId(req.params.companyId);
      const userId = getTransferUserId(req);
      await requireCompanyAccountAccess(userId, companyId, req.session.currentCompanyId);
      return res.json(await simpleCompanyTransferService.listCompanyAccounts(companyId));
    } catch (error: unknown) {
      return sendTransferRouteError(res, error, 500);
    }
  });

  app.get("/api/simple-company-transfers", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = getActiveTransferCompanyId(req);
      return res.json(await simpleCompanyTransferService.list(companyId));
    } catch (error: unknown) {
      return sendTransferRouteError(res, error, 500);
    }
  });

  app.post("/api/simple-company-transfer", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const userId = getTransferUserId(req);
      const transfer = await simpleCompanyTransferService.create(userId, req.body);
      return res.status(201).json(transfer);
    } catch (error: unknown) {
      return sendTransferRouteError(res, error, 400);
    }
  });

  app.delete("/api/simple-company-transfer/:id", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const userId = getTransferUserId(req);
      const transferId = parseTransferId(req.params.id);
      return res.json(await simpleCompanyTransferService.delete(userId, transferId));
    } catch (error: unknown) {
      return sendTransferRouteError(res, error, 500);
    }
  });
}
