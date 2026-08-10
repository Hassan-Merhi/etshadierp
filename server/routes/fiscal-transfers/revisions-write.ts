/**
 * fiscalTransferRoutes: StockTransferRevisionWrite endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { db } from "../../db";
import { requireAuth, requireNonPOS } from "../../auth";
import { logger } from "../../lib/logger";
import {
  inventory,
  stockTransferVouchers,
  stockTransferItems,
  stockTransferRevisions,
  stockTransferRevisionItems,
  vouchers,
  locations,
} from "@shared/schema";
import { eq, and, desc, asc, inArray } from "drizzle-orm";
import { adjustInventory } from "../../inventoryHelper";
import { sendRevisedTransferWhatsApp } from "../../helpers/sendRevisedTransferWhatsApp";

export function registerStockTransferRevisionWriteRoutes(app: Express) {
  // Transfer Revisions - POST (create or update existing optional revision)
  app.post("/api/stock-transfers/:transferId/revisions", requireAuth, async (req, res) => {
    try {
      const transferId = parseInt(req.params.transferId);
      if (!transferId) return res.status(400).json({ message: "Transfer ID required" });

      const { note, items, optional: optionalFlag } = req.body;
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "At least one changed item is required" });
      }

      const isOptional = optionalFlag === true;

      // If this is an optional (POS) revision, check if the SAME USER already has one pending
      // and update it in-place rather than creating a new revision.
      // Each POS user gets their own optional revision so multiple locations can coexist.
      let revision = null;
      if (isOptional && req.user?.id) {
        const [existingOptional] = await db
          .select()
          .from(stockTransferRevisions)
          .where(
            and(
              eq(stockTransferRevisions.transferId, transferId),
              eq(stockTransferRevisions.optional, true),
              eq(stockTransferRevisions.createdBy, req.user.id)
            )
          )
          .orderBy(asc(stockTransferRevisions.revisionNumber))
          .limit(1);

        if (existingOptional) {
          // Merge: upsert each incoming item into the existing revision.
          // Items already in the revision but NOT in this payload are kept as-is
          // (they were prior adjustments the user hasn't touched this session).
          const existingRevItems = await db
            .select()
            .from(stockTransferRevisionItems)
            .where(eq(stockTransferRevisionItems.revisionId, existingOptional.id));

          const existingByKey = new Map(
            existingRevItems.map((i) => [`${i.stockItemId}:${i.sourceLocationId ?? ""}`, i])
          );

          for (const item of items as any[]) {
            const key = `${item.stockItemId}:${item.sourceLocationId ?? ""}`;
            const existing = existingByKey.get(key);
            if (existing) {
              await db
                .update(stockTransferRevisionItems)
                .set({
                  delta: String(item.delta),
                  newQuantity: String(item.newQuantity),
                  stockItemName: item.stockItemName,
                })
                .where(eq(stockTransferRevisionItems.id, existing.id));
            } else {
              await db.insert(stockTransferRevisionItems).values({
                revisionId: existingOptional.id,
                stockItemId: item.stockItemId,
                stockItemName: item.stockItemName,
                sourceLocationId: item.sourceLocationId ?? null,
                sourceLocationName: item.sourceLocationName ?? null,
                originalQuantity: String(item.originalQuantity),
                delta: String(item.delta),
                newQuantity: String(item.newQuantity),
              });
            }
          }

          await db
            .update(stockTransferRevisions)
            .set({ note: note?.trim() || existingOptional.note, revisionDate: new Date() })
            .where(eq(stockTransferRevisions.id, existingOptional.id));
          revision = { ...existingOptional, note: note?.trim() || existingOptional.note };
        }
      }

      if (!revision) {
        // Create new revision
        const [latest] = await db
          .select({ revisionNumber: stockTransferRevisions.revisionNumber })
          .from(stockTransferRevisions)
          .where(eq(stockTransferRevisions.transferId, transferId))
          .orderBy(desc(stockTransferRevisions.revisionNumber))
          .limit(1);

        const nextNum = latest ? latest.revisionNumber + 1 : 1;

        const [newRev] = await db
          .insert(stockTransferRevisions)
          .values({
            transferId,
            revisionNumber: nextNum,
            note: note?.trim() || null,
            optional: isOptional,
            createdBy: req.user?.id ?? null,
          })
          .returning();
        revision = newRev;
      }

      await db.insert(stockTransferRevisionItems).values(
        items.map((item) => ({
          revisionId: revision.id,
          stockItemId: item.stockItemId,
          stockItemName: item.stockItemName,
          sourceLocationId: item.sourceLocationId ?? null,
          sourceLocationName: item.sourceLocationName ?? null,
          originalQuantity: String(item.originalQuantity),
          delta: String(item.delta),
          newQuantity: String(item.newQuantity),
        }))
      );

      const savedItems = await db
        .select()
        .from(stockTransferRevisionItems)
        .where(eq(stockTransferRevisionItems.revisionId, revision.id));

      res.json({ ...revision, items: savedItems });

      // Fire-and-forget: send revised transfer image for POS-submitted (optional) revisions only
      if (isOptional)
        setImmediate(async () => {
          try {
            const [transfer] = await db
              .select({
                destinationLocationId: stockTransferVouchers.destinationLocationId,
                voucherId: stockTransferVouchers.voucherId,
              })
              .from(stockTransferVouchers)
              .where(eq(stockTransferVouchers.id, transferId));
            if (!transfer) return;

            const [destLoc] = await db
              .select({ name: locations.name })
              .from(locations)
              .where(eq(locations.id, transfer.destinationLocationId));

            const [voucherRow] = await db
              .select({ voucherNumber: vouchers.voucherNumber, voucherDate: vouchers.voucherDate })
              .from(vouchers)
              .where(eq(vouchers.id, transfer.voucherId));
            if (!voucherRow) return;

            const uniqueSrcNames = [...new Set(items.map((i) => i.sourceLocationName).filter(Boolean))];
            const sourceName = uniqueSrcNames.length === 1 ? uniqueSrcNames[0] : "Multiple Sources";

            // Use the first item's sourceLocationId to route to the source WA group
            const srcLocationId = items.find((i) => i.sourceLocationId)?.sourceLocationId ?? null;
            if (!srcLocationId) return;

            const waItems = items.map((i) => ({
              stockItemId: Number(i.stockItemId),
              stockItemName: i.stockItemName ?? null,
              originalQuantity: parseFloat(i.originalQuantity) || 0,
              delta: parseFloat(i.delta) || 0,
              newQuantity: parseFloat(i.newQuantity) || 0,
            }));
            if (waItems.length === 0) return;

            await sendRevisedTransferWhatsApp({
              sourceLocationId: Number(srcLocationId),
              sourceLocationName: sourceName,
              destLocationName: destLoc?.name ?? "Unknown",
              items: waItems,
              voucherNumber: voucherRow.voucherNumber,
              voucherDate: voucherRow.voucherDate,
            });
          } catch (e: unknown) {
            logger.error("[RevisedTransferWA] Failed to send (revision):", { error: getErrorMessage(e) });
          }
        });
    } catch (error: unknown) {
      logger.error("[Revision POST] Error:", { error: getErrorMessage(error) });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // Transfer Revisions - PATCH optional flag
  app.patch("/api/stock-transfer-revisions/:id/optional", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (!id) return res.status(400).json({ message: "Revision ID required" });
      const { optional } = req.body;
      await db.update(stockTransferRevisions).set({ optional: !!optional }).where(eq(stockTransferRevisions.id, id));
      res.json({ success: true });
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // Revisions - APPROVE (apply deltas to transfer items and inventory)
  app.post("/api/stock-transfer-revisions/:id/approve", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const revisionId = parseInt(req.params.id);
      if (!revisionId) return res.status(400).json({ message: "Revision ID required" });

      await db.transaction(async (tx) => {
        // Load revision
        const [revision] = await tx
          .select()
          .from(stockTransferRevisions)
          .where(eq(stockTransferRevisions.id, revisionId));
        if (!revision) throw new Error("Revision not found");

        // Load the transfer
        const [transfer] = await tx
          .select()
          .from(stockTransferVouchers)
          .where(eq(stockTransferVouchers.id, revision.transferId));
        if (!transfer) throw new Error("Transfer not found");

        // Load ALL optional revisions for this transfer and compute net delta per item
        // (mirrors the merge logic in the GET endpoint so approval matches what admin sees)
        const allOptionalRevs = await tx
          .select()
          .from(stockTransferRevisions)
          .where(
            and(eq(stockTransferRevisions.transferId, revision.transferId), eq(stockTransferRevisions.optional, true))
          )
          .orderBy(asc(stockTransferRevisions.revisionNumber));

        const allOptionalRevIds = allOptionalRevs.map((r) => r.id);
        const allOptionalItems =
          allOptionalRevIds.length > 0
            ? await tx
                .select()
                .from(stockTransferRevisionItems)
                .where(inArray(stockTransferRevisionItems.revisionId, allOptionalRevIds))
            : [];

        if (allOptionalItems.length === 0) throw new Error("Revision has no items");

        // Compute net delta per item (same key logic as GET endpoint)
        const netMap = new Map<
          string,
          { stockItemId: number; sourceLocationId: number | null; originalQuantity: string; newQuantity: string }
        >();
        for (const rev of allOptionalRevs) {
          const items = allOptionalItems.filter((i) => i.revisionId === rev.id);
          for (const item of items) {
            const key = `${item.stockItemId}:${item.sourceLocationId ?? ""}`;
            const existing = netMap.get(key);
            if (!existing) {
              netMap.set(key, {
                stockItemId: item.stockItemId,
                sourceLocationId: item.sourceLocationId,
                originalQuantity: item.originalQuantity,
                newQuantity: item.newQuantity,
              });
            } else {
              netMap.set(key, { ...existing, newQuantity: item.newQuantity });
            }
          }
        }

        // Use the transfer's own company (from its voucher) for inventory adjustments.
        // Stock is always per-company — never use the destination location's company
        // as that can cross company boundaries.
        const [transferVoucherRow] = await tx
          .select({ companyId: vouchers.companyId })
          .from(vouchers)
          .where(eq(vouchers.id, transfer.voucherId));
        const companyId = transferVoucherRow?.companyId ?? req.session.currentCompanyId ?? null;

        // Load existing transfer items
        const existingItems = await tx
          .select()
          .from(stockTransferItems)
          .where(eq(stockTransferItems.transferId, transfer.id));

        for (const [, netItem] of netMap) {
          const origQty = parseFloat(netItem.originalQuantity);
          const newQty = parseFloat(netItem.newQuantity);
          const netDelta = newQty - origQty;
          if (netDelta === 0) continue;

          // Find the matching transfer item by stockItemId (+ sourceLocationId if set)
          const match = existingItems.find(
            (i) =>
              i.stockItemId === netItem.stockItemId &&
              (!netItem.sourceLocationId || i.sourceLocationId === netItem.sourceLocationId)
          );

          if (match) {
            const rate = parseFloat(match.rate ?? "0");
            const newTotal = newQty * rate;

            await tx
              .update(stockTransferItems)
              .set({ quantity: String(newQty), totalAmount: newTotal.toFixed(2) })
              .where(eq(stockTransferItems.id, match.id));

            // Apply inventory delta only if transfer was already applied to inventory
            if (transfer.inventoryApplied && netItem.sourceLocationId) {
              await adjustInventory(tx, netItem.sourceLocationId, netItem.stockItemId, -netDelta, companyId!);
              await adjustInventory(
                tx,
                transfer.destinationLocationId,
                netItem.stockItemId,
                netDelta,
                companyId!,
                rate
              );
            }
          } else if (newQty > 0) {
            // New item added by POS user that doesn't exist in the original transfer — insert it.
            // Look up rate from inventory.averageRate (same pattern as normal transfer creation
            // auto-fill for POS users who don't send cost price). Falls back to 0 safely if
            // the item has no inventory record at the source location.
            let rate = 0;
            if (netItem.sourceLocationId) {
              const [invRow] = await tx
                .select({ averageRate: inventory.averageRate })
                .from(inventory)
                .where(
                  and(
                    eq(inventory.locationId, netItem.sourceLocationId),
                    eq(inventory.stockItemId, netItem.stockItemId)
                  )
                )
                .limit(1);
              const parsed = parseFloat(invRow?.averageRate ?? "0");
              rate = isNaN(parsed) ? 0 : parsed;
            }
            const totalAmount = newQty * rate;

            await tx.insert(stockTransferItems).values({
              transferId: transfer.id,
              stockItemId: netItem.stockItemId,
              sourceLocationId: netItem.sourceLocationId ?? undefined,
              quantity: String(newQty),
              rate: rate.toFixed(2),
              totalAmount: totalAmount.toFixed(2),
            });

            // Apply inventory adjustment for the new item if inventory was already applied
            if (transfer.inventoryApplied && netItem.sourceLocationId) {
              await adjustInventory(tx, netItem.sourceLocationId, netItem.stockItemId, -newQty, companyId!);
              await adjustInventory(tx, transfer.destinationLocationId, netItem.stockItemId, newQty, companyId!, rate);
            }
          }
        }

        // Recalculate total from all items (including ones not in this revision)
        const allItems = await tx
          .select({ qty: stockTransferItems.quantity, rate: stockTransferItems.rate })
          .from(stockTransferItems)
          .where(eq(stockTransferItems.transferId, transfer.id));
        const fullTotal = allItems.reduce((s, i) => s + parseFloat(i.qty) * parseFloat(i.rate ?? "0"), 0);

        // Update voucher total
        await tx
          .update(vouchers)
          .set({ totalAmount: fullTotal.toFixed(2) })
          .where(eq(vouchers.id, transfer.voucherId));

        // Mark ALL optional revisions for this transfer as approved (handles merged display case)
        await tx
          .update(stockTransferRevisions)
          .set({ optional: false })
          .where(
            and(eq(stockTransferRevisions.transferId, revision.transferId), eq(stockTransferRevisions.optional, true))
          );
      });

      res.json({ success: true });
    } catch (error: unknown) {
      logger.error("[Revision Approve] Error:", { error: getErrorMessage(error) });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // Revisions - DELETE
  app.delete("/api/stock-transfer-revisions/:id", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (!id) return res.status(400).json({ message: "Revision ID required" });
      await db.delete(stockTransferRevisionItems).where(eq(stockTransferRevisionItems.revisionId, id));
      await db.delete(stockTransferRevisions).where(eq(stockTransferRevisions.id, id));
      res.json({ success: true });
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
