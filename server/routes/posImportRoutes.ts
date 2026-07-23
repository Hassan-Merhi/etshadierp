/**
 * POS Excel-import routes.
 *
 * Parse / validate / import for POS-sale spreadsheets, plus the template
 * download. Extracted from importRoutes.ts as a sub-registrar; behaviour is
 * unchanged.
 */
import type { Express } from "express";
import { logger } from "../lib/logger";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth } from "../auth";
import { upload } from "./_helpers";
import { adjustInventory } from "../inventoryHelper";
import { readExcel, sheetToJson, createWorkbook, jsonToSheet, writeWorkbook } from "../excelHelper";
import { getClientDate } from "../lib/dateUtils";
import { generateInvoicePdf } from "../helpers/generateInvoicePdf";
import { generateStockPdf } from "../helpers/generateStockPdf";
import { getErpExportVisibility } from "../helpers/exportVisibility";
import { sendWhatsAppFileByUploadPos, sendWhatsAppFileToChatIdPos } from "../services/whatsappService";
import {
  vouchers,
  voucherEntries,
  salesItems,
  companies,
  inventory,
  stockItemLocationPrices,
} from "@shared/schema";

export function registerPosImportRoutes(app: Express) {
  // POS Import - Parse and Preview Excel
  app.post("/api/pos-import/parse", requireAuth, upload.single("file"), async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const workbook = await readExcel(req.file.buffer);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rawData = sheetToJson(worksheet);

      if (rawData.length === 0) {
        return res.status(400).json({ message: "Excel file is empty" });
      }

      // Parse rows
      const rows = rawData as any[];
      const items: any[] = [];
      let totalValue = 0;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;

        // Expected columns: Barcode, Quantity, Rate
        const barcode = row.Barcode || row.barcode || row.Code || row.code;
        const quantity = parseFloat(row.Quantity || row.quantity || row.Qty || row.qty || "0");
        const rate = parseFloat(row.Rate || row.rate || row.Price || row.price || "0");

        if (!barcode) {
          continue; // Skip rows without barcode
        }

        if (quantity <= 0 || rate <= 0) {
          continue; // Skip invalid quantities/rates
        }

        const itemValue = quantity * rate;
        totalValue += itemValue;

        items.push({
          rowNum,
          barcode: barcode.toString().trim(),
          quantity,
          rate,
          value: itemValue,
        });
      }

      res.json({
        items,
        totalValue,
        fileName: req.file.originalname,
      });
    } catch (error: any) {
      logger.error("POS Import parse error:", { error: error });
      // File-parse errors are client errors (bad/corrupt file) — return 400, not 500
      res.status(400).json({ message: error.message || "Failed to parse Excel file" });
    }
  });

  // POS Import - Validate data before import
  app.post("/api/pos-import/validate", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { locationId, items } = req.body;

      if (!locationId || !items || !Array.isArray(items)) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const errors: string[] = [];
      const warnings: string[] = [];
      const validatedItems: any[] = [];

      // Validate location exists
      const location = await storage.getLocationById(locationId);
      if (!location) {
        errors.push("Selected location not found");
        return res.json({ errors, warnings, validatedItems });
      }

      // Get all stock items for validation
      const allStockItems = await storage.getAllStockItems(req.session.currentCompanyId!);

      // Validate each item
      for (const item of items) {
        const validatedItem: any = { ...item };

        // Find stock item by barcode (code or alias)
        const stockItem = await storage.getStockItemByCodeOrAlias(item.barcode, req.session.currentCompanyId!);

        if (!stockItem) {
          validatedItem.error = `Barcode '${item.barcode}' not found in stock items`;
          errors.push(`Row ${item.rowNum}: Barcode '${item.barcode}' not found`);
        } else {
          validatedItem.stockItemId = stockItem.id;
          validatedItem.stockItemName = stockItem.name;
          validatedItem.stockItemUom = stockItem.uom;

          // Check if location has this item in inventory for cost price calculation
          const inventoryItem = await db
            .select()
            .from(inventory)
            .where(and(eq(inventory.stockItemId, stockItem.id), eq(inventory.locationId, locationId)))
            .limit(1);

          // Get cost price for profit calculation and check inventory levels
          if (inventoryItem.length > 0) {
            validatedItem.costPrice = parseFloat(inventoryItem[0].averageRate || "0");
            const currentQty = parseFloat(inventoryItem[0].quantity || "0");
            const saleQty = parseFloat(item.quantity);
            const remainingQty = currentQty - saleQty;

            validatedItem.currentStock = currentQty;
            validatedItem.remainingStock = remainingQty;

            // Add warnings for low or negative stock
            if (remainingQty < 0) {
              validatedItem.warning = `Stock will go negative (${remainingQty.toFixed(2)} ${stockItem.uom})`;
              warnings.push(
                `${stockItem.name}: Stock will go negative (Current: ${currentQty.toFixed(2)}, Selling: ${saleQty.toFixed(2)}, Remaining: ${remainingQty.toFixed(2)} ${stockItem.uom})`
              );
            } else if (remainingQty === 0) {
              validatedItem.warning = `Stock will reach zero`;
              warnings.push(
                `${stockItem.name}: Stock will reach zero (Current: ${currentQty.toFixed(2)}, Selling: ${saleQty.toFixed(2)} ${stockItem.uom})`
              );
            }
          } else {
            // No inventory at this location
            validatedItem.currentStock = 0;
            validatedItem.remainingStock = -parseFloat(item.quantity);
            validatedItem.warning = `No stock at this location, will go negative`;
            warnings.push(`${stockItem.name}: No stock at this location (Selling: ${item.quantity} ${stockItem.uom})`);
          }
        }

        validatedItems.push(validatedItem);
      }

      res.json({
        errors,
        warnings,
        validatedItems,
      });
    } catch (error: any) {
      logger.error("POS Import validation error:", { error: error });
      res.status(500).json({ message: error.message });
    }
  });

  // POS Import - Import sales transactions
  app.post("/api/pos-import/import", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { locationId, saleDate, items, cashAccountId } = req.body;

      if (!locationId || !saleDate || !items || !Array.isArray(items) || !cashAccountId) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      // Validate location
      const location = await storage.getLocationById(locationId);
      if (!location) {
        return res.status(400).json({ message: "Location not found" });
      }

      // Validate cash account
      const cashAccount = await storage.getLedgerAccountById(cashAccountId);
      if (!cashAccount || cashAccount.companyId !== req.session.currentCompanyId) {
        return res.status(400).json({ message: "Invalid cash account" });
      }

      // Get or create "Sales Revenue" ledger account (safe: handles soft-deleted rows)
      const salesRevenueAccount = await storage.getOrCreateLedgerAccount({
        companyId: req.session.currentCompanyId!,
        code: "SALES_REV",
        name: "Sales Revenue",
        accountType: "Income",
        subType: "Direct Income",
        openingBalance: "0",
        openingBalanceSide: "Cr",
        active: true,
      });

      // Get or create "Cost of Goods Sold" ledger account (safe: handles soft-deleted rows)
      const cogsAccount = await storage.getOrCreateLedgerAccount({
        companyId: req.session.currentCompanyId!,
        code: "COGS",
        name: "Cost of Goods Sold",
        accountType: "Expense",
        subType: "Direct Expense",
        openingBalance: "0",
        openingBalanceSide: "Dr",
        active: true,
      });

      let totalSales = 0;
      let createdVoucher: any = null;

      await db.transaction(async (tx) => {
        // Create sales voucher
        const voucherNumber = `SALES-${Date.now()}`;

        const [voucher] = await tx
          .insert(vouchers)
          .values({
            companyId: req.session.currentCompanyId!,
            locationId,
            locationName: location.name,
            voucherNumber,
            voucherType: "Sales",
            voucherDate: saleDate,
            description: `POS Import - ${items.length} items`,
            totalAmount: "0", // Will be updated with actual total
          })
          .returning();

        // Create sales items and update inventory
        for (const item of items) {
          // Get stock item
          const stockItem = await storage.getStockItemByCodeOrAlias(item.barcode, req.session.currentCompanyId!);
          if (!stockItem) {
            // Bad user input (unknown barcode) → should be 400, not 500.
            // Throw inside the transaction so the tx rolls back cleanly; the
            // tagged httpStatus lets the outer catch return the right status code.
            const inputErr: any = new Error(`Stock item not found for barcode: ${item.barcode}`);
            inputErr.httpStatus = 400;
            throw inputErr;
          }

          // Get current inventory (allow negative stock for historical sales import)
          const [inventoryRecord] = await tx
            .select()
            .from(inventory)
            .where(and(eq(inventory.stockItemId, stockItem.id), eq(inventory.locationId, locationId)))
            .limit(1);

          // Get cost price and current quantity (allow imports with zero/negative stock)
          let costPrice = 0;
          let currentQty = 0;

          if (inventoryRecord) {
            costPrice = parseFloat(inventoryRecord.averageRate || "0");
            currentQty = parseFloat(inventoryRecord.quantity);
          }

          const itemSales = item.quantity * item.rate;
          const itemCost = item.quantity * costPrice;
          const profit = itemSales - itemCost;

          totalSales += itemSales;

          // Look up configured price for this item/location
          const [importCashLocPrice] = await tx
            .select()
            .from(stockItemLocationPrices)
            .where(
              and(
                eq(stockItemLocationPrices.stockItemId, stockItem.id),
                eq(stockItemLocationPrices.locationId, locationId)
              )
            )
            .limit(1);
          const importCashConfiguredPrice = parseFloat(
            importCashLocPrice?.sellingPrice || stockItem.sellingPrice || "0"
          );

          // Create sales item record
          await tx.insert(salesItems).values({
            voucherId: voucher.id,
            stockItemId: stockItem.id,
            quantity: item.quantity.toString(),
            sellingPrice: item.rate.toString(),
            costPrice: costPrice.toString(),
            totalSales: itemSales.toString(),
            totalCost: itemCost.toString(),
            profit: profit.toString(),
            configuredPrice: importCashConfiguredPrice > 0 ? importCashConfiguredPrice.toFixed(6) : null,
          });

          // Note: COGS is tracked in sales_items table but not posted to ledger
          // because this system uses purchase-date expense recognition (not COGS method)

          // Update or create inventory record - allow negative stock
          await adjustInventory(tx, locationId, stockItem.id, -item.quantity, req.session.currentCompanyId!);
        }

        // Create BALANCED voucher entries for double-entry bookkeeping
        // Periodic inventory system: Purchases are expensed when purchased
        // Sales recognize revenue immediately; COGS calculated at period-end

        // Entry 1: Debit Cash Account (Asset increases with debit)
        await tx.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: cashAccountId,
          debitAmount: totalSales.toString(),
          creditAmount: "0",
          narration: `Cash from POS Sales - ${items.length} items`,
        });

        // Entry 2: Credit Sales Revenue (Income increases with credit)
        await tx.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: salesRevenueAccount.id,
          debitAmount: "0",
          creditAmount: totalSales.toString(),
          narration: `Sales Revenue - ${items.length} items`,
        });

        // Update voucher with total amount
        await tx
          .update(vouchers)
          .set({
            totalAmount: totalSales.toString(),
          })
          .where(eq(vouchers.id, voucher.id));

        createdVoucher = voucher;
      });

      res.json({
        success: true,
        voucher: createdVoucher,
        itemsCount: items.length,
        totalSales: totalSales.toFixed(2),
      });

      // Background: send invoice + stock report after response is already sent
      if (createdVoucher && location.whatsappGroupChatId) {
        const _companyId = req.session.currentCompanyId!;
        const _chatId = location.whatsappGroupChatId;
        const _locName = location.name;
        const _locId = locationId;
        const _saleDate = saleDate;
        const _voucherDate = createdVoucher.voucherDate;
        const _voucherId = createdVoucher.id;
        const _senderName = (req as any).user?.username || "Import";
        const _dateStr = getClientDate(req);
        setImmediate(async () => {
          // 1. Invoice PDF
          try {
            const waVis = await getErpExportVisibility(req);
            // P/L cols auto-hide in the PDF generator when no configured price exists — don't gate on hideSalesProfitCost
            const hideProfitCols = waVis.hideSelling || waVis.hideCost;
            const pdfBuffer = await generateInvoicePdf(_voucherId, _companyId, _senderName, { hideProfitCols });
            const safeDate = (_voucherDate ?? _saleDate).replace(/[^0-9-]/g, "");
            const fileName =
              `${_locName} Invoice ${safeDate}`
                .replace(/[^\w\s.()\-]/g, "_")
                .replace(/\s+/g, " ")
                .trim() + ".pdf";
            const invResult = await sendWhatsAppFileByUploadPos(_chatId, pdfBuffer, fileName, "");
            if (!invResult.success) logger.error(`[POSImport-bg] Invoice send failed: ${invResult.error}`);
            else logger.info(`[POSImport-bg] Invoice sent: ${fileName} → ${_chatId}`);
          } catch (e: any) {
            logger.error("[POSImport-bg] Invoice send error:", { error: e.message });
          }

          // 2. Stock report PDF
          try {
            const [co] = await db
              .select({ name: companies.name })
              .from(companies)
              .where(eq(companies.id, _companyId))
              .limit(1);
            const companyName = co?.name || "Company";
            const {
              buffer: stockBuf,
              pageCount,
              rowCount,
            } = await generateStockPdf(_companyId, companyName, _locId, _locName);
            const maxAllowedPages = Math.ceil(rowCount / 20) + 5;
            if (pageCount > maxAllowedPages) {
              logger.error(
                `[POSImport-bg] Stock PDF safety guard: ${pageCount} pages for ${rowCount} rows — not sent`
              );
            } else {
              const stampStr = new Date().toLocaleString("en-GB", {
                day: "2-digit",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              });
              const stockName = `${_locName} STK ${companyName} ${_dateStr}`.replace(/[^\w\s.()\-]/g, "_").trim();
              const stockRes = await sendWhatsAppFileToChatIdPos(
                _chatId,
                stockBuf,
                `${stockName}.pdf`,
                `Stock Report — ${_locName}\n${stampStr}`
              );
              if (!stockRes.success) logger.error(`[POSImport-bg] Stock send failed: ${stockRes.error}`);
              else logger.info(`[POSImport-bg] Stock report sent: ${stockName}.pdf → ${_chatId}`);
            }
          } catch (e: any) {
            logger.error("[POSImport-bg] Stock send error:", { error: e.message });
          }
        });
      }
    } catch (error: any) {
      // httpStatus=400 means bad user input (e.g. unknown barcode); transaction
      // already rolled back at this point.
      if (error.httpStatus === 400) {
        return res.status(400).json({ message: error.message });
      }
      logger.error("POS Import error:", { error: error });
      res.status(500).json({ message: error.message });
    }
  });

  // Download sample POS import template
  app.get("/api/pos-import/template", async (_req, res) => {
    try {
      const sampleData = [
        {
          Barcode: "BC001",
          Quantity: 5,
          Rate: 25.0,
        },
        {
          Barcode: "BC002",
          Quantity: 3,
          Rate: 35.5,
        },
        {
          Barcode: "BC003",
          Quantity: 10,
          Rate: 15.75,
        },
      ];

      const workbook = createWorkbook();
      jsonToSheet(workbook, sampleData, "POS Import");

      const buffer = await writeWorkbook(workbook);

      res.setHeader("Content-Disposition", "attachment; filename=POS_Import_Template.xlsx");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.send(buffer);
    } catch (error: any) {
      logger.error("Template generation error:", { error: error });
      res.status(500).json({ message: error.message });
    }
  });
}
