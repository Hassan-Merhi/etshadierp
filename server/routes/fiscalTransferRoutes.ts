import type { Express } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth, requireNonPOS } from "../auth";
import { getClientDate } from "../lib/dateUtils";
import { logger } from "../lib/logger";
import {
  inventory,
  stockItems,
  stockTransferVouchers,
  stockTransferItems,
  stockTransferRevisions,
  stockTransferRevisionItems,
  vouchers,
  locations,
  updateStockTransferSchema,
} from "@shared/schema";
import { eq, and, desc, asc, inArray, isNull, gte, lte } from "drizzle-orm";
import { adjustInventory } from "../inventoryHelper";
import { registerStockAdjustmentWasteRoutes } from "./stockAdjustmentWasteRoutes";
import { registerFinancialSalesRoutes } from "./financialSalesRoutes";
import { sendTransferWhatsApp } from "../helpers/sendTransferWhatsApp";
import { sendRevisedTransferWhatsApp } from "../helpers/sendRevisedTransferWhatsApp";

export function registerFiscalTransferRoutes(app: Express) {
  registerFinancialSalesRoutes(app);


  app.get("/api/stock-transfers/list", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const startDate = req.query.startDate ? String(req.query.startDate) : null;
      const endDate = req.query.endDate ? String(req.query.endDate) : null;

      // Fetch all stock transfer vouchers for this company via vouchers join
      const voucherConditions: any[] = [
        eq(vouchers.companyId, companyId),
        eq(vouchers.voucherType, "Stock Transfer"),
        isNull(vouchers.deletedAt),
      ];
      if (startDate) voucherConditions.push(gte(vouchers.voucherDate, startDate));
      if (endDate) voucherConditions.push(lte(vouchers.voucherDate, endDate));

      const rows = await db
        .select({
          transferId: stockTransferVouchers.id,
          voucherId: vouchers.id,
          voucherNumber: vouchers.voucherNumber,
          voucherDate: vouchers.voucherDate,
          notes: stockTransferVouchers.notes,
          inventoryApplied: stockTransferVouchers.inventoryApplied,
          sourceLocationId: stockTransferVouchers.sourceLocationId,
          destinationLocationId: stockTransferVouchers.destinationLocationId,
          createdAt: stockTransferVouchers.createdAt,
        })
        .from(stockTransferVouchers)
        .innerJoin(vouchers, eq(stockTransferVouchers.voucherId, vouchers.id))
        .where(and(...voucherConditions))
        .orderBy(desc(vouchers.voucherDate), desc(vouchers.id))
        .execute();

      if (rows.length === 0) return res.json([]);

      // Batch-fetch location names
      const locationIds = new Set<number>();
      for (const r of rows) {
        if (r.sourceLocationId) locationIds.add(r.sourceLocationId);
        if (r.destinationLocationId) locationIds.add(r.destinationLocationId);
      }
      // Determine if this is a POS user and their assigned location
      const isPosUserList = req.user?.role === "POS";
      const posLocationIdList = isPosUserList
        ? (req.user?.assignedLocationId ?? req.session?.currentLocationId ?? null)
        : null;

      if (posLocationIdList) locationIds.add(posLocationIdList);

      const locationRows =
        locationIds.size > 0
          ? await db
              .select({ id: locations.id, name: locations.name })
              .from(locations)
              .where(inArray(locations.id, Array.from(locationIds)))
              .execute()
          : [];
      const locationMap = new Map(locationRows.map((l) => [l.id, l.name]));

      // Batch-fetch item counts and totals per transfer
      const transferIds = rows.map((r) => r.transferId);
      const itemRows = await db
        .select({
          transferId: stockTransferItems.transferId,
          totalAmount: stockTransferItems.totalAmount,
          stockItemId: stockTransferItems.stockItemId,
          quantity: stockTransferItems.quantity,
          sourceLocationId: stockTransferItems.sourceLocationId,
        })
        .from(stockTransferItems)
        .where(inArray(stockTransferItems.transferId, transferIds))
        .execute();

      // Batch-fetch stock item names
      const stockItemIds = [...new Set(itemRows.map((i) => i.stockItemId).filter(Boolean))] as number[];
      const stockItemRows =
        stockItemIds.length > 0
          ? await db
              .select({ id: stockItems.id, name: stockItems.name })
              .from(stockItems)
              .where(inArray(stockItems.id, stockItemIds))
              .execute()
          : [];
      const stockItemMap = new Map(stockItemRows.map((s) => [s.id, s.name]));

      // Group all items by transfer
      const itemsByTransfer = new Map<number, typeof itemRows>();
      // Track which transfers have at least one item sourced from the POS user's location
      const transfersWithMySourceItem = new Set<number>();
      for (const item of itemRows) {
        const arr = itemsByTransfer.get(item.transferId) || [];
        arr.push(item);
        itemsByTransfer.set(item.transferId, arr);
        if (posLocationIdList !== null && item.sourceLocationId === posLocationIdList) {
          transfersWithMySourceItem.add(item.transferId);
        }
      }

      const allResult = rows.map((r) => {
        const allItems = itemsByTransfer.get(r.transferId) || [];
        // Destination-side POS users see all items; source-side see only their items:
        //   - Items with item-level sourceLocationId matching their location
        //   - Items with no item-level sourceLocationId AND voucher-level source matches
        const isDestUser = posLocationIdList !== null && r.destinationLocationId === posLocationIdList;
        const myItems =
          posLocationIdList !== null
            ? isDestUser
              ? allItems
              : allItems.filter(
                  (i) =>
                    i.sourceLocationId === posLocationIdList ||
                    (i.sourceLocationId === null && r.sourceLocationId === posLocationIdList)
                )
            : allItems;
        const totalAmount = myItems.reduce((s, i) => s + parseFloat(i.totalAmount || "0"), 0);
        const stockItemNames = [...new Set(myItems.map((i) => stockItemMap.get(i.stockItemId) ?? "").filter(Boolean))];
        return {
          transferId: r.transferId,
          voucherId: r.voucherId,
          voucherNumber: r.voucherNumber,
          voucherDate: r.voucherDate,
          notes: r.notes,
          inventoryApplied: r.inventoryApplied,
          sourceLocationId: isDestUser ? r.sourceLocationId : (posLocationIdList ?? r.sourceLocationId),
          sourceLocationName: isDestUser
            ? r.sourceLocationId
              ? (locationMap.get(r.sourceLocationId) ?? "Multi-source")
              : "Multi-source"
            : posLocationIdList
              ? (locationMap.get(posLocationIdList) ?? "Unknown")
              : r.sourceLocationId
                ? (locationMap.get(r.sourceLocationId) ?? "Multi-source")
                : "Multi-source",
          destinationLocationId: r.destinationLocationId,
          destinationLocationName: locationMap.get(r.destinationLocationId) ?? "Unknown",
          itemCount: myItems.length,
          totalAmount: Math.round(totalAmount * 100) / 100,
          stockItemNames,
          createdAt: r.createdAt,
        };
      });

      // For POS users: show transfers where their location is destination OR source
      // (Kolwezi/Kolwezi 2 are destinations; Hadi 1/2/3/4 are sources)
      const result =
        posLocationIdList !== null
          ? allResult.filter(
              (r) =>
                r.destinationLocationId === posLocationIdList ||
                r.sourceLocationId === posLocationIdList ||
                transfersWithMySourceItem.has(r.transferId)
            )
          : allResult;

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Stock Transfers - GET endpoint
  app.get("/api/stock-transfers", requireAuth, async (req, res) => {
    try {
      const voucherId = req.query.voucherId ? parseInt(req.query.voucherId as string) : null;

      if (!voucherId) {
        return res.status(400).json({ message: "voucherId query parameter is required" });
      }

      const transfer = await storage.getStockTransferByVoucherId(voucherId);
      res.json(transfer);
    } catch (error: any) {
      console.error("[Stock Transfer GET] Error:", error.message);
      res.status(500).json({ message: error.message });
    }
  });

  // Stock Transfers - POST endpoint (supports both creating new and using existing voucher)
  app.post("/api/stock-transfers", requireAuth, async (req, res) => {
    const _t = Date.now();
    const _uid = req.session.userId;
    const _cid = req.session.currentCompanyId;
    try {
      logger.info("stock transfer create started", { module: "stockTransfer", action: "create", userId: _uid, companyId: _cid });
      const {
        voucherId,
        sourceLocationId,
        destinationLocationId,
        notes,
        items,
        allowNegativeInventory,
        voucherDate,
        optional,
      } = req.body;

      // Log if user confirmed negative inventory override
      if (allowNegativeInventory) {
        console.log(
          `[AUDIT] User ${req.session.userId} confirmed negative inventory override for stock transfer. Items: ${JSON.stringify(items.map((i: any) => ({ stockItemId: i.stockItemId, quantity: i.quantity, sourceLocationId: i.sourceLocationId })))}`
        );
      }
      const companyId = req.session.currentCompanyId;

      // Branch: Create new transfer from scratch (sourceLocationId provided, no voucherId)
      if (
        !voucherId &&
        (sourceLocationId || (items && items.length > 0 && items.every((i: any) => i.sourceLocationId)))
      ) {
        if (!companyId) {
          return res.status(400).json({ message: "No company selected" });
        }
        if (!destinationLocationId) {
          return res.status(400).json({ message: "Destination location is required" });
        }
        if (!items || !Array.isArray(items) || items.length === 0) {
          return res.status(400).json({ message: "Items are required" });
        }
        // Input validation assertions for inventory safety
        for (const item of items) {
          const itemSourceId = item.sourceLocationId || sourceLocationId;
          if (!itemSourceId || isNaN(Number(itemSourceId))) {
            return res
              .status(400)
              .json({ message: `Invalid sourceLocationId for item ${item.stockItemId}: ${itemSourceId}` });
          }
          if (!item.stockItemId || isNaN(Number(item.stockItemId))) {
            return res.status(400).json({ message: `Invalid stockItemId: ${item.stockItemId}` });
          }
          const qty = parseFloat(item.quantity);
          if (isNaN(qty) || !isFinite(qty) || qty <= 0) {
            return res.status(400).json({ message: `Invalid quantity for item ${item.stockItemId}: ${item.quantity}` });
          }
        }
        if (isNaN(Number(destinationLocationId))) {
          return res.status(400).json({ message: `Invalid destinationLocationId: ${destinationLocationId}` });
        }

        // Compute multi-source detection
        const uniqueSourceIds = new Set(items.map((i: any) => i.sourceLocationId || sourceLocationId).filter(Boolean));
        const resolvedHeaderSourceId = uniqueSourceIds.size === 1 ? Array.from(uniqueSourceIds)[0] : null;

        // Validate source/dest not the same (only for single-source mode)
        if (resolvedHeaderSourceId && resolvedHeaderSourceId === destinationLocationId) {
          return res.status(400).json({ message: "Source and destination must be different" });
        }

        // Validate destination location exists
        const destLocation = await storage.getLocationById(destinationLocationId);
        if (!destLocation) {
          return res.status(404).json({ message: "Destination location not found" });
        }

        // Validate each item has a valid source location
        for (const item of items) {
          const itemSourceId = item.sourceLocationId || sourceLocationId;
          if (!itemSourceId) {
            return res.status(400).json({ message: "Each item must have a source location" });
          }
          if (itemSourceId === destinationLocationId) {
            return res
              .status(400)
              .json({ message: `Item ${item.stockItemId}: Source and destination cannot be the same` });
          }
        }
        // Create Stock Transfer voucher, items, and update inventory atomically
        const voucherNumber = `ST-${Date.now()}`;
        const effectiveDate = voucherDate || getClientDate(req);

        const txResult = await db.transaction(async (tx) => {
          const [newVoucher] = await tx
            .insert(vouchers)
            .values({
              companyId,
              voucherType: "Stock Transfer",
              voucherNumber,
              voucherDate: effectiveDate,
              description: notes || null,
              totalAmount: "0",
              optional: optional === true,
            })
            .returning();

          const [transfer] = await tx
            .insert(stockTransferVouchers)
            .values({
              voucherId: newVoucher.id,
              sourceLocationId: resolvedHeaderSourceId,
              destinationLocationId,
              notes: notes || null,
              inventoryApplied: optional !== true,
            })
            .returning();

          let totalAmount = 0;
          const transferItems = [];

          for (const item of items) {
            const quantity = parseFloat(item.quantity);

            const [sourceInv] = await tx
              .select({ averageRate: inventory.averageRate, quantity: inventory.quantity })
              .from(inventory)
              .where(
                and(
                  eq(inventory.locationId, item.sourceLocationId || sourceLocationId),
                  eq(inventory.stockItemId, item.stockItemId)
                )
              )
              .limit(1);

            const rate = parseFloat(sourceInv?.averageRate || "0");
            const totalItemAmount = quantity * rate;
            totalAmount += totalItemAmount;

            const [insertedItem] = await tx
              .insert(stockTransferItems)
              .values({
                transferId: transfer.id,
                stockItemId: item.stockItemId,
                sourceLocationId: item.sourceLocationId || sourceLocationId,
                quantity: quantity.toString(),
                rate: rate.toFixed(2),
                totalAmount: totalItemAmount.toFixed(2),
              })
              .returning();

            transferItems.push(insertedItem);

            // Only update inventory for non-optional (confirmed) transfers
            if (!optional) {
              // Deduct from source location (transfer out = negative delta)
              await adjustInventory(
                tx,
                item.sourceLocationId || sourceLocationId,
                item.stockItemId,
                -quantity,
                companyId!
              );

              // Add to destination location (transfer in = positive delta with rate)
              await adjustInventory(tx, destinationLocationId, item.stockItemId, quantity, companyId!, rate);
            }
          }

          await tx
            .update(vouchers)
            .set({ totalAmount: totalAmount.toFixed(2) })
            .where(eq(vouchers.id, newVoucher.id));

          return { transfer, transferItems, newVoucher };
        });

        res.status(201).json({
          transfer: txResult.transfer,
          items: txResult.transferItems,
          voucher: txResult.newVoucher,
        });

        // Fire-and-forget: send transfer image to destination WA group (POS users only)
        if (req.user?.role === "POS")
          setImmediate(async () => {
            try {
              const waSourceId = txResult.transfer.sourceLocationId;
              let sourceName = "Multiple Sources";
              if (waSourceId) {
                const [srcLoc] = await db
                  .select({ name: locations.name })
                  .from(locations)
                  .where(eq(locations.id, waSourceId));
                if (srcLoc?.name) sourceName = srcLoc.name;
              }
              await sendTransferWhatsApp({
                destinationLocationId,
                sourceLocationName: sourceName,
                destLocationName: destLocation.name,
                items: txResult.transferItems.map((i) => ({
                  stockItemId: i.stockItemId,
                  quantity: parseFloat(i.quantity),
                })),
                voucherNumber: txResult.newVoucher.voucherNumber,
                voucherDate: txResult.newVoucher.voucherDate,
              });
            } catch (e: any) {
              console.error("[TransferWA] Failed to send:", e.message);
            }
          });
        return;
      }

      // Original flow: Use existing voucher (voucherId required)
      if (!voucherId) {
        return res.status(400).json({ message: "Either voucherId or sourceLocationId is required" });
      }
      if (!destinationLocationId) {
        return res.status(400).json({ message: "Destination location is required" });
      }
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "Items are required" });
      }

      // Validate that destination location exists
      const destLocation = await storage.getLocationById(destinationLocationId);
      if (!destLocation) {
        return res.status(404).json({ message: "Destination location not found" });
      }

      // Validate that voucher exists
      const voucher = await storage.getVoucherById(voucherId);
      if (!voucher) {
        return res.status(404).json({ message: "Voucher not found" });
      }

      // Validate items and their source locations
      for (const item of items) {
        if (!item.sourceLocationId) {
          return res.status(400).json({ message: "Source location is required for all items" });
        }
        if (!item.stockItemId) {
          return res.status(400).json({ message: "Stock item ID is required for all items" });
        }
        if (!item.quantity || parseFloat(item.quantity) <= 0) {
          return res.status(400).json({ message: "Quantity must be positive for all items" });
        }
        if (!item.rate || parseFloat(item.rate) < 0) {
          return res.status(400).json({ message: "Rate must be non-negative for all items" });
        }

        // Validate that source and destination are different for each item
        if (item.sourceLocationId === destinationLocationId) {
          return res.status(400).json({
            message: "Source and destination locations must be different for each item",
          });
        }

        // Validate that source location exists
        const sourceLocation = await storage.getLocationById(item.sourceLocationId);
        if (!sourceLocation) {
          return res.status(404).json({
            message: `Source location with ID ${item.sourceLocationId} not found`,
          });
        }
      }

      console.log("[Stock Transfer] Creating transfer:", {
        voucherId,
        destinationLocationId,
        itemCount: items.length,
      });

      // Auto-fill rate from inventory for items with no rate (e.g. POS users who don't see cost)
      const itemsWithRate = await Promise.all(
        items.map(async (item: any) => {
          if (!item.rate || parseFloat(item.rate) === 0) {
            const [invRow] = await db
              .select({ averageRate: inventory.averageRate })
              .from(inventory)
              .where(and(eq(inventory.locationId, item.sourceLocationId), eq(inventory.stockItemId, item.stockItemId)))
              .limit(1);
            const resolvedRate = parseFloat(invRow?.averageRate ?? "0");
            return { ...item, rate: resolvedRate.toFixed(2) };
          }
          return item;
        })
      );

      const transfer = await storage.createStockTransfer(voucherId, destinationLocationId, notes || "", itemsWithRate);

      // Update voucher totalAmount based on actual rates (important for POS transfers where rate starts at 0)
      const actualTotal = itemsWithRate.reduce((sum: number, item: any) => {
        return sum + parseFloat(item.quantity) * parseFloat(item.rate);
      }, 0);
      if (actualTotal > 0) {
        await db
          .update(vouchers)
          .set({ totalAmount: actualTotal.toFixed(2) })
          .where(eq(vouchers.id, voucherId));
      }

      console.log("[Stock Transfer] Transfer created successfully:", {
        transferId: transfer.transfer.id,
        itemsCount: transfer.items.length,
      });
      logger.info("stock transfer create succeeded", { module: "stockTransfer", action: "create", userId: _uid, companyId: _cid, durationMs: Date.now() - _t });
      res.status(201).json(transfer);

      // Fire-and-forget: send transfer image to destination WA group (POS users only, original-flow / voucherId path)
      if (req.user?.role === "POS")
        setImmediate(async () => {
          try {
            const uniqueSrcIds = [
              ...new Set(itemsWithRate.map((i: any) => Number(i.sourceLocationId)).filter(Boolean)),
            ];
            let sourceName = "Multiple Sources";
            if (uniqueSrcIds.length === 1) {
              const [srcLoc] = await db
                .select({ name: locations.name })
                .from(locations)
                .where(eq(locations.id, uniqueSrcIds[0]));
              if (srcLoc?.name) sourceName = srcLoc.name;
            }
            await sendTransferWhatsApp({
              destinationLocationId,
              sourceLocationName: sourceName,
              destLocationName: destLocation.name,
              items: transfer.items.map((i: any) => ({
                stockItemId: i.stockItemId,
                quantity: parseFloat(i.quantity),
              })),
              voucherNumber: voucher.voucherNumber,
              voucherDate: voucher.voucherDate,
            });
          } catch (e: any) {
            console.error("[TransferWA] Failed to send (original-flow):", e.message);
          }
        });
    } catch (error: any) {
      logger.error("stock transfer create failed", { module: "stockTransfer", action: "create", userId: _uid, companyId: _cid, durationMs: Date.now() - _t, error });
      console.error("[Stock Transfer] Error creating transfer:", error.message, error.stack);
      res.status(500).json({ message: error.message });
    }
  });

  // Stock Transfers - PATCH endpoint (notes-only update)
  app.patch("/api/stock-transfers/:id", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (!id) return res.status(400).json({ message: "Transfer ID is required" });
      const { notes } = req.body;
      await db
        .update(stockTransferVouchers)
        .set({ notes: notes ?? null })
        .where(eq(stockTransferVouchers.id, id))
        .execute();
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Transfer Revisions - GET by voucherId (must be before :transferId route)
  app.get("/api/stock-transfers/by-voucher/:voucherId/revisions", requireAuth, async (req, res) => {
    try {
      const voucherId = parseInt(req.params.voucherId);
      if (!voucherId) return res.status(400).json({ message: "Voucher ID required" });
      const transfer = await storage.getStockTransferByVoucherId(voucherId);
      if (!transfer) return res.json([]);
      req.params.transferId = String(transfer.id);
      // Fall through to transferId revisions logic by re-routing internally
      const transferId = transfer.id;

      const revisionRows = await db
        .select()
        .from(stockTransferRevisions)
        .where(eq(stockTransferRevisions.transferId, transferId))
        .orderBy(asc(stockTransferRevisions.revisionNumber));

      const allRevWithItems = await Promise.all(
        revisionRows.map(async (rev) => {
          const items = await db
            .select()
            .from(stockTransferRevisionItems)
            .where(eq(stockTransferRevisionItems.revisionId, rev.id));
          return { ...rev, items };
        })
      );

      const optionalRevs = allRevWithItems.filter((r) => r.optional);
      const nonOptionalRevs = allRevWithItems.filter((r) => !r.optional);
      type RevisionResponseItem = Omit<
        (typeof allRevWithItems)[number]["items"][number],
        "id" | "revisionId"
      > & {
        id?: number;
        revisionId?: number;
      };
      type RevisionResponse = Omit<(typeof allRevWithItems)[number], "items"> & {
        items: RevisionResponseItem[];
        _mergedCount?: number;
      };
      let finalRevisions: RevisionResponse[] = [...nonOptionalRevs];

      if (optionalRevs.length > 0) {
        const netMap = new Map<
          string,
          {
            stockItemId: number;
            stockItemName: string;
            sourceLocationId: number | null;
            sourceLocationName: string | null;
            originalQuantity: string;
            newQuantity: string;
            delta: string;
          }
        >();

        for (const rev of optionalRevs) {
          for (const item of rev.items) {
            const key = `${item.stockItemId}:${item.sourceLocationId ?? ""}`;
            const existing = netMap.get(key);
            if (!existing) {
              netMap.set(key, {
                stockItemId: item.stockItemId,
                stockItemName: item.stockItemName,
                sourceLocationId: item.sourceLocationId,
                sourceLocationName: item.sourceLocationName,
                originalQuantity: item.originalQuantity,
                newQuantity: item.newQuantity,
                delta: item.delta,
              });
            } else {
              const netDelta = parseFloat(item.newQuantity) - parseFloat(existing.originalQuantity);
              netMap.set(key, {
                ...existing,
                newQuantity: item.newQuantity,
                delta: String(netDelta),
              });
            }
          }
        }

        const first = optionalRevs[0];
        const last = optionalRevs[optionalRevs.length - 1];
        const mergedOptional = {
          ...first,
          note: last.note,
          revisionDate: last.revisionDate,
          _mergedCount: optionalRevs.length,
          items: Array.from(netMap.values()),
        };
        finalRevisions = [mergedOptional, ...nonOptionalRevs];
      }

      res.json(finalRevisions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Transfer Revisions - GET
  app.get("/api/stock-transfers/:transferId/revisions", requireAuth, async (req, res) => {
    try {
      const transferId = parseInt(req.params.transferId);
      if (!transferId) return res.status(400).json({ message: "Transfer ID required" });

      const revisionRows = await db
        .select()
        .from(stockTransferRevisions)
        .where(eq(stockTransferRevisions.transferId, transferId))
        .orderBy(asc(stockTransferRevisions.revisionNumber));

      // Fetch all items for all revisions
      const allRevWithItems = await Promise.all(
        revisionRows.map(async (rev) => {
          const items = await db
            .select()
            .from(stockTransferRevisionItems)
            .where(eq(stockTransferRevisionItems.revisionId, rev.id));
          return { ...rev, items };
        })
      );

      // Split optional (POS) and non-optional (admin) revisions
      const optionalRevs = allRevWithItems.filter((r) => r.optional);
      const nonOptionalRevs = allRevWithItems.filter((r) => !r.optional);

      type RevisionResponseItem = Omit<
        (typeof allRevWithItems)[number]["items"][number],
        "id" | "revisionId"
      > & {
        id?: number;
        revisionId?: number;
      };
      type RevisionResponse = Omit<(typeof allRevWithItems)[number], "items"> & {
        items: RevisionResponseItem[];
        _mergedCount?: number;
      };
      let finalRevisions: RevisionResponse[] = [...nonOptionalRevs];

      if (optionalRevs.length > 0) {
        // Merge all optional revisions into one, computing net delta per item
        // Key: `${stockItemId}:${sourceLocationId}`
        const netMap = new Map<
          string,
          {
            stockItemId: number;
            stockItemName: string;
            sourceLocationId: number | null;
            sourceLocationName: string | null;
            originalQuantity: string;
            newQuantity: string;
            delta: string;
          }
        >();

        for (const rev of optionalRevs) {
          for (const item of rev.items) {
            const key = `${item.stockItemId}:${item.sourceLocationId ?? ""}`;
            const existing = netMap.get(key);
            if (!existing) {
              // First time we see this item — take its originalQuantity as the baseline
              netMap.set(key, {
                stockItemId: item.stockItemId,
                stockItemName: item.stockItemName,
                sourceLocationId: item.sourceLocationId,
                sourceLocationName: item.sourceLocationName,
                originalQuantity: item.originalQuantity,
                newQuantity: item.newQuantity,
                delta: item.delta,
              });
            } else {
              // Update with latest newQuantity and recompute net delta
              const origQty = parseFloat(existing.originalQuantity);
              const newQty = parseFloat(item.newQuantity);
              const netDelta = newQty - origQty;
              netMap.set(key, {
                ...existing,
                newQuantity: String(newQty),
                delta: netDelta >= 0 ? `+${netDelta}` : String(netDelta),
              });
            }
          }
        }

        // Use the earliest optional revision as the "shell" for metadata
        const earliest = optionalRevs[0];
        const latest = optionalRevs[optionalRevs.length - 1];
        const mergedRevision = {
          ...earliest,
          revisionNumber: earliest.revisionNumber,
          revisionDate: latest.revisionDate,
          note: latest.note ?? earliest.note,
          items: Array.from(netMap.values()),
          // synthetic flag: how many optional revs were merged
          _mergedCount: optionalRevs.length,
        };

        finalRevisions = [mergedRevision, ...nonOptionalRevs].sort((a, b) => a.revisionNumber - b.revisionNumber);
      }

      res.json(finalRevisions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

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
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

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
      let revision: any = null;
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
        items.map((item: any) => ({
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

            const uniqueSrcNames = [...new Set(items.map((i: any) => i.sourceLocationName).filter(Boolean))];
            const sourceName = uniqueSrcNames.length === 1 ? uniqueSrcNames[0] : "Multiple Sources";

            // Use the first item's sourceLocationId to route to the source WA group
            const srcLocationId = items.find((i: any) => i.sourceLocationId)?.sourceLocationId ?? null;
            if (!srcLocationId) return;

            const waItems = items.map((i: any) => ({
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
          } catch (e: any) {
            console.error("[RevisedTransferWA] Failed to send (revision):", e.message);
          }
        });
    } catch (error: any) {
      console.error("[Revision POST] Error:", error.message);
      res.status(500).json({ message: error.message });
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
    } catch (error: any) {
      res.status(500).json({ message: error.message });
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
    } catch (error: any) {
      console.error("[Revision Approve] Error:", error.message);
      res.status(500).json({ message: error.message });
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
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Stock Transfers - PUT endpoint (update)
  app.put("/api/stock-transfers/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (!id) {
        return res.status(400).json({ message: "Transfer ID is required" });
      }

      // Validate request body using Zod
      const parseResult = updateStockTransferSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          message: "Invalid request data",
          errors: parseResult.error.issues,
        });
      }

      const { destinationLocationId, notes, items } = parseResult.data;

      // Validate that source !== destination for each item
      const invalidItem = items.find((item) => item.sourceLocationId === destinationLocationId);
      if (invalidItem) {
        return res.status(400).json({ message: "Source and destination locations must be different for each item" });
      }

      // Convert numbers back to strings with fixed precision for storage layer
      const itemsForStorage = items.map((item) => ({
        sourceLocationId: item.sourceLocationId,
        stockItemId: item.stockItemId,
        quantity: item.quantity.toFixed(3),
        rate: item.rate.toFixed(2),
      }));

      // Update the stock transfer using the storage method
      const updated = await storage.updateStockTransfer(id, destinationLocationId, notes || "", itemsForStorage);

      // Recalculate voucher totalAmount based on updated items
      const newTotalAmount = items.reduce((sum, item) => sum + item.quantity * item.rate, 0);
      await db
        .update(vouchers)
        .set({ totalAmount: newTotalAmount.toFixed(2) })
        .where(eq(vouchers.id, updated.transfer.voucherId));

      res.json(updated);
    } catch (error: any) {
      console.error("[Stock Transfer PUT] Error:", error.message);

      // Check if this is a legacy transfer validation error (400) vs server error (500)
      if (error.message && error.message.includes("missing source location data")) {
        return res.status(400).json({ message: error.message });
      }

      res.status(500).json({ message: error.message });
    }
  });

  registerStockAdjustmentWasteRoutes(app);

}
