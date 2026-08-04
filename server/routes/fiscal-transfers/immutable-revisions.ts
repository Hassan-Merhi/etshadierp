import type { Express } from "express";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { storage } from "../../storage";
import {
  stockTransferRevisionItems,
  stockTransferRevisions,
} from "@shared/schema";

type RevisionItemInput = {
  stockItemId: number;
  stockItemName: string;
  sourceLocationId?: number | null;
  sourceLocationName?: string | null;
  originalQuantity: string | number;
  delta: string | number;
  newQuantity: string | number;
};

function normalizeRevisionItems(rawItems: unknown): RevisionItemInput[] {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new Error("At least one changed item is required");
  }

  const seen = new Set<string>();
  return rawItems.map((raw, index) => {
    const item = raw as Partial<RevisionItemInput>;
    const stockItemId = Number(item.stockItemId);
    const originalQuantity = Number(item.originalQuantity);
    const delta = Number(item.delta);
    const newQuantity = Number(item.newQuantity);

    if (!Number.isInteger(stockItemId) || stockItemId <= 0) {
      throw new Error(`Item ${index + 1} has an invalid stock item`);
    }
    if (!item.stockItemName?.trim()) {
      throw new Error(`Item ${index + 1} is missing its name`);
    }
    if (![originalQuantity, delta, newQuantity].every(Number.isFinite)) {
      throw new Error(`Item ${index + 1} has an invalid quantity`);
    }
    if (Math.abs(originalQuantity + delta - newQuantity) > 0.000001) {
      throw new Error(`Item ${index + 1} quantities do not reconcile`);
    }

    const sourceLocationId = item.sourceLocationId == null ? null : Number(item.sourceLocationId);
    const key = `${stockItemId}:${sourceLocationId ?? ""}`;
    if (seen.has(key)) {
      throw new Error(`Item ${index + 1} is duplicated in this revision`);
    }
    seen.add(key);

    return {
      stockItemId,
      stockItemName: item.stockItemName.trim(),
      sourceLocationId,
      sourceLocationName: item.sourceLocationName?.trim() || null,
      originalQuantity: String(originalQuantity),
      delta: String(delta),
      newQuantity: String(newQuantity),
    };
  });
}

async function loadSeparateRevisions(transferId: number) {
  const revisions = await db
    .select()
    .from(stockTransferRevisions)
    .where(eq(stockTransferRevisions.transferId, transferId))
    .orderBy(asc(stockTransferRevisions.revisionNumber));

  return Promise.all(
    revisions.map(async (revision) => {
      const items = await db
        .select()
        .from(stockTransferRevisionItems)
        .where(eq(stockTransferRevisionItems.revisionId, revision.id));
      return { ...revision, items };
    })
  );
}

/**
 * Phase 2–3 compatibility routes.
 * Registered before the legacy revision modules so Express serves these
 * immutable create/read contracts without disturbing later lifecycle routes.
 */
export function registerImmutableStockTransferRevisionRoutes(app: Express) {
  app.post("/api/stock-transfers/:transferId/revisions", requireAuth, async (req, res) => {
    try {
      const transferId = Number(req.params.transferId);
      if (!Number.isInteger(transferId) || transferId <= 0) {
        return res.status(400).json({ message: "Transfer ID required" });
      }

      const items = normalizeRevisionItems(req.body?.items);
      const note = typeof req.body?.note === "string" ? req.body.note.trim() || null : null;
      const optional = req.body?.optional === true;

      const saved = await db.transaction(async (tx) => {
        const [latest] = await tx
          .select({ revisionNumber: stockTransferRevisions.revisionNumber })
          .from(stockTransferRevisions)
          .where(eq(stockTransferRevisions.transferId, transferId))
          .orderBy(desc(stockTransferRevisions.revisionNumber))
          .limit(1);

        const [revision] = await tx
          .insert(stockTransferRevisions)
          .values({
            transferId,
            revisionNumber: (latest?.revisionNumber ?? 0) + 1,
            note,
            optional,
            createdBy: req.user?.id ?? null,
          })
          .returning();

        const insertedItems = await tx
          .insert(stockTransferRevisionItems)
          .values(
            items.map((item) => ({
              revisionId: revision.id,
              stockItemId: item.stockItemId,
              stockItemName: item.stockItemName,
              sourceLocationId: item.sourceLocationId,
              sourceLocationName: item.sourceLocationName,
              originalQuantity: String(item.originalQuantity),
              delta: String(item.delta),
              newQuantity: String(item.newQuantity),
            }))
          )
          .returning();

        return { ...revision, items: insertedItems };
      });

      return res.status(201).json(saved);
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      logger.error("[Immutable revision POST] Error", { error: message });
      const clientError =
        message.includes("required") ||
        message.includes("invalid") ||
        message.includes("duplicated") ||
        message.includes("reconcile") ||
        message.includes("missing");
      return res.status(clientError ? 400 : 500).json({ message });
    }
  });

  app.get("/api/stock-transfers/by-voucher/:voucherId/revisions", requireAuth, async (req, res) => {
    try {
      const voucherId = Number(req.params.voucherId);
      if (!Number.isInteger(voucherId) || voucherId <= 0) {
        return res.status(400).json({ message: "Voucher ID required" });
      }
      const transfer = await storage.getStockTransferByVoucherId(voucherId);
      if (!transfer) return res.json([]);
      return res.json(await loadSeparateRevisions(transfer.id));
    } catch (error: unknown) {
      return res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.get("/api/stock-transfers/:transferId/revisions", requireAuth, async (req, res) => {
    try {
      const transferId = Number(req.params.transferId);
      if (!Number.isInteger(transferId) || transferId <= 0) {
        return res.status(400).json({ message: "Transfer ID required" });
      }
      return res.json(await loadSeparateRevisions(transferId));
    } catch (error: unknown) {
      return res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
