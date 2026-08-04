import type { Express, NextFunction, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { getErrorMessage } from "../../lib/httpHandlers";
import {
  stockTransferItems,
  stockTransferRevisions,
  stockTransferVouchers,
  vouchers,
} from "@shared/schema";

async function loadTransfer(transferId: number) {
  const [row] = await db
    .select({
      transferId: stockTransferVouchers.id,
      voucherId: vouchers.id,
      companyId: vouchers.companyId,
      sourceLocationId: stockTransferVouchers.sourceLocationId,
      destinationLocationId: stockTransferVouchers.destinationLocationId,
    })
    .from(stockTransferVouchers)
    .innerJoin(vouchers, eq(stockTransferVouchers.voucherId, vouchers.id))
    .where(eq(stockTransferVouchers.id, transferId));
  return row ?? null;
}

async function resolveTransfer(req: Request) {
  const voucherId = req.query.voucherId ? Number(req.query.voucherId) : null;
  const transferId = req.params.transferId ? Number(req.params.transferId) : null;
  const revisionId = req.params.id ? Number(req.params.id) : null;

  if (voucherId) {
    const [row] = await db
      .select({ transferId: stockTransferVouchers.id })
      .from(stockTransferVouchers)
      .where(eq(stockTransferVouchers.voucherId, voucherId));
    return row ? loadTransfer(row.transferId) : null;
  }

  if (transferId) return loadTransfer(transferId);

  if (revisionId) {
    const [revision] = await db
      .select({ transferId: stockTransferRevisions.transferId })
      .from(stockTransferRevisions)
      .where(eq(stockTransferRevisions.id, revisionId));
    return revision ? loadTransfer(revision.transferId) : null;
  }

  return null;
}

async function enforceTransferAccess(req: Request, res: Response, next: NextFunction) {
  try {
    const transfer = await resolveTransfer(req);
    if (!transfer) return res.status(404).json({ message: "Transfer not found" });

    const companyId = req.session.currentCompanyId;
    if (!companyId || transfer.companyId !== companyId) {
      return res.status(403).json({ message: "Transfer is not available in the active company" });
    }

    if (req.user?.role !== "POS") return next();

    const locationId = req.user?.assignedLocationId ?? req.session.currentLocationId ?? null;
    if (!locationId) return res.status(403).json({ message: "POS location is not assigned" });

    if (transfer.sourceLocationId === locationId || transfer.destinationLocationId === locationId) {
      return next();
    }

    const [item] = await db
      .select({ id: stockTransferItems.id })
      .from(stockTransferItems)
      .where(
        and(
          eq(stockTransferItems.transferId, transfer.transferId),
          eq(stockTransferItems.sourceLocationId, locationId)
        )
      )
      .limit(1);

    if (!item) {
      return res.status(403).json({ message: "This transfer does not involve your assigned location" });
    }
    return next();
  } catch (error: unknown) {
    return res.status(500).json({ message: getErrorMessage(error) });
  }
}

export function registerPosTransferAccessGuards(app: Express) {
  app.use("/api/pos-transfer-detail", enforceTransferAccess);
  app.use("/api/stock-transfers/:transferId/revisions", enforceTransferAccess);
  app.use("/api/stock-transfers/:transferId/revision-statuses", enforceTransferAccess);
  app.use("/api/stock-transfer-revisions/:id/approve", enforceTransferAccess);
  app.use("/api/stock-transfer-revisions/:id/reject", enforceTransferAccess);
  app.use("/api/stock-transfer-revisions/:id/supersede", enforceTransferAccess);
}
