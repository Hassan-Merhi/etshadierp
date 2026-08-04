import type { Express } from "express";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { requireAuth, requireNonPOS } from "../../auth";
import { getErrorMessage } from "../../lib/httpHandlers";
import { adjustInventory } from "../../inventoryHelper";
import {
  inventory,
  stockTransferItems,
  stockTransferRevisionItems,
  stockTransferRevisions,
  stockTransferVouchers,
  vouchers,
} from "@shared/schema";

type IncomingRevisionItem = {
  stockItemId: number;
  stockItemName: string;
  sourceLocationId?: number | null;
  sourceLocationName?: string | null;
  newQuantity: string | number;
};

const keyOf = (stockItemId: number, sourceLocationId?: number | null) =>
  `${stockItemId}:${sourceLocationId ?? ""}`;

async function effectiveQuantities(transferId: number) {
  const effective = new Map<string, number>();
  const baseItems = await db
    .select()
    .from(stockTransferItems)
    .where(eq(stockTransferItems.transferId, transferId));

  for (const item of baseItems) {
    effective.set(keyOf(item.stockItemId, item.sourceLocationId), Number(item.quantity));
  }

  const revisions = await db
    .select()
    .from(stockTransferRevisions)
    .where(eq(stockTransferRevisions.transferId, transferId))
    .orderBy(asc(stockTransferRevisions.revisionNumber));

  for (const revision of revisions) {
    const items = await db
      .select()
      .from(stockTransferRevisionItems)
      .where(eq(stockTransferRevisionItems.revisionId, revision.id));
    for (const item of items) {
      effective.set(keyOf(item.stockItemId, item.sourceLocationId), Number(item.newQuantity));
    }
  }

  return effective;
}

function normalizeIncoming(rawItems: unknown): IncomingRevisionItem[] {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new Error("At least one changed item is required");
  }

  const seen = new Set<string>();
  return rawItems.map((raw, index) => {
    const item = raw as Partial<IncomingRevisionItem>;
    const stockItemId = Number(item.stockItemId);
    const sourceLocationId = item.sourceLocationId == null ? null : Number(item.sourceLocationId);
    const newQuantity = Number(item.newQuantity);

    if (!Number.isInteger(stockItemId) || stockItemId <= 0) {
      throw new Error(`Item ${index + 1} has an invalid stock item`);
    }
    if (!item.stockItemName?.trim()) {
      throw new Error(`Item ${index + 1} is missing its name`);
    }
    if (!Number.isFinite(newQuantity) || newQuantity < 0) {
      throw new Error(`Item ${index + 1} has an invalid new quantity`);
    }
    if (sourceLocationId !== null && (!Number.isInteger(sourceLocationId) || sourceLocationId <= 0)) {
      throw new Error(`Item ${index + 1} has an invalid source location`);
    }

    const key = keyOf(stockItemId, sourceLocationId);
    if (seen.has(key)) throw new Error(`Item ${index + 1} is duplicated in this revision`);
    seen.add(key);

    return {
      stockItemId,
      stockItemName: item.stockItemName.trim(),
      sourceLocationId,
      sourceLocationName: item.sourceLocationName?.trim() || null,
      newQuantity,
    };
  });
}

