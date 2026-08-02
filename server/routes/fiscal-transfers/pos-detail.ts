/**
 * fiscalTransferRoutes: PosTransferDetail endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import {
  stockItems,
  stockTransferVouchers,
  stockTransferItems,
  stockTransferRevisions,
  stockTransferRevisionItems,
  vouchers,
  locations,
} from "@shared/schema";
import { eq, asc, inArray } from "drizzle-orm";

export function registerPosTransferDetailRoutes(app: Express) {
  // POS Transfer Order Detail endpoint - returns full detail with names
  app.get("/api/pos-transfer-detail", requireAuth, async (req, res) => {
    try {
      const voucherId = req.query.voucherId ? parseInt(req.query.voucherId as string) : null;
      if (!voucherId) return res.status(400).json({ message: "voucherId required" });

      const [transferRow] = await db
        .select()
        .from(stockTransferVouchers)
        .where(eq(stockTransferVouchers.voucherId, voucherId));
      if (!transferRow) return res.status(404).json({ message: "Transfer not found" });

      const [voucherRow] = await db
        .select({
          voucherNumber: vouchers.voucherNumber,
          voucherDate: vouchers.voucherDate,
          optional: vouchers.optional,
        })
        .from(vouchers)
        .where(eq(vouchers.id, voucherId));

      const isPosUser = req.user?.role === "POS";
      const posLocationId = isPosUser ? (req.user?.assignedLocationId ?? req.session?.currentLocationId ?? null) : null;

      const allTransferItems = await db
        .select()
        .from(stockTransferItems)
        .where(eq(stockTransferItems.transferId, transferRow.id));

      // Destination-side POS users see all items (they receive everything).
      // Source-side POS users see only items assigned to their specific location:
      //   - Items with item-level sourceLocationId matching their location
      //   - Items with no item-level sourceLocationId AND voucher-level source matches (true single-source)
      const isDestinationUser = posLocationId !== null && posLocationId === transferRow.destinationLocationId;
      const transferItems = posLocationId
        ? isDestinationUser
          ? allTransferItems
          : allTransferItems.filter(
              (i) =>
                i.sourceLocationId === posLocationId ||
                (i.sourceLocationId === null && posLocationId === transferRow.sourceLocationId)
            )
        : allTransferItems;

      const stockItemIdSet = [...new Set(transferItems.map((i) => i.stockItemId).filter(Boolean))] as number[];
      const stockItemRows =
        stockItemIdSet.length > 0
          ? await db
              .select({ id: stockItems.id, name: stockItems.name })
              .from(stockItems)
              .where(inArray(stockItems.id, stockItemIdSet))
          : [];
      const stockItemMap = new Map(stockItemRows.map((s) => [s.id, s.name]));

      const locationIds = new Set<number>();
      if (transferRow.sourceLocationId) locationIds.add(transferRow.sourceLocationId);
      if (transferRow.destinationLocationId) locationIds.add(transferRow.destinationLocationId);
      if (posLocationId) locationIds.add(posLocationId);
      for (const item of transferItems) {
        if (item.sourceLocationId) locationIds.add(item.sourceLocationId);
      }
      const locationRows =
        locationIds.size > 0
          ? await db
              .select({ id: locations.id, name: locations.name })
              .from(locations)
              .where(inArray(locations.id, Array.from(locationIds)))
          : [];
      const locationMap = new Map(locationRows.map((l) => [l.id, l.name]));

      const revisionRows = await db
        .select()
        .from(stockTransferRevisions)
        .where(eq(stockTransferRevisions.transferId, transferRow.id))
        .orderBy(asc(stockTransferRevisions.revisionNumber));

      // POS users only see their own revisions; non-POS users (admins) see all
      const visibleRevisionRows = isPosUser ? revisionRows.filter((r) => r.createdBy === req.user?.id) : revisionRows;

      const revisions = await Promise.all(
        visibleRevisionRows.map(async (rev) => {
          const items = await db
            .select()
            .from(stockTransferRevisionItems)
            .where(eq(stockTransferRevisionItems.revisionId, rev.id));
          return {
            ...rev,
            items: items.map((item) => ({
              ...item,
              sourceLocationName: item.sourceLocationId
                ? (locationMap.get(item.sourceLocationId) ?? item.sourceLocationName)
                : item.sourceLocationName,
            })),
          };
        })
      );

      res.json({
        transferId: transferRow.id,
        voucherId,
        voucherNumber: voucherRow?.voucherNumber,
        voucherDate: voucherRow?.voucherDate,
        optional: voucherRow?.optional,
        inventoryApplied: transferRow.inventoryApplied,
        sourceLocationId: isDestinationUser
          ? transferRow.sourceLocationId
          : (posLocationId ?? transferRow.sourceLocationId),
        sourceLocationName: isDestinationUser
          ? transferRow.sourceLocationId
            ? (locationMap.get(transferRow.sourceLocationId) ?? "Unknown")
            : "Multi-source"
          : posLocationId
            ? (locationMap.get(posLocationId) ?? "Unknown")
            : transferRow.sourceLocationId
              ? (locationMap.get(transferRow.sourceLocationId) ?? "Unknown")
              : "Multi-source",
        destinationLocationId: transferRow.destinationLocationId,
        destinationLocationName: locationMap.get(transferRow.destinationLocationId) ?? "Unknown",
        notes: transferRow.notes,
        items: transferItems.map((i) => ({
          ...i,
          stockItemName: stockItemMap.get(i.stockItemId) ?? "Unknown",
          sourceLocationName: i.sourceLocationId ? (locationMap.get(i.sourceLocationId) ?? null) : null,
        })),
        revisions,
      });
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
