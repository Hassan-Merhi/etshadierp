/**
 * Credit-sales Excel-import routes.
 *
 * Parse / validate / import for credit-sales spreadsheets, plus the template
 * download. Extracted from importRoutes.ts as a sub-registrar; behaviour is
 * unchanged.
 */
import type { Express } from "express";
import { and, desc, eq } from "drizzle-orm";
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
  customerBalances,
  inventory,
  stockItemLocationPrices,
} from "@shared/schema";

export function registerCreditSalesImportRoutes(app: Express) {
  // ============= Credit Sales Import Endpoints =============

  // Credit Sales Import - Parse and Preview Excel (same as POS but for credit sales)
  app.post("/api/credit-sales-import/parse", requireAuth, upload.single("file"), async (req, res) => {
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

      const rows = rawData as any[];
      const items: any[] = [];
      let totalValue = 0;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;

        const barcode = row.Barcode || row.barcode || row.Code || row.code;
        const quantity = parseFloat(row.Quantity || row.quantity || row.Qty || row.qty || "0");
        const rate = parseFloat(row.Rate || row.rate || row.Price || row.price || "0");

        if (!barcode) {
          continue;
        }

        if (quantity <= 0 || rate <= 0) {
          continue;
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
      console.error("Credit Sales Import parse error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Credit Sales Import - Validate data before import
  app.post("/api/credit-sales-import/validate", requireAuth, async (req, res) => {
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

      const location = await storage.getLocationById(locationId);
      if (!location) {
        errors.push("Selected location not found");
        return res.json({ errors, warnings, validatedItems });
      }

      for (const item of items) {
        const validatedItem: any = { ...item };

        const stockItem = await storage.getStockItemByCodeOrAlias(item.barcode, req.session.currentCompanyId!);

        if (!stockItem) {
          validatedItem.error = `Barcode '${item.barcode}' not found in stock items`;
          errors.push(`Row ${item.rowNum}: Barcode '${item.barcode}' not found`);
        } else {
          validatedItem.stockItemId = stockItem.id;
          validatedItem.stockItemName = stockItem.name;
          validatedItem.stockItemUom = stockItem.uom;

          const inventoryItem = await db
            .select()
            .from(inventory)
            .where(and(eq(inventory.stockItemId, stockItem.id), eq(inventory.locationId, locationId)))
            .limit(1);

          if (inventoryItem.length > 0) {
            validatedItem.costPrice = parseFloat(inventoryItem[0].averageRate || "0");
            const currentQty = parseFloat(inventoryItem[0].quantity || "0");
            const saleQty = parseFloat(item.quantity);
            const remainingQty = currentQty - saleQty;

            validatedItem.currentStock = currentQty;
            validatedItem.remainingStock = remainingQty;

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
      console.error("Credit Sales Import validation error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Credit Sales Import - Import credit sales transactions
  app.post("/api/credit-sales-import/import", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { locationId, saleDate, items, customerId } = req.body;

      if (!locationId || !saleDate || !items || !Array.isArray(items) || !customerId) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const location = await storage.getLocationById(locationId);
      if (!location) {
        return res.status(400).json({ message: "Location not found" });
      }

      let customer = await storage.getCustomerById(customerId);
      if (!customer || customer.companyId !== req.session.currentCompanyId) {
        return res.status(400).json({ message: "Invalid customer" });
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

      // Get or create the customer's linked ledger account for receivables
      let customerLedgerAccountId = customer.ledgerAccountId;
      if (!customerLedgerAccountId) {
        const customerLedgerCode = `CUST_${customer.code}`;
        // Safe: reactivates a soft-deleted row instead of crashing on unique constraint
        const customerLedgerAccount = await storage.getOrCreateLedgerAccount({
          companyId: req.session.currentCompanyId!,
          code: customerLedgerCode,
          name: `${customer.legalName} - Receivable`,
          accountType: "Asset",
          subType: "Sundry Debtors",
          openingBalance: "0",
          openingBalanceSide: "Dr",
          active: true,
        });
        const updatedCustomer = await storage.updateCustomer(customer.id, {
          ledgerAccountId: customerLedgerAccount.id,
        });
        if (updatedCustomer) customer = updatedCustomer;
        customerLedgerAccountId = customerLedgerAccount.id;
      }

      let totalSales = 0;
      let createdVoucher: any = null;

      await db.transaction(async (tx) => {
        const voucherNumber = `CREDIT-SALES-${Date.now()}`;

        const [voucher] = await tx
          .insert(vouchers)
          .values({
            companyId: req.session.currentCompanyId!,
            locationId,
            locationName: location.name,
            voucherNumber,
            voucherType: "Sales",
            voucherDate: saleDate,
            description: `Credit Sale Import - ${items.length} items - Customer: ${customer.legalName}`,
            totalAmount: "0",
            isCreditSale: true,
          })
          .returning();

        for (const item of items) {
          const stockItem = await storage.getStockItemByCodeOrAlias(item.barcode, req.session.currentCompanyId!);
          if (!stockItem) {
            throw new Error(`Stock item not found for barcode: ${item.barcode}`);
          }

          const [inventoryRecord] = await tx
            .select()
            .from(inventory)
            .where(and(eq(inventory.stockItemId, stockItem.id), eq(inventory.locationId, locationId)))
            .limit(1);

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
          const [importCreditLocPrice] = await tx
            .select()
            .from(stockItemLocationPrices)
            .where(
              and(
                eq(stockItemLocationPrices.stockItemId, stockItem.id),
                eq(stockItemLocationPrices.locationId, locationId)
              )
            )
            .limit(1);
          const importCreditConfiguredPrice = parseFloat(
            importCreditLocPrice?.sellingPrice || stockItem.sellingPrice || "0"
          );

          await tx.insert(salesItems).values({
            voucherId: voucher.id,
            stockItemId: stockItem.id,
            quantity: item.quantity.toString(),
            sellingPrice: item.rate.toString(),
            costPrice: costPrice.toString(),
            totalSales: itemSales.toString(),
            totalCost: itemCost.toString(),
            profit: profit.toString(),
            configuredPrice: importCreditConfiguredPrice > 0 ? importCreditConfiguredPrice.toFixed(6) : null,
          });

          await adjustInventory(tx, locationId, stockItem.id, -item.quantity, req.session.currentCompanyId!);
        }

        // Create voucher entries for credit sale
        // Entry 1: Debit Customer's Ledger Account (Customer owes money)
        await tx.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: customerLedgerAccountId!,
          debitAmount: totalSales.toString(),
          creditAmount: "0",
          narration: `Credit Sale to ${customer.legalName} - ${items.length} items`,
        });

        // Entry 2: Credit Sales Revenue (Income increases with credit)
        await tx.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: salesRevenueAccount.id,
          debitAmount: "0",
          creditAmount: totalSales.toString(),
          narration: `Credit Sale Revenue - ${items.length} items`,
        });

        // Update voucher with total amount
        await tx
          .update(vouchers)
          .set({
            totalAmount: totalSales.toString(),
          })
          .where(eq(vouchers.id, voucher.id));

        createdVoucher = voucher;

        // Add customer balance transaction (credit sale = debit to customer = they owe us)
        // Get current running balance for this customer
        const [lastBalance] = await tx
          .select()
          .from(customerBalances)
          .where(
            and(
              eq(customerBalances.customerId, customerId),
              eq(customerBalances.companyId, req.session.currentCompanyId!)
            )
          )
          .orderBy(desc(customerBalances.id))
          .limit(1);

        const previousBalance = lastBalance ? parseFloat(lastBalance.balance || "0") : 0;
        const newBalance = previousBalance + totalSales;

        await tx.insert(customerBalances).values({
          customerId,
          companyId: req.session.currentCompanyId!,
          transactionDate: saleDate,
          transactionType: "Credit Sale",
          referenceId: voucher.id,
          referenceType: "voucher",
          debitAmount: totalSales.toString(),
          creditAmount: "0",
          balance: newBalance.toString(),
          currency: "USD",
          description: `Credit Sale Import - ${items.length} items`,
        });
      });

      res.json({
        success: true,
        voucher: createdVoucher,
        itemsCount: items.length,
        totalSales: totalSales.toFixed(2),
        customerName: customer.legalName,
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
        const _custName = customer.legalName ?? "";
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
              `${_custName} Invoice ${_locName} ${safeDate}`
                .replace(/[^\w\s.()\-]/g, "_")
                .replace(/\s+/g, " ")
                .trim() + ".pdf";
            const invResult = await sendWhatsAppFileByUploadPos(_chatId, pdfBuffer, fileName, "");
            if (!invResult.success) console.error(`[CreditImport-bg] Invoice send failed: ${invResult.error}`);
            else console.log(`[CreditImport-bg] Invoice sent: ${fileName} → ${_chatId}`);
          } catch (e: any) {
            console.error("[CreditImport-bg] Invoice send error:", e.message);
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
              console.error(
                `[CreditImport-bg] Stock PDF safety guard: ${pageCount} pages for ${rowCount} rows — not sent`
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
              if (!stockRes.success) console.error(`[CreditImport-bg] Stock send failed: ${stockRes.error}`);
              else console.log(`[CreditImport-bg] Stock report sent: ${stockName}.pdf → ${_chatId}`);
            }
          } catch (e: any) {
            console.error("[CreditImport-bg] Stock send error:", e.message);
          }
        });
      }
    } catch (error: any) {
      console.error("Credit Sales Import error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Download sample Credit Sales import template
  app.get("/api/credit-sales-import/template", async (_req, res) => {
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
      jsonToSheet(workbook, sampleData, "Credit Sales Import");

      const buffer = await writeWorkbook(workbook);

      res.setHeader("Content-Disposition", "attachment; filename=Credit_Sales_Import_Template.xlsx");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.send(buffer);
    } catch (error: any) {
      console.error("Template generation error:", error);
      res.status(500).json({ message: error.message });
    }
  });
}