export function registerStockTransferRevisionLifecycleRoutesV2(app: Express) {
  app.post("/api/stock-transfers/:transferId/revisions", requireAuth, async (req, res) => {
    try {
      const transferId = Number(req.params.transferId);
      if (!Number.isInteger(transferId) || transferId <= 0) {
        return res.status(400).json({ message: "Transfer ID required" });
      }

      const requestedItems = normalizeIncoming(req.body?.items);
      const note = typeof req.body?.note === "string" ? req.body.note.trim() || null : null;
      const optional = req.body?.optional === true;
      const baseline = await effectiveQuantities(transferId);

      const items = requestedItems.map((item) => {
        const originalQuantity = baseline.get(keyOf(item.stockItemId, item.sourceLocationId)) ?? 0;
        const newQuantity = Number(item.newQuantity);
        return {
          ...item,
          originalQuantity,
          delta: newQuantity - originalQuantity,
          newQuantity,
        };
      }).filter((item) => Math.abs(item.delta) > 0.000001);

      if (items.length === 0) {
        return res.status(400).json({ message: "No effective quantity changes were submitted" });
      }

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
          .values(items.map((item) => ({
            revisionId: revision.id,
            stockItemId: item.stockItemId,
            stockItemName: item.stockItemName,
            sourceLocationId: item.sourceLocationId,
            sourceLocationName: item.sourceLocationName,
            originalQuantity: String(item.originalQuantity),
            delta: String(item.delta),
            newQuantity: String(item.newQuantity),
          })))
          .returning();

        return { ...revision, items: insertedItems };
      });

      return res.status(201).json(saved);
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      const status = /required|invalid|duplicated|missing|No effective/.test(message) ? 400 : 500;
      return res.status(status).json({ message });
    }
  });

  app.post("/api/stock-transfer-revisions/:id/approve", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const revisionId = Number(req.params.id);
      if (!Number.isInteger(revisionId) || revisionId <= 0) {
        return res.status(400).json({ message: "Revision ID required" });
      }

      await db.transaction(async (tx) => {
        const [revision] = await tx
          .select()
          .from(stockTransferRevisions)
          .where(eq(stockTransferRevisions.id, revisionId));
        if (!revision) throw new Error("Revision not found");
        if (!revision.optional) throw new Error("Revision is already approved or is not pending");

        const [earlierPending] = await tx
          .select({ id: stockTransferRevisions.id })
          .from(stockTransferRevisions)
          .where(and(
            eq(stockTransferRevisions.transferId, revision.transferId),
            eq(stockTransferRevisions.optional, true)
          ))
          .orderBy(asc(stockTransferRevisions.revisionNumber))
          .limit(1);
        if (earlierPending?.id !== revision.id) {
          throw new Error("Earlier pending revisions must be reviewed first");
        }

        const [transfer] = await tx
          .select()
          .from(stockTransferVouchers)
          .where(eq(stockTransferVouchers.id, revision.transferId));
        if (!transfer) throw new Error("Transfer not found");

        const revisionItems = await tx
          .select()
          .from(stockTransferRevisionItems)
          .where(eq(stockTransferRevisionItems.revisionId, revision.id));
        if (revisionItems.length === 0) throw new Error("Revision has no items");

        const [voucherRow] = await tx
          .select({ companyId: vouchers.companyId })
          .from(vouchers)
          .where(eq(vouchers.id, transfer.voucherId));
        const companyId = voucherRow?.companyId ?? req.session.currentCompanyId;
        if (!companyId) throw new Error("Transfer company could not be resolved");

        for (const revisionItem of revisionItems) {
          const currentItems = await tx
            .select()
            .from(stockTransferItems)
            .where(and(
              eq(stockTransferItems.transferId, transfer.id),
              eq(stockTransferItems.stockItemId, revisionItem.stockItemId)
            ));
          const current = currentItems.find((item) =>
            revisionItem.sourceLocationId == null || item.sourceLocationId === revisionItem.sourceLocationId
          );
          const originalQuantity = Number(revisionItem.originalQuantity);
          const newQuantity = Number(revisionItem.newQuantity);
          const delta = newQuantity - originalQuantity;

          if (current) {
            if (Math.abs(Number(current.quantity) - originalQuantity) > 0.000001) {
              throw new Error(`Revision #${revision.revisionNumber} is stale for ${revisionItem.stockItemName}`);
            }
            const rate = Number(current.rate ?? 0);
            await tx
              .update(stockTransferItems)
              .set({ quantity: String(newQuantity), totalAmount: (newQuantity * rate).toFixed(2) })
              .where(eq(stockTransferItems.id, current.id));

            if (transfer.inventoryApplied && revisionItem.sourceLocationId && delta !== 0) {
              await adjustInventory(tx, revisionItem.sourceLocationId, revisionItem.stockItemId, -delta, companyId);
              await adjustInventory(tx, transfer.destinationLocationId, revisionItem.stockItemId, delta, companyId, rate);
            }
          } else if (newQuantity > 0) {
            let rate = 0;
            if (revisionItem.sourceLocationId) {
              const [inv] = await tx
                .select({ averageRate: inventory.averageRate })
                .from(inventory)
                .where(and(
                  eq(inventory.locationId, revisionItem.sourceLocationId),
                  eq(inventory.stockItemId, revisionItem.stockItemId)
                ))
                .limit(1);
              rate = Number(inv?.averageRate ?? 0);
            }
            await tx.insert(stockTransferItems).values({
              transferId: transfer.id,
              stockItemId: revisionItem.stockItemId,
              sourceLocationId: revisionItem.sourceLocationId ?? undefined,
              quantity: String(newQuantity),
              rate: rate.toFixed(2),
              totalAmount: (newQuantity * rate).toFixed(2),
            });

            if (transfer.inventoryApplied && revisionItem.sourceLocationId) {
              await adjustInventory(tx, revisionItem.sourceLocationId, revisionItem.stockItemId, -newQuantity, companyId);
              await adjustInventory(tx, transfer.destinationLocationId, revisionItem.stockItemId, newQuantity, companyId, rate);
            }
          }
        }

        const allItems = await tx
          .select({ quantity: stockTransferItems.quantity, rate: stockTransferItems.rate })
          .from(stockTransferItems)
          .where(eq(stockTransferItems.transferId, transfer.id));
        const total = allItems.reduce((sum, item) => sum + Number(item.quantity) * Number(item.rate ?? 0), 0);
        await tx.update(vouchers).set({ totalAmount: total.toFixed(2) }).where(eq(vouchers.id, transfer.voucherId));
        await tx.update(stockTransferRevisions).set({ optional: false }).where(eq(stockTransferRevisions.id, revision.id));
      });

      return res.json({ success: true });
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      const status = /not found|required/.test(message) ? 404 : /already|pending|stale|Earlier/.test(message) ? 409 : 500;
      return res.status(status).json({ message });
    }
  });
}
