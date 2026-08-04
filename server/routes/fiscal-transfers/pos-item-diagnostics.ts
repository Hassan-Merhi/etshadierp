import type { Express } from "express";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { getErrorMessage } from "../../lib/httpHandlers";
import {
  stockTransferItems,
  stockTransferRevisionItems,
  stockTransferRevisions,
  stockTransferVouchers,
  vouchers,
} from "@shared/schema";

export function registerPosTransferItemDiagnosticRoutes(app: Express) {
  app.get("/api/stock-transfers/:transferId/item-diagnostics", requireAuth, async (req, res) => {
    try {
      const transferId = Number(req.params.transferId);
      if (!Number.isInteger(transferId) || transferId <= 0) {
        return res.status(400).json({ message: "Transfer ID required" });
      }

      const [transfer] = await db
        .select({
          id: stockTransferVouchers.id,
          companyId: vouchers.companyId,
          sourceLocationId: stockTransferVouchers.sourceLocationId,
          destinationLocationId: stockTransferVouchers.destinationLocationId,
          inventoryApplied: stockTransferVouchers.inventoryApplied,
        })
        .from(stockTransferVouchers)
        .innerJoin(vouchers, eq(stockTransferVouchers.voucherId, vouchers.id))
        .where(eq(stockTransferVouchers.id, transferId));

      if (!transfer) return res.status(404).json({ message: "Transfer not found" });
      if (transfer.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Transfer is outside the active company" });
      }

      const allItems = await db
        .select({
          id: stockTransferItems.id,
          stockItemId: stockTransferItems.stockItemId,
          sourceLocationId: stockTransferItems.sourceLocationId,
          quantity: stockTransferItems.quantity,
        })
        .from(stockTransferItems)
        .where(eq(stockTransferItems.transferId, transferId));

      const revisionRows = await db
        .select({ id: stockTransferRevisions.id })
        .from(stockTransferRevisions)
        .where(eq(stockTransferRevisions.transferId, transferId));
      const revisionIds = revisionRows.map((row) => row.id);
      const revisionItems = revisionIds.length
        ? await db
            .select({
              stockItemId: stockTransferRevisionItems.stockItemId,
              sourceLocationId: stockTransferRevisionItems.sourceLocationId,
              newQuantity: stockTransferRevisionItems.newQuantity,
            })
            .from(stockTransferRevisionItems)
            .where(inArray(stockTransferRevisionItems.revisionId, revisionIds))
        : [];

      const isPos = req.user?.role === "POS";
      const locationId = isPos
        ? (req.user?.assignedLocationId ?? req.session.currentLocationId ?? null)
        : null;
      const destinationUser = locationId != null && transfer.destinationLocationId === locationId;
      const visibleItems = !locationId || destinationUser
        ? allItems
        : allItems.filter((item) =>
            item.sourceLocationId === locationId ||
            (item.sourceLocationId == null && transfer.sourceLocationId === locationId)
          );

      let reason: string | null = null;
      if (allItems.length === 0 && revisionItems.length === 0) {
        reason = "NO_STORED_ITEM_LINES";
      } else if (visibleItems.length === 0 && allItems.length > 0) {
        reason = "NO_ITEMS_FOR_ASSIGNED_LOCATION";
      } else if (visibleItems.every((item) => Number(item.quantity) === 0)) {
        reason = "ALL_VISIBLE_QUANTITIES_ZERO";
      } else if (transfer.inventoryApplied && visibleItems.length === 0) {
        reason = "APPLIED_TRANSFER_WITHOUT_VISIBLE_LINES";
      }

      return res.json({
        transferId,
        inventoryApplied: transfer.inventoryApplied,
        totalStoredItemCount: allItems.length,
        visibleItemCount: visibleItems.length,
        revisionItemCount: revisionItems.length,
        locationId,
        destinationUser,
        reason,
        recoverableFromRevisionHistory: allItems.length === 0 && revisionItems.length > 0,
      });
    } catch (error: unknown) {
      return res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
