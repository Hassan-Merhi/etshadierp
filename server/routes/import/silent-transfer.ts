/**
 * importRoutes: SilentTransfer endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { db } from "../../db";
import { storage } from "../../storage";
import { requireAuth, requireNonPOS } from "../../auth";
import { upload } from "../_helpers";
import { inventory } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { readExcel, sheetToJson, createWorkbook, jsonToSheet, writeWorkbook } from "../../excelHelper";
import { adjustInventory } from "../../inventoryHelper";

export function registerSilentTransferRoutes(app: Express) {
  // Template download
  app.get("/api/inventory/silent-transfer/template", requireAuth, requireNonPOS, async (_req, res) => {
    try {
      const sampleData = [
        { Barcode: "BC001", Quantity: 10 },
        { Barcode: "BC002", Quantity: 5 },
        { Barcode: "BC003", Quantity: 20 },
      ];
      const workbook = createWorkbook();
      jsonToSheet(workbook, sampleData, "Transfer");
      const buffer = await writeWorkbook(workbook);
      res.setHeader("Content-Disposition", "attachment; filename=Silent_Transfer_Template.xlsx");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.send(buffer);
    } catch (err: unknown) {
      res.status(500).json({ message: getErrorMessage(err) });
    }
  });

  // Parse + validate uploaded Excel — returns structured validation results
  app.post(
    "/api/inventory/silent-transfer/parse",
    requireAuth,
    requireNonPOS,
    upload.single("file"),
    async (req, res) => {
      try {
        const companyId = req.session.currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });
        if (!req.file) return res.status(400).json({ message: "No file uploaded" });

        const { sourceLocationId, destinationLocationId } = req.body;
        if (!sourceLocationId || !destinationLocationId) {
          return res.status(400).json({ message: "Source and destination locations are required" });
        }

        const srcId = parseInt(sourceLocationId);
        const dstId = parseInt(destinationLocationId);
        if (srcId === dstId) return res.status(400).json({ message: "Source and destination must be different" });

        const sourceLocation = await storage.getLocationById(srcId);
        const destLocation = await storage.getLocationById(dstId);
        if (!sourceLocation) return res.status(400).json({ message: "Source location not found" });
        if (!destLocation) return res.status(400).json({ message: "Destination location not found" });

        const workbook = await readExcel(req.file.buffer);
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const rawData = sheetToJson(worksheet) as any[];

        if (rawData.length === 0) return res.status(400).json({ message: "Excel file is empty" });

        // Three output buckets
        const errorLines: Array<{ rowNum: number; barcode: string; reason: string }> = [];
        const validItems: any[] = [];
        const warnItems: any[] = []; // insufficient stock but can still be applied

        // Track barcodes already seen to detect duplicates in the file
        const seenBarcodes = new Map<string, number>(); // barcode → first rowNum

        for (let i = 0; i < rawData.length; i++) {
          const row = rawData[i];
          const rowNum = i + 2;
          const barcode = (row.Barcode || row.barcode || row.Code || row.code || "").toString().trim();
          const quantityRaw = row.Quantity ?? row.quantity ?? row.Qty ?? row.qty;
          const quantity = parseFloat(quantityRaw ?? "0");

          if (!barcode) continue; // blank row — silently skip

          // Duplicate barcode in same file
          if (seenBarcodes.has(barcode)) {
            errorLines.push({
              rowNum,
              barcode,
              reason: `Duplicate — already listed at row ${seenBarcodes.get(barcode)}`,
            });
            continue;
          }
          seenBarcodes.set(barcode, rowNum);

          // Invalid quantity
          if (isNaN(quantity) || quantity <= 0) {
            errorLines.push({ rowNum, barcode, reason: "Quantity must be a positive number" });
            continue;
          }

          // Look up stock item
          const stockItem = await storage.getStockItemByCodeOrAlias(barcode, companyId);
          if (!stockItem) {
            errorLines.push({ rowNum, barcode, reason: "Barcode / code not found in stock items" });
            continue;
          }

          // Check inventory at source
          const [srcInv] = await db
            .select()
            .from(inventory)
            .where(and(eq(inventory.stockItemId, stockItem.id), eq(inventory.locationId, srcId)))
            .limit(1);

          const currentStock = srcInv ? parseFloat(srcInv.quantity || "0") : 0;
          const averageRate = srcInv ? parseFloat(srcInv.averageRate || "0") : 0;
          const afterTransfer = currentStock - quantity;

          const item = {
            rowNum,
            barcode,
            stockItemId: stockItem.id,
            stockItemName: stockItem.name,
            uom: stockItem.uom || "",
            quantity,
            currentStock,
            averageRate,
            afterTransfer,
          };

          if (currentStock <= 0 && quantity > 0) {
            // No stock at all at this source
            warnItems.push({ ...item, warnReason: `No stock at source (available: 0)` });
          } else if (afterTransfer < 0) {
            // Partial stock — will go negative
            warnItems.push({
              ...item,
              warnReason: `Insufficient stock (available: ${currentStock.toFixed(2)}, short by: ${Math.abs(afterTransfer).toFixed(2)})`,
            });
          } else {
            validItems.push(item);
          }
        }

        res.json({
          validItems,
          warnItems,
          errorLines,
          sourceLocation: sourceLocation.name,
          destLocation: destLocation.name,
          totalRows: rawData.filter((r) => (r.Barcode || r.barcode || r.Code || r.code || "").toString().trim()).length,
        });
      } catch (err: unknown) {
        logger.error("Silent transfer parse error:", { error: err });
        res.status(500).json({ message: getErrorMessage(err) });
      }
    }
  );

  // Apply the silent transfer — directly updates inventory, no voucher created
  app.post("/api/inventory/silent-transfer/apply", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { sourceLocationId, destinationLocationId, items } = req.body;
      if (!sourceLocationId || !destinationLocationId || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const srcId = parseInt(sourceLocationId);
      const dstId = parseInt(destinationLocationId);
      if (srcId === dstId) return res.status(400).json({ message: "Source and destination must be different" });

      await db.transaction(async (tx) => {
        for (const item of items) {
          const qty = parseFloat(item.quantity);
          const rate = parseFloat(item.averageRate || "0");
          if (qty <= 0) continue;
          await adjustInventory(tx, srcId, item.stockItemId, -qty, companyId);
          await adjustInventory(tx, dstId, item.stockItemId, qty, companyId, rate);
        }
      });

      res.json({ success: true, itemsTransferred: items.length });
    } catch (err: unknown) {
      logger.error("Silent transfer apply error:", { error: err });
      res.status(500).json({ message: getErrorMessage(err) });
    }
  });
}
