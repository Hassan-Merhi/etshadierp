import { getClientDate } from "../lib/dateUtils";
import express, { type Express } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation, canModifyDate } from "../auth";
import { upload, logAudit, getCurrentExchangeRate, calculateHistoricalLocationInventory, runIntercompanyPosTransfer, recalculateIntercompanyForDate } from "./_helpers";
import {
  inventory, stockItems, stockGroups,
  stockTransferVouchers, stockTransferItems,
  stockAdjustmentVouchers, stockAdjustmentItems,
  containers, containerOffloads, containerOffloadItems,
  bankAccounts, fixedAssets, ledgerAccounts, insertLedgerAccountSchema,
  insertStockGroupSchema, insertStockItemSchema, insertContainerSchema,
  insertStockTransferVoucherSchema, insertStockAdjustmentVoucherSchema,
  updateStockTransferSchema, updateStockAdjustmentSchema,
  vouchers, voucherEntries, salesItems, suppliers, customers, customerBalances,
  employees, locations, userLocations, userCompanyRoles, companies,
  auditLog, users, FEATURE_KEYS, companySettings,
  purchaseOrders, poLineItems, interCompanyTransfers,
  insertInterCompanyTransferSchema, insertContainerSaleSchema, containerSales,
  insertUserPreferencesSchema, userPreferences,
  insertDraftPosSaleSchema, InsertDraftPosSale,
  insertSalaryAdvanceSchema, insertSalaryAdvanceDeductionSchema,
  salaryAdvances, salaryAdvanceDeductions,
  fiscalPeriodClosures, wasteDispatches, wasteDispatchItems,
  dashboardCashAccounts, dashboardPayableAccounts, dashboardAccountSelections,
  insertDashboardCashAccountSchema, insertDashboardPayableAccountSchema,
  insertDashboardAccountSelectionSchema,
  creditNoteItems, pendingBarcodes, insertPendingBarcodeSchema,
  bales, baleProducts, baleProductCategories, storedFiles,
  stockItemLocationPrices, insertCustomerSchema,
  posShifts,
} from "@shared/schema";
import {
  eq, and, or, desc, asc, lt, gt, ne, inArray, sql, isNull, isNotNull, not, gte, lte, like, ilike,
} from "drizzle-orm";
import { format } from "date-fns";
import { z } from "zod";
import { readExcel, sheetToJson, createWorkbook, jsonToSheet, aoaToSheet, writeWorkbook } from "../excelHelper";
import { adjustInventory, reverseInventoryByExactValue } from "../inventoryHelper";
import { generateStockPdf }   from "../helpers/generateStockPdf";
import { generateInvoicePdf } from "../helpers/generateInvoicePdf";
import { classifyNetPositionAccounts, getAccountNetBalance } from "../netPositionHelper";
import { sendWhatsAppTextToChatIdPos, sendWhatsAppFileToChatIdPos, sendWhatsAppFileByUrlToChatIdPos, sendWhatsAppFileByUploadPos } from "../services/whatsappService";
import PDFDocument from "pdfkit";
import { randomUUID } from "crypto";

// ── Temporary file store for WhatsApp sendFileByUrl ──────────────────────────
const tempPdfStore = new Map<string, { buffer: Buffer; expiresAt: number; contentType?: string; filename?: string }>();
function storeTempFile(buffer: Buffer, contentType?: string, filename?: string): string {
  const id = randomUUID();
  tempPdfStore.set(id, { buffer, expiresAt: Date.now() + 10 * 60 * 1000, contentType, filename });
  setTimeout(() => tempPdfStore.delete(id), 10 * 60 * 1000);
  return id;
}
// keep old name as alias
const storeTempPdf = storeTempFile;


export function registerPosRoutes(app: Express) {
  // ── Serve temporarily stored PDFs (used by WhatsApp sendFileByUrl) ──────────
  // Auth-gated: even though the ID is a random unguessable key, we require an
  // authenticated session to defend against accidental URL leakage in browser
  // history, referrer headers, or chat logs.
  app.get("/api/pos/temp-pdf/:id", requireAuth, (req, res) => {
    const entry = tempPdfStore.get(req.params.id);
    if (!entry || entry.expiresAt < Date.now()) {
      return res.status(404).json({ message: "File not found or expired" });
    }
    const ct = entry.contentType ?? "application/pdf";
    const fn = entry.filename ?? "stock_report.pdf";
    res.setHeader("Content-Type", ct);
    res.setHeader("Content-Disposition", `inline; filename="${fn}"`);
    res.send(entry.buffer);
  });

  // ── Receive a frontend-generated PDF and forward to WhatsApp ──────────────
  // Body: { pdfBase64: string, locationId: number, filename: string, caption?: string }
  // NOTE: PDFs sent as base64 in JSON can easily exceed the global 2 MB body
  // limit (a 1.5 MB PDF becomes ~2 MB base64), so we apply a route-specific
  // 25 MB limit here. WhatsApp itself caps attachments around 15 MB.
  app.post("/api/pos/send-whatsapp-pdf-upload", requireAuth, express.json({ limit: "25mb" }), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { pdfBase64, locationId, filename, caption } = req.body;
      if (!pdfBase64)   return res.status(400).json({ message: "pdfBase64 is required" });
      if (!locationId)  return res.status(400).json({ message: "locationId is required" });

      const [location] = await db
        .select()
        .from(locations)
        .where(and(eq(locations.id, parseInt(locationId)), eq(locations.companyId, companyId)))
        .limit(1);

      if (!location)                     return res.status(404).json({ message: "Location not found" });
      if (!location.whatsappGroupChatId) return res.status(400).json({ message: "No WhatsApp group configured for this location" });

      const pdfBuffer  = Buffer.from(pdfBase64, "base64");
      const safeFile   = (filename || "report.pdf").replace(/[^\w\s.()\-]/g, "_");

      console.log(`[WA PDF upload] chatId=${location.whatsappGroupChatId} file=${safeFile} size=${pdfBuffer.length}`);
      const result = await sendWhatsAppFileByUploadPos(
        location.whatsappGroupChatId,
        pdfBuffer,
        safeFile,
        caption ?? safeFile,
      );

      if (!result.success) {
        return res.status(502).json({ message: result.error ?? "WhatsApp send failed" });
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("[/api/pos/send-whatsapp-pdf-upload]", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Server-side stock PDF → WhatsApp (no browser capture needed) ──────────
  app.post("/api/pos/send-stock-pdf-backend", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { locationId } = req.body;
      if (!locationId) return res.status(400).json({ message: "locationId is required" });

      const locId = parseInt(locationId);
      if (isNaN(locId)) return res.status(400).json({ message: "Invalid locationId" });

      const [location] = await db
        .select()
        .from(locations)
        .where(and(eq(locations.id, locId), eq(locations.companyId, companyId)))
        .limit(1);

      if (!location)                     return res.status(404).json({ message: "Location not found" });
      if (!location.whatsappGroupChatId) return res.status(400).json({ message: "No WhatsApp group configured for this location" });

      const [company] = await db
        .select({ name: companies.name })
        .from(companies)
        .where(eq(companies.id, companyId))
        .limit(1);

      const companyName = company?.name || "Company";
      const locName     = location.name;

      const { buffer: pdfBuffer, pageCount, rowCount } = await generateStockPdf(companyId, companyName, locId, locName);

      // ── Safety guard: reject absurdly over-paginated PDFs before sending ──
      // Root cause was PDFKit ≥0.17 exposing page.maxY as a function instead of
      // a number, making the ensureSpace comparison always false. This guard
      // catches any future regression before a broken PDF reaches WhatsApp.
      const maxAllowedPages = Math.ceil(rowCount / 20) + 5;
      if (pageCount > maxAllowedPages) {
        console.error(
          `[WA stock backend] SAFETY GUARD: PDF has ${pageCount} pages for ${rowCount} rows ` +
          `(max allowed: ${maxAllowedPages}). location="${locName}". Refusing to send.`,
        );
        return res.status(500).json({
          message:
            `PDF pagination error detected: ${pageCount} pages generated for ${rowCount} stock items ` +
            `(expected ≤${maxAllowedPages}). Report not sent to WhatsApp.`,
        });
      }

      const dateStr  = getClientDate(req);
      const safeName = `${locName} STK ${companyName} ${dateStr}`.replace(/[^\w\s.()\-]/g, "_").trim();
      const stampStr = new Date().toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
      const caption  = `Stock Report — ${locName}\n${stampStr}`;

      console.log(
        `[WA stock backend] chatId=${location.whatsappGroupChatId} file=${safeName}.pdf ` +
        `size=${pdfBuffer.length} pageCount=${pageCount} rowCount=${rowCount}`,
      );

      const result = await sendWhatsAppFileToChatIdPos(
        location.whatsappGroupChatId,
        pdfBuffer,
        `${safeName}.pdf`,
        caption,
      );

      if (!result.success) {
        console.error(
          `[WA stock backend] Upload failed — chatId=${location.whatsappGroupChatId} ` +
          `file=${safeName}.pdf size=${pdfBuffer.length} pageCount=${pageCount} rowCount=${rowCount} ` +
          `greenApiError="${result.error}"`,
        );
        return res.status(502).json({ message: result.error ?? "WhatsApp send failed" });
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("[/api/pos/send-stock-pdf-backend]", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Server-side invoice PDF → WhatsApp ────────────────────────────────────
  app.post("/api/pos/send-invoice-pdf-backend", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { voucherId, locationId } = req.body;
      if (!voucherId)  return res.status(400).json({ message: "voucherId is required" });
      if (!locationId) return res.status(400).json({ message: "locationId is required" });

      const locId = parseInt(locationId);
      if (isNaN(locId)) return res.status(400).json({ message: "Invalid locationId" });

      const [location] = await db
        .select()
        .from(locations)
        .where(and(eq(locations.id, locId), eq(locations.companyId, companyId)))
        .limit(1);

      if (!location)                     return res.status(404).json({ message: "Location not found" });
      if (!location.whatsappGroupChatId) return res.status(400).json({ message: "No WhatsApp group configured for this location" });

      const pdfBuffer = await generateInvoicePdf(parseInt(voucherId), companyId, (req as any).user?.username);

      const locName  = location.name;
      const dateStr  = getClientDate(req);
      const safeName = `${locName} Invoice ${dateStr}`.replace(/[^\w\s.()\-]/g, "_").trim();
      const caption  = `${locName} — ${dateStr}`;

      console.log(`[WA invoice backend] chatId=${location.whatsappGroupChatId} file=${safeName}.pdf size=${pdfBuffer.length}`);

      const result = await sendWhatsAppFileToChatIdPos(
        location.whatsappGroupChatId,
        pdfBuffer,
        `${safeName}.pdf`,
        caption,
      );

      if (!result.success) return res.status(502).json({ message: result.error ?? "WhatsApp send failed" });

      res.json({ success: true });
    } catch (error: any) {
      console.error("[/api/pos/send-invoice-pdf-backend]", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/pos/sales", requireAuth, canModifyDate("voucherDate"), async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const isPOSUser = (req.user?.role || "").startsWith("POS");

      const {
        locationId,
        cashAccountId,
        paymentAccountType,
        paymentAccountId,
        items,
        notes,
        isCreditSale,
        voucherDate: providedVoucherDate,
        shiftId,
        clientSaleId,
        currency,
        exchangeRate,
      } = req.body;

      // Determine account type and ID by validating against actual database records
      let accountType: string;
      let accountId: number;
      let customerAccount: any = null;

      if (isCreditSale) {
        // Credit sales must use a customer receivable ledger account (Asset type)
        if (!paymentAccountId) {
          return res.status(400).json({
            message: "Customer account is required for credit sales",
          });
        }

        const [fetchedCustomerAccount] = await db
          .select()
          .from(ledgerAccounts)
          .where(
            and(
              eq(ledgerAccounts.id, paymentAccountId),
              eq(ledgerAccounts.companyId, req.session.currentCompanyId!)
            )
          )
          .limit(1);

        if (!fetchedCustomerAccount) {
          return res.status(400).json({
            message: "Invalid customer account - account not found or does not belong to this company",
          });
        }

        if (fetchedCustomerAccount.accountType !== "Asset") {
          return res.status(400).json({
            message: `Invalid customer account type: ${fetchedCustomerAccount.accountType}. Credit sales require Asset-type accounts (customer receivables).`,
          });
        }

        customerAccount = fetchedCustomerAccount;
        accountType = "credit";
        accountId = paymentAccountId;
      } else if (cashAccountId) {
        // Legacy: cashAccountId parameter - validate it's a cash ledger account in current company
        const [cashLedger] = await db
          .select()
          .from(ledgerAccounts)
          .where(
            and(
              eq(ledgerAccounts.id, cashAccountId),
              eq(ledgerAccounts.companyId, req.session.currentCompanyId!)
            )
          )
          .limit(1);

        if (!cashLedger) {
          return res.status(400).json({
            message: "Invalid cash account - account not found or does not belong to this company",
          });
        }

        if (cashLedger.accountType !== "Cash") {
          return res.status(400).json({
            message: `Invalid cash account type: ${cashLedger.accountType}. The cashAccountId parameter must refer to a Cash-type ledger account.`,
          });
        }

        accountType = "cash";
        accountId = cashAccountId;
      } else if (paymentAccountId) {
        // Infer account type by checking if ID exists in ledger accounts or bank accounts
        // IMPORTANT: Scope by company to prevent cross-tenant access
        const [ledgerAccount] = await db
          .select()
          .from(ledgerAccounts)
          .where(
            and(
              eq(ledgerAccounts.id, paymentAccountId),
              eq(ledgerAccounts.companyId, req.session.currentCompanyId!)
            )
          )
          .limit(1);

        if (ledgerAccount) {
          // It's a ledger account - validate it's appropriate for POS sales
          if (ledgerAccount.accountType === "Cash") {
            accountType = "cash";
            accountId = paymentAccountId;
          } else if (ledgerAccount.accountType === "Asset") {
            // Asset accounts are customer receivables - should only be used for credit sales
            return res.status(400).json({
              message: "Asset accounts (customer receivables) can only be used for credit sales. Please enable 'Credit Sale' or select a Cash/Bank account.",
            });
          } else {
            // Other ledger account types (Expense, Liability, etc.) are not valid for POS sales
            return res.status(400).json({
              message: `Invalid payment account type: ${ledgerAccount.accountType}. POS sales require Cash accounts or Bank accounts for cash/bank payments, or Asset accounts for credit sales.`,
            });
          }
        } else {
          // Check if it's a bank account
          const [bankAccount] = await db
            .select()
            .from(bankAccounts)
            .where(
              and(
                eq(bankAccounts.id, paymentAccountId),
                eq(bankAccounts.companyId, req.session.currentCompanyId!)
              )
            )
            .limit(1);

          if (bankAccount) {
            accountType = "bank";
            accountId = paymentAccountId;
          } else {
            return res.status(400).json({
              message: "Invalid payment account ID - account not found or does not belong to this company",
            });
          }
        }
      } else {
        return res.status(400).json({
          message: "Payment account is required",
        });
      }

      console.log("[POS Sale] Payment info:", {
        provided: { paymentAccountType, paymentAccountId, cashAccountId, isCreditSale },
        resolved: { accountType, accountId },
      });

      // Fix 4: Idempotency — if this clientSaleId was already saved, return the existing sale
      if (clientSaleId) {
        const [existingVoucher] = await db
          .select()
          .from(vouchers)
          .where(and(
            eq(vouchers.companyId, req.session.currentCompanyId!),
            eq(vouchers.clientSaleId, clientSaleId),
            isNull(vouchers.deletedAt),
          ))
          .limit(1);
        if (existingVoucher) {
          const existingSalesItems = await db.select().from(salesItems).where(eq(salesItems.voucherId, existingVoucher.id));
          const existingLocation = existingVoucher.locationId ? await storage.getLocationById(existingVoucher.locationId) : null;
          return res.json({
            voucher: existingVoucher,
            location: existingLocation,
            items: existingSalesItems,
            grandTotal: existingVoucher.totalAmount,
            voucherNumber: existingVoucher.voucherNumber,
            saleDate: existingVoucher.voucherDate,
            isCreditSale: existingVoucher.isCreditSale,
            customer: null,
            _idempotent: true,
          });
        }
      }

      // Validate required fields
      if (!locationId) {
        return res.status(400).json({ message: "Location is required" });
      }

      // Validate shiftId if one was provided — must be open, belong to current user, company, and location
      if (shiftId) {
        const shift = await storage.getShiftById(shiftId);
        if (!shift || shift.companyId !== req.session.currentCompanyId || shift.locationId !== locationId || shift.status !== "open" || shift.userId !== req.user?.id) {
          // Shift is invalid/closed — proceed without linking to a shift
          shiftId = null;
        }
      }
      if (!accountId) {
        return res
          .status(400)
          .json({
            message: isCreditSale
              ? "Customer is required"
              : "Payment account is required",
          });
      }
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res
          .status(400)
          .json({ message: "At least one item is required" });
      }

      // Input validation assertions for inventory safety
      const parsedLocationId = Number(locationId);
      if (!locationId || isNaN(parsedLocationId)) {
        return res.status(400).json({ message: `Invalid locationId: ${locationId}` });
      }
      for (const item of items) {
        if (!item.stockItemId || isNaN(Number(item.stockItemId))) {
          return res.status(400).json({ message: `Invalid stockItemId: ${item.stockItemId}` });
        }
        const qty = parseFloat(item.quantity);
        if (isNaN(qty) || !isFinite(qty) || qty <= 0) {
          return res.status(400).json({ message: `Invalid quantity for item ${item.stockItemId}: ${item.quantity}` });
        }
      }

      // Validate and calculate total
      let grandTotal = 0;
      for (const item of items) {
        if (!item.stockItemId) {
          return res
            .status(400)
            .json({ message: "Stock item ID is required for all items" });
        }
        if (!item.quantity || parseFloat(item.quantity) <= 0) {
          return res
            .status(400)
            .json({ message: "Quantity must be positive for all items" });
        }
        if (!item.rate || parseFloat(item.rate) < 0) {
          return res
            .status(400)
            .json({ message: "Rate must be non-negative for all items" });
        }
        grandTotal += parseFloat(item.quantity) * parseFloat(item.rate);
      }

      // Get or create SALES revenue account (outside transaction for simplicity)
      const allAccounts = await storage.getAllLedgerAccounts(
        req.session.currentCompanyId!,
      );
      let salesAccount = allAccounts.find((a: any) => a.code === "SALES");

      if (!salesAccount) {
        salesAccount = await storage.createLedgerAccount({
          companyId: req.session.currentCompanyId!,
          code: "SALES",
          name: "Sales Revenue",
          accountType: "Income",
          openingBalance: "0",
          active: true,
        });
      } else if (salesAccount.accountType !== "Income") {
        // Validate that Sales account is of type Income for proper import cycle balance
        console.warn(`[POS Sale] WARNING: SALES account has type "${salesAccount.accountType}" instead of "Income". This will cause import cycle imbalance!`);
        return res.status(400).json({
          message: `The SALES account is configured with type "${salesAccount.accountType}" but must be type "Income" for POS sales to work correctly. Please update the SALES account type in Accounts page.`,
        });
      }

      // Get location details
      const location = await storage.getLocationById(locationId);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      if (location.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Location does not belong to the current company" });
      }

      // Fix 2: POS users can only sell from their assigned locations
      if (isPOSUser) {
        const assignedLocs = await db
          .select({ locationId: userLocations.locationId })
          .from(userLocations)
          .where(and(
            eq(userLocations.userId, req.user!.id),
            eq(userLocations.companyId, req.session.currentCompanyId!),
          ));
        const allowedIds = assignedLocs.map(l => l.locationId);
        if (!allowedIds.includes(parsedLocationId)) {
          return res.status(403).json({ message: "You are not allowed to sell from this location." });
        }
      }

      // STEP 1: Validate inventory availability
      const voucherNumber = `SALES-${Date.now()}`;
      const voucherDate = providedVoucherDate || getClientDate(req);

      // Check if user can sell negative stock (same for all items — compute once)
      const canSellNegativeStock = req.user?.canSellNegativeStock || false;

      // Fix 5: Verify each stockItemId exists, belongs to this company, and is not deleted/merged
      for (const item of items) {
        const [si] = await db
          .select({ id: stockItems.id, name: stockItems.name, deletedAt: stockItems.deletedAt })
          .from(stockItems)
          .where(and(
            eq(stockItems.id, item.stockItemId),
            eq(stockItems.companyId, req.session.currentCompanyId!),
          ))
          .limit(1);
        if (!si) {
          return res.status(400).json({
            message: `Item ID ${item.stockItemId} does not exist or does not belong to this company.`,
            code: "ITEM_NOT_FOUND",
            invalidItemId: item.stockItemId,
          });
        }
        if (si.deletedAt) {
          return res.status(400).json({
            message: `This item was merged or deleted. Please select it again.`,
            code: "ITEM_DELETED",
            invalidItemId: item.stockItemId,
          });
        }
      }

      // STEP 1a: Validate inventory rows (best-effort pre-check; authoritative check is inside the transaction)
      const inventoryValidation: Array<{
        item: any;
        inventoryRecord: any;
        currentQty: number;
        saleQty: number;
        newQty: number;
        currentRate: number;
      }> = [];

      for (const item of items) {
        const [inventoryRecord] = await db
          .select({
            id: inventory.id,
            locationId: inventory.locationId,
            stockItemId: inventory.stockItemId,
            quantity: inventory.quantity,
            averageRate: inventory.averageRate,
            itemName: stockItems.name,
          })
          .from(inventory)
          .leftJoin(stockItems, eq(stockItems.id, inventory.stockItemId))
          .where(
            and(
              eq(inventory.locationId, locationId),
              eq(inventory.stockItemId, item.stockItemId),
            ),
          );

        if (!inventoryRecord) {
          throw new Error(
            `Inventory not found for item ${item.stockItemId} at location ${locationId}`,
          );
        }

        const currentQty = parseFloat(inventoryRecord.quantity);
        const saleQty = parseFloat(item.quantity);
        const itemDisplayName = inventoryRecord.itemName || `item ${item.stockItemId}`;

        if (currentQty < saleQty && !canSellNegativeStock) {
          throw new Error(
            `Not enough stock for "${itemDisplayName}". Available: ${currentQty}, requested: ${saleQty}.`,
          );
        }

        inventoryValidation.push({
          item,
          inventoryRecord,
          currentQty,
          saleQty,
          newQty: currentQty - saleQty,
          currentRate: parseFloat(inventoryRecord.averageRate),
        });
      }

      // STEP 1b: Create accounting records, update inventory, and create sales items
      // All wrapped in a single DB transaction for atomicity
      let voucher: any;
      let saleItems: any[] = [];

      const txResult = await db.transaction(async (tx) => {
        const [txVoucher] = await tx
          .insert(vouchers)
          .values({
            companyId: req.session.currentCompanyId!,
            locationId,
            locationName: location.name,
            voucherNumber,
            voucherType: "Sales",
            voucherDate,
            description: notes || (isCreditSale ? `Credit Invoice Sale at ${location.name} - ${(customerAccount as any).name}` : `POS Sale at ${location.name}`),
            totalAmount: grandTotal.toFixed(2),
            shiftId: shiftId || null,
            clientSaleId: clientSaleId || null,
            currency: currency || "USD",
            exchangeRate: exchangeRate || null,
            isCreditSale: !!isCreditSale,
          })
          .returning();

        const creditSaleNarration = isCreditSale
          ? `Credit Invoice Sale at ${location.name} - ${(customerAccount as any).name}`
          : `POS Sale - ${voucherNumber}`;

        const debitEntry: any = {
          voucherId: txVoucher.id,
          debitAmount: grandTotal.toFixed(2),
          creditAmount: "0",
          narration: creditSaleNarration,
        };

        if (
          isCreditSale ||
          accountType === "cash" ||
          accountType === "credit"
        ) {
          debitEntry.ledgerAccountId = accountId;
          // For credit sales, also stamp the customerId on the receivable
          // entry whenever the receivable ledger is linked to a customer.
          // Without this, the customer ledger / statement views can't
          // attribute the entry to the customer.
          if (isCreditSale && accountType === "credit") {
            try {
              const [linkedCust] = await tx
                .select({ id: customers.id })
                .from(customers)
                .where(
                  and(
                    eq(customers.ledgerAccountId, accountId),
                    eq(customers.companyId, req.session.currentCompanyId!),
                  ),
                )
                .limit(1);
              if (linkedCust) {
                debitEntry.customerId = linkedCust.id;
              }
            } catch (e) {
              console.error("[POS Sale] customer lookup for credit-sale entry failed:", e);
            }
          }
          console.log("[POS Sale] Using ledgerAccountId for cash/credit:", accountId);
        } else {
          debitEntry.bankAccountId = accountId;
          console.log("[POS Sale] Using bankAccountId for bank:", accountId);
        }

        console.log("[POS Sale] Debit entry:", debitEntry);
        await tx.insert(voucherEntries).values(debitEntry);

        await tx.insert(voucherEntries).values({
          voucherId: txVoucher.id,
          ledgerAccountId: salesAccount.id,
          debitAmount: "0",
          creditAmount: grandTotal.toFixed(2),
          narration: creditSaleNarration,
        });

        const txSaleItems: any[] = [];

        for (const validatedItem of inventoryValidation) {
          const { item, newQty, currentRate, inventoryRecord, currentQty, saleQty } =
            validatedItem;

          // Fix 3: Authoritative stock check inside the transaction with row lock.
          // Catches race conditions where two cashiers sell the last unit concurrently.
          const stockLockResult = await (tx as any).execute(sql`
            SELECT i.quantity, si.name AS item_name
            FROM inventory i
            LEFT JOIN stock_items si ON si.id = i.stock_item_id
            WHERE i.location_id = ${parsedLocationId} AND i.stock_item_id = ${item.stockItemId}
            FOR UPDATE
          `);
          const lockedRow = stockLockResult.rows?.[0] ?? stockLockResult[0];
          const lockedQty = lockedRow ? parseFloat(lockedRow.quantity ?? "0") : 0;
          if (lockedQty < saleQty && !canSellNegativeStock) {
            throw new Error(
              `Not enough stock for "${lockedRow?.item_name || inventoryRecord?.itemName || item.stockItemId}". Available: ${lockedQty}, requested: ${saleQty}.`
            );
          }

          await adjustInventory(tx, locationId, item.stockItemId, -saleQty, req.session.currentCompanyId!);

          const [stockItem] = await tx
            .select()
            .from(stockItems)
            .where(eq(stockItems.id, item.stockItemId));

          const qty = parseFloat(item.quantity);
          const sellingPrice = parseFloat(item.rate) || 0;
          const costPrice = currentRate;
          const totalSales = qty * sellingPrice;
          const totalCost = qty * costPrice;
          const profit = totalSales - totalCost;

          // Get configured selling price from location prices BEFORE insert so we can persist it
          const [locPrice] = await tx
            .select()
            .from(stockItemLocationPrices)
            .where(
              and(
                eq(stockItemLocationPrices.stockItemId, item.stockItemId),
                eq(stockItemLocationPrices.locationId, locationId)
              )
            )
            .limit(1);
          const configuredPrice = locPrice?.sellingPrice || stockItem?.sellingPrice || "0";
          const configuredPriceNum = parseFloat(configuredPrice);

          await tx.insert(salesItems).values({
            voucherId: txVoucher.id,
            stockItemId: item.stockItemId,
            quantity: qty.toString(),
            sellingPrice: sellingPrice.toFixed(2),
            costPrice: costPrice.toFixed(2),
            totalSales: totalSales.toFixed(2),
            totalCost: totalCost.toFixed(2),
            profit: profit.toFixed(2),
            configuredPrice: configuredPriceNum.toFixed(6),
          });
          const profitPerUnit = sellingPrice - configuredPriceNum;
          const totalProfitVsConfigured = profitPerUnit * qty;

          txSaleItems.push({
            ...item,
            stockItemName: stockItem?.name || "",
            stockItemCode: stockItem?.code || "",
            amount: totalSales.toFixed(2),
            configuredPrice: configuredPriceNum.toFixed(2),
            profitPerUnit: profitPerUnit.toFixed(2),
            totalProfitVsConfigured: totalProfitVsConfigured.toFixed(2),
          });
        }

        return { voucher: txVoucher, saleItems: txSaleItems };
      });

      voucher = txResult.voucher;
      saleItems = txResult.saleItems;

      const result = { voucher, saleItems };

      // ── Intercompany POS auto-transfer (non-blocking, cash sales only) ──
      if (!isCreditSale && accountType === "cash") {
        // fire-and-forget; never let errors surface to the client
        runIntercompanyPosTransfer(
          req.session.currentCompanyId!,
          accountId,
          grandTotal,
          voucherDate,
        ).catch((err) => console.error("[IntercompanyPOS] Unhandled:", err));
      }

      // Return complete sale details
      res.json({
        voucher: result.voucher,
        location,
        items: result.saleItems,
        grandTotal: grandTotal.toFixed(2),
        voucherNumber,
        saleDate: voucherDate,
        isCreditSale,
        customer: customerAccount
          ? {
              id: customerAccount.id,
              code: customerAccount.code,
              name: customerAccount.name,
            }
          : null,
      });
    } catch (error: any) {
      // Return appropriate status codes for different error types
      if (error.message.includes("Inventory not found")) {
        return res.status(404).json({ message: error.message });
      }
      if (error.message.includes("Insufficient stock") || error.message.includes("Not enough stock")) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: error.message });
    }
  });

  // Update existing sales voucher
  app.put("/api/vouchers/:id/sales", requireAuth, canModifyDate("voucherDate"), async (req, res) => {
    try {
      const voucherId = parseInt(req.params.id);
      if (isNaN(voucherId)) {
        return res.status(400).json({ message: "Invalid voucher ID" });
      }

      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { description, items, paymentAccountType, paymentAccountId, isCreditSale, voucherDate, locationId: newLocationId } = req.body;

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "At least one item is required" });
      }

      // Validate all items have positive quantities and prices
      for (const item of items) {
        const qty = parseFloat(item.quantity);
        const price = parseFloat(item.sellingPrice);
        
        if (isNaN(qty) || qty <= 0) {
          throw new Error(`Invalid quantity: ${item.quantity}. Must be greater than 0.`);
        }
        if (isNaN(price) || price <= 0) {
          throw new Error(`Invalid price: ${item.sellingPrice}. Must be greater than 0.`);
        }
      }

      // Get existing voucher to validate it's a Sales voucher in the current company
      const [existingVoucher] = await db
        .select()
        .from(vouchers)
        .where(
          and(
            eq(vouchers.id, voucherId),
            eq(vouchers.companyId, req.session.currentCompanyId)
          )
        )
        .limit(1);

      if (!existingVoucher) {
        return res.status(404).json({ message: "Voucher not found" });
      }

      if (existingVoucher.voucherType !== "Sales") {
        return res.status(400).json({ message: "Only Sales vouchers can be updated with this endpoint" });
      }

      // Determine target location - use new location if provided, otherwise keep existing
      const oldLocationId = existingVoucher.locationId!;
      const targetLocationId = newLocationId ? parseInt(newLocationId) : oldLocationId;
      const locationChanged = targetLocationId !== oldLocationId;

      // Validate new location belongs to company if changed
      if (locationChanged) {
        const [newLocation] = await db
          .select()
          .from(locations)
          .where(
            and(
              eq(locations.id, targetLocationId),
              eq(locations.companyId, req.session.currentCompanyId!),
              isNull(locations.deletedAt)
            )
          )
          .limit(1);
        
        if (!newLocation) {
          return res.status(400).json({ message: "Invalid location or location not found" });
        }
        console.log(`[POS Sales Edit] Location changing from ${oldLocationId} to ${targetLocationId}`);
      }

      // Get old sales items to reverse inventory and preserve historical cost
      const oldSalesItems = await db
        .select()
        .from(salesItems)
        .where(eq(salesItems.voucherId, voucherId));

      // Create map of old items by line ID for cost preservation (not stockItemId to handle duplicates)
      const oldItemsMap = new Map(
        oldSalesItems.map(item => [item.id, item])
      );

      // Get existing voucher entries to recreate them
      const oldEntries = await db
        .select()
        .from(voucherEntries)
        .where(eq(voucherEntries.voucherId, voucherId));

      // Begin transaction
      await db.transaction(async (tx) => {
        // Reverse old inventory movements
        for (const oldItem of oldSalesItems) {
          const oldQty = parseFloat(oldItem.quantity);
          const oldCost = parseFloat(oldItem.costPrice || "0");
          
          // Add back the old quantity to inventory (reversal of sale)
          await adjustInventory(tx, existingVoucher.locationId!, oldItem.stockItemId, oldQty, existingVoucher.companyId, oldCost);
        }

        // Delete old sales items and voucher entries
        await tx.delete(salesItems).where(eq(salesItems.voucherId, voucherId));
        await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, voucherId));

        // Check if user can sell negative stock
        const canSellNegativeStock = req.user?.canSellNegativeStock || false;

        // Create new sales items and apply new inventory movements
        let grandTotal = 0;
        for (const item of items) {
          const { id, stockItemId, quantity, sellingPrice } = item;

          // Get inventory record for validation and deduction
          let [inventoryRecord] = await tx
            .select()
            .from(inventory)
            .where(
              and(
                eq(inventory.locationId, targetLocationId),
                eq(inventory.stockItemId, stockItemId)
              )
            )
            .limit(1);

          const currentQty = inventoryRecord ? parseFloat(inventoryRecord.quantity) : 0;
          const sellQty = parseFloat(quantity);

          // Only check stock if user cannot sell negative stock
          if (currentQty < sellQty && !canSellNegativeStock) {
            throw new Error(`Insufficient stock for item ${stockItemId}. Available: ${currentQty}, Requested: ${sellQty}`);
          }

          // Preserve historical cost from old sale line if it exists (by line ID), otherwise use current cost
          // Items with id field are existing items, items without id are new items
          const oldItem = id !== undefined && id > 0 ? oldItemsMap.get(id) : null;
          const costPrice = oldItem 
            ? parseFloat(oldItem.costPrice || "0")
            : parseFloat(inventoryRecord?.averageRate || "0");
          
          // Use the entered selling price directly - don't override with configured price during edits
          // This preserves the original sale price and prevents unintended cash balance changes
          const effectiveSellingPrice = parseFloat(sellingPrice);
          
          const totalSales = sellQty * effectiveSellingPrice;
          const totalCost = sellQty * costPrice;
          const profit = totalSales - totalCost;

          // Look up configured price for this item at this location
          const [editLocPrice] = await tx
            .select()
            .from(stockItemLocationPrices)
            .where(
              and(
                eq(stockItemLocationPrices.stockItemId, stockItemId),
                eq(stockItemLocationPrices.locationId, targetLocationId)
              )
            )
            .limit(1);
          const editConfiguredPriceNum = parseFloat(editLocPrice?.sellingPrice || "0");

          // Create new sales item
          await tx.insert(salesItems).values({
            voucherId,
            stockItemId,
            quantity: quantity,
            sellingPrice: effectiveSellingPrice.toFixed(2),
            costPrice: costPrice.toString(),
            totalSales: totalSales.toFixed(2),
            totalCost: totalCost.toFixed(2),
            profit: profit.toFixed(2),
            configuredPrice: editConfiguredPriceNum > 0 ? editConfiguredPriceNum.toFixed(6) : null,
          });

          // Deduct from inventory using adjustInventory (sale = negative delta)
          await adjustInventory(tx, targetLocationId, stockItemId, -sellQty, existingVoucher.companyId);

          grandTotal += totalSales;
        }

        // Update voucher description, total amount, location, and optionally date
        const voucherUpdate: any = {
          description: description || null,
          totalAmount: grandTotal.toString(),
        };
        if (locationChanged) {
          voucherUpdate.locationId = targetLocationId;
          console.log(`[POS Sales Edit] Updated voucher ${voucherId} location from ${oldLocationId} to ${targetLocationId}`);
        }
        if (voucherDate) {
          voucherUpdate.voucherDate = new Date(voucherDate);
        }
        await tx
          .update(vouchers)
          .set(voucherUpdate)
          .where(eq(vouchers.id, voucherId));

        // Recreate voucher entries with new total
        // Get original entries for reference
        const paymentEntry = oldEntries.find(e => parseFloat(e.debitAmount || "0") > 0);
        const revenueEntry = oldEntries.find(e => parseFloat(e.creditAmount || "0") > 0);

        if (!paymentEntry || !revenueEntry) {
          throw new Error("Original voucher entries not found");
        }

        // Determine payment account - use new values if provided, otherwise preserve original
        let newDebitEntry: any = {
          voucherId,
          debitAmount: grandTotal.toString(),
          creditAmount: "0",
          narration: paymentEntry.narration || "",
        };

        if (paymentAccountType && paymentAccountId) {
          // User changed payment account - use new values
          if (paymentAccountType === "cash" || paymentAccountType === "credit") {
            newDebitEntry.ledgerAccountId = parseInt(paymentAccountId);
            newDebitEntry.bankAccountId = null;
          } else if (paymentAccountType === "bank") {
            newDebitEntry.bankAccountId = parseInt(paymentAccountId);
            newDebitEntry.ledgerAccountId = null;
          }
          newDebitEntry.supplierId = null;
          newDebitEntry.employeeId = null;
          newDebitEntry.fixedAssetId = null;
        } else {
          // Preserve original payment account
          newDebitEntry.ledgerAccountId = paymentEntry.ledgerAccountId;
          newDebitEntry.bankAccountId = paymentEntry.bankAccountId;
          newDebitEntry.supplierId = paymentEntry.supplierId;
          newDebitEntry.employeeId = paymentEntry.employeeId;
          newDebitEntry.fixedAssetId = paymentEntry.fixedAssetId;
        }

        // Create new debit entry (payment account)
        await tx.insert(voucherEntries).values(newDebitEntry);

        // Create new credit entry (sales revenue) - always preserve original
        await tx.insert(voucherEntries).values({
          voucherId,
          ledgerAccountId: revenueEntry.ledgerAccountId,
          bankAccountId: revenueEntry.bankAccountId,
          supplierId: revenueEntry.supplierId,
          employeeId: revenueEntry.employeeId,
          fixedAssetId: revenueEntry.fixedAssetId,
          debitAmount: "0",
          creditAmount: grandTotal.toString(),
          narration: revenueEntry.narration || "",
        });
      });

      // Fetch updated data to return for print template
      const [updatedVoucher] = await db
        .select()
        .from(vouchers)
        .where(eq(vouchers.id, voucherId))
        .limit(1);

      const updatedSalesItems = await db
        .select({
          id: salesItems.id,
          stockItemId: salesItems.stockItemId,
          stockItemName: stockItems.name,
          stockItemCode: stockItems.code,
          quantity: salesItems.quantity,
          sellingPrice: salesItems.sellingPrice,
          costPrice: salesItems.costPrice,
          totalSales: salesItems.totalSales,
          totalCost: salesItems.totalCost,
          profit: salesItems.profit,
          rate: salesItems.sellingPrice,
          rateUSD: salesItems.sellingPrice,
        })
        .from(salesItems)
        .innerJoin(stockItems, eq(salesItems.stockItemId, stockItems.id))
        .where(eq(salesItems.voucherId, voucherId));

      const updatedLocation = await storage.getLocationById(targetLocationId);

      let customerAccount = null;
      if (isCreditSale) {
        const updatedEntries = await db
          .select()
          .from(voucherEntries)
          .where(eq(voucherEntries.voucherId, voucherId));
        const debitEntry = updatedEntries.find(e => parseFloat(e.debitAmount || "0") > 0);
        if (debitEntry?.ledgerAccountId) {
          customerAccount = await storage.getLedgerAccountById(debitEntry.ledgerAccountId);
        }
      }

      // ── Recalculate INTERCO vouchers for affected date(s) (non-blocking) ──
      // Always recalculate old date; if date changed, also recalculate new date.
      const oldDate = existingVoucher.voucherDate;
      const newDate = voucherDate || oldDate;
      const datesToRecalc = new Set<string>([oldDate]);
      if (newDate !== oldDate) datesToRecalc.add(newDate);
      for (const d of datesToRecalc) {
        recalculateIntercompanyForDate(req.session.currentCompanyId!, d)
          .catch((err) => console.error("[IntercompanyPOS Recalc] Unhandled:", err));
      }

      res.json({
        voucher: updatedVoucher,
        location: updatedLocation,
        items: updatedSalesItems,
        grandTotal: updatedVoucher.totalAmount,
        voucherNumber: updatedVoucher.voucherNumber,
        saleDate: updatedVoucher.voucherDate,
        isCreditSale: !!isCreditSale,
        customer: customerAccount
          ? { id: customerAccount.id, code: customerAccount.code, name: customerAccount.name }
          : null,
      });
    } catch (error: any) {
      if (error.message.includes("Inventory not found")) {
        return res.status(404).json({ message: error.message });
      }
      if (error.message.includes("Insufficient stock")) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: error.message });
    }
  });

  // POS Shift Management Routes
  // Get current open shift for user at location
  app.get("/api/pos/shifts/current", requireAuth, async (req, res) => {
    try {
      const locationId = parseInt(req.query.locationId as string);
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }
      if (!locationId || isNaN(locationId)) {
        return res.status(400).json({ message: "Location ID is required" });
      }

      // Verify location belongs to current company
      const location = await storage.getLocationById(locationId);
      if (!location || location.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const shift = await storage.getCurrentShift(userId, locationId);
      res.json(shift || null);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get shift history for a location
  app.get("/api/pos/shifts/history", requireAuth, async (req, res) => {
    try {
      const locationId = parseInt(req.query.locationId as string);
      const limit = parseInt(req.query.limit as string) || 50;
      
      if (!locationId || isNaN(locationId)) {
        return res.status(400).json({ message: "Location ID is required" });
      }

      // Verify location belongs to current company
      const location = await storage.getLocationById(locationId);
      if (!location || location.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const shifts = await storage.getShiftsByLocation(locationId, limit);
      res.json(shifts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get shift by ID with report data
  app.get("/api/pos/shifts/:id", requireAuth, async (req, res) => {
    try {
      const shiftId = parseInt(req.params.id);
      const shift = await storage.getShiftById(shiftId);
      
      if (!shift) {
        return res.status(404).json({ message: "Shift not found" });
      }

      // Verify shift belongs to current company
      if (shift.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Access denied" });
      }

      res.json(shift);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Open a new shift
  app.post("/api/pos/shifts/open", requireAuth, async (req, res) => {
    try {
      const userId = req.user?.id;
      const username = req.user?.username;
      
      if (!userId || !username) {
        return res.status(401).json({ message: "User not authenticated" });
      }
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { locationId, cashAccountId, openingCash, posStation } = req.body;

      if (!locationId) {
        return res.status(400).json({ message: "Location is required" });
      }

      // Verify location belongs to current company
      const location = await storage.getLocationById(locationId);
      if (!location || location.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Access denied: Invalid location" });
      }

      // Check if user already has an open shift at this location
      const existingShift = await storage.getCurrentShift(userId, locationId);
      if (existingShift) {
        return res.status(400).json({ 
          message: "You already have an open shift at this location. Please close it first.",
          existingShiftId: existingShift.id
        });
      }

      const shift = await storage.openShift({
        companyId: req.session.currentCompanyId,
        locationId,
        userId,
        username,
        cashAccountId: cashAccountId || null,
        posStation: posStation || null,
        openingCash: openingCash || "0",
        status: "open",
      });

      res.json(shift);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Close a shift
  app.post("/api/pos/shifts/:id/close", requireAuth, async (req, res) => {
    try {
      const shiftId = parseInt(req.params.id);
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const shift = await storage.getShiftById(shiftId);
      if (!shift) {
        return res.status(404).json({ message: "Shift not found" });
      }

      // Verify user owns this shift and it belongs to current company
      if (shift.userId !== userId) {
        return res.status(403).json({ message: "You can only close your own shifts" });
      }
      if (shift.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (shift.status === "closed") {
        return res.status(400).json({ message: "Shift is already closed" });
      }

      const { closingCash, notes } = req.body;
      
      if (closingCash === undefined || closingCash === null) {
        return res.status(400).json({ message: "Closing cash amount is required" });
      }

      const closedShift = await storage.closeShift(shiftId, closingCash.toString(), notes);
      res.json(closedShift);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get last sold prices for all stock items in the company
  // Get last sold prices for all stock items (based on location's company)
  app.get("/api/pos/last-sold-prices", requireAuth, async (req, res) => {
    try {
      const locationId = parseInt(req.query.locationId as string);
      if (!locationId || isNaN(locationId)) {
        return res.status(400).json({ message: "Location ID is required" });
      }
      // Get the location to find its company
      const location = await storage.getLocationById(locationId);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      const prices = await storage.getLastSoldPrices(location.companyId);
      res.json(prices);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Draft POS Sales Routes
  // Get all drafts for current user
  app.get("/api/pos/drafts", requireAuth, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const locationId = req.query.locationId ? parseInt(req.query.locationId as string) : undefined;
      const drafts = await storage.getAllDraftPosSales(userId, locationId);
      res.json(drafts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get a specific draft by ID
  app.get("/api/pos/drafts/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const draft = await storage.getDraftPosSaleById(id);
      
      if (!draft) {
        return res.status(404).json({ message: "Draft not found" });
      }

      // Verify the draft belongs to the current user
      if (draft.userId !== req.user?.id) {
        return res.status(403).json({ message: "Access denied" });
      }

      res.json(draft);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create a new draft
  app.post("/api/pos/drafts", requireAuth, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const { locationId, paymentAccountType, paymentAccountId, isCreditSale, notes, items } = req.body;

      if (!locationId) {
        return res.status(400).json({ message: "Location is required" });
      }
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "At least one item is required" });
      }

      const draftData: InsertDraftPosSale = {
        userId,
        locationId,
        paymentAccountType: paymentAccountType || null,
        paymentAccountId: paymentAccountId || null,
        isCreditSale: isCreditSale || false,
        notes: notes || null,
      };

      const draft = await storage.createDraftPosSale(draftData, items);
      res.status(201).json(draft);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update an existing draft
  app.patch("/api/pos/drafts/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      // Verify the draft belongs to the current user
      const existingDraft = await storage.getDraftPosSaleById(id);
      if (!existingDraft) {
        return res.status(404).json({ message: "Draft not found" });
      }
      if (existingDraft.userId !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const { locationId, paymentAccountType, paymentAccountId, isCreditSale, notes, items } = req.body;

      const updateData: Partial<InsertDraftPosSale> = {};
      if (locationId !== undefined) updateData.locationId = locationId;
      if (paymentAccountType !== undefined) updateData.paymentAccountType = paymentAccountType;
      if (paymentAccountId !== undefined) updateData.paymentAccountId = paymentAccountId;
      if (isCreditSale !== undefined) updateData.isCreditSale = isCreditSale;
      if (notes !== undefined) updateData.notes = notes;

      const draft = await storage.updateDraftPosSale(id, updateData, items);
      res.json(draft);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Delete a draft
  app.delete("/api/pos/drafts/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      // Verify the draft belongs to the current user
      const existingDraft = await storage.getDraftPosSaleById(id);
      if (!existingDraft) {
        return res.status(404).json({ message: "Draft not found" });
      }
      if (existingDraft.userId !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      await storage.deleteDraftPosSale(id);
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POS Customers - GET endpoint (for POS users with canAccessCustomers permission)
  app.get("/api/pos/customers", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // If session flag is missing/false, check DB directly as a fallback
      // (covers stale sessions that predate the canAccessCustomers session field)
      let hasAccess = req.user?.canAccessCustomers ?? false;
      if (!hasAccess && req.session.userId && req.session.currentCompanyId) {
        const [roleRow] = await db
          .select({ canAccessCustomers: userCompanyRoles.canAccessCustomers })
          .from(userCompanyRoles)
          .where(and(
            eq(userCompanyRoles.userId, String(req.session.userId)),
            eq(userCompanyRoles.companyId, req.session.currentCompanyId),
          ));
        if (roleRow?.canAccessCustomers) {
          hasAccess = true;
          req.session.canAccessCustomers = true;
        }
      }

      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied: You do not have permission to access customers" });
      }

      const customers = await storage.getAllCustomers(req.session.currentCompanyId);

      const customersWithBalances = await Promise.all(
        customers.map(async (customer) => {
          if (customer.ledgerAccountId) {
            const entries = await storage.getVoucherEntriesByLedger(customer.ledgerAccountId);
            const openingBalance = parseFloat(customer.openingBalance || "0");
            const openingSide = customer.openingBalanceSide || "Dr";

            const balance = entries.reduce((sum, entry) => {
              const debit = parseFloat(entry.debitAmount || "0");
              const credit = parseFloat(entry.creditAmount || "0");

              if (debit > 0 && credit === 0) {
                return sum + debit;
              } else if (credit > 0 && debit === 0) {
                return sum - credit;
              }
              return sum;
            }, openingSide === "Dr" ? openingBalance : -openingBalance);

            return {
              ...customer,
              balance: Math.abs(balance),
              balanceSide: balance >= 0 ? "Dr" : "Cr",
            };
          }

          const customerBalance = await storage.getCustomerBalance(customer.id, req.session.currentCompanyId!);
          const openingBalance = parseFloat(customer.openingBalance || "0");
          const openingSide = customer.openingBalanceSide || "Dr";
          
          const totalBalance = (openingSide === "Dr" ? openingBalance : -openingBalance) + customerBalance;
          
          return {
            ...customer,
            balance: Math.abs(totalBalance),
            balanceSide: totalBalance >= 0 ? "Dr" : "Cr",
          };
        })
      );

      res.json(customersWithBalances);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POS Customers - POST endpoint (for POS users with canAccessCustomers permission)
  app.post("/api/pos/customers", requireAuth, async (req, res) => {
    try {
      if (!req.user?.canAccessCustomers) {
        return res.status(403).json({ message: "Access denied: You do not have permission to create customers" });
      }

      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const dataWithCompany = {
        ...req.body,
        companyId: req.session.currentCompanyId,
      };

      const parsed = insertCustomerSchema.parse(dataWithCompany);

      let code = "CUST001";
      let suffix = 1;
      const allCustomers = await storage.getAllCustomers(req.session.currentCompanyId);

      const existingCodes = allCustomers
        .map((c) => c.code)
        .filter((c) => c.startsWith("CUST"))
        .map((c) => parseInt(c.replace("CUST", "")))
        .filter((n) => !isNaN(n));

      if (existingCodes.length > 0) {
        const maxNumber = Math.max(...existingCodes);
        suffix = maxNumber + 1;
      }

      code = `CUST${suffix.toString().padStart(3, "0")}`;

      while (await storage.getCustomerByCode(code, req.session.currentCompanyId)) {
        suffix++;
        code = `CUST${suffix.toString().padStart(3, "0")}`;
      }

      const customer = await storage.createCustomer({ ...parsed, code } as any);

      const customerAccountCode = `CUST-${customer.code}`;
      let customerAccount = await storage.getLedgerAccountByCode(customerAccountCode, req.session.currentCompanyId!);

      if (!customerAccount) {
        customerAccount = await storage.createLedgerAccount({
          companyId: req.session.currentCompanyId,
          code: customerAccountCode,
          name: `${customer.legalName} - Customer Account`,
          accountType: "Asset",
          subType: "Accounts Receivable",
          openingBalance: parsed.openingBalance || "0",
          openingBalanceSide: parsed.openingBalanceSide || "Dr",
          active: true,
        });

        await storage.updateCustomer(customer.id, {
          ledgerAccountId: customerAccount.id,
        });
      }

      res.status(201).json(customer);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // ── POS WhatsApp Shift Report ─────────────────────────────────────────────
  app.post("/api/pos/send-shift-report", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const userId = req.session.userId!;

      // Determine location — POS users have an assigned location; admin can pass locationId
      let locationId: number | null = null;
      if (req.body.locationId) {
        locationId = parseInt(req.body.locationId as string);
      } else {
        const ucr = await db
          .select({ assignedLocationId: userCompanyRoles.assignedLocationId })
          .from(userCompanyRoles)
          .where(and(eq(userCompanyRoles.userId, userId), eq(userCompanyRoles.companyId, companyId)))
          .limit(1);
        locationId = ucr[0]?.assignedLocationId ?? null;
      }

      if (!locationId) return res.status(400).json({ message: "No location found for this user" });

      // Fetch location record (includes whatsapp_group_chat_id)
      const [location] = await db
        .select()
        .from(locations)
        .where(and(eq(locations.id, locationId), eq(locations.companyId, companyId)))
        .limit(1);

      if (!location) return res.status(404).json({ message: "Location not found" });

      if (!location.whatsappGroupChatId) {
        return res.status(400).json({ message: "WhatsApp group not configured for this location" });
      }

      // Fetch current stock for this location
      const stockRows = await db
        .select({
          name: stockItems.name,
          unit: stockItems.uom,
          quantity: inventory.quantity,
          groupName: stockGroups.name,
        })
        .from(inventory)
        .innerJoin(stockItems, eq(inventory.stockItemId, stockItems.id))
        .leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id))
        .where(and(eq(inventory.locationId, locationId), eq(inventory.companyId, companyId)))
        .orderBy(asc(stockGroups.name), asc(stockItems.name));

      // Fetch today's open or most-recently-closed shift for context
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const shifts = await db
        .select()
        .from(posShifts)
        .where(
          and(
            eq(posShifts.locationId, locationId),
            eq(posShifts.companyId, companyId),
            gte(posShifts.openedAt, today),
          )
        )
        .orderBy(desc(posShifts.openedAt))
        .limit(1);

      const shift = shifts[0] ?? null;
      const now = new Date();
      const dateStr = format(now, "dd MMM yyyy, h:mm a");

      // Build grouped stock lines
      let lastGroup = "";
      const stockLines: string[] = [];
      for (const row of stockRows) {
        const qty = parseFloat(row.quantity ?? "0");
        const group = row.groupName ?? "General";
        if (group !== lastGroup) {
          stockLines.push(`\n*${group}*`);
          lastGroup = group;
        }
        const flag = qty < 0 ? " ⚠️" : "";
        const unitLabel = row.unit ? ` ${row.unit}` : "";
        stockLines.push(`  • ${row.name}: ${qty.toLocaleString()}${unitLabel}${flag}`);
      }

      const stockSection = stockLines.length
        ? stockLines.join("\n")
        : "  No stock data available";

      const salesLine = shift
        ? `*Sales Today:* ${shift.salesCount ?? 0} transactions | ${parseFloat(shift.salesTotal ?? "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : "";

      const senderName = req.user?.username || userId;

      const message = [
        `📍 *${location.name} — Stock Report*`,
        `🕐 Sent by ${senderName} on ${dateStr}`,
        ``,
        `*Current Stock:*${stockSection}`,
        ``,
        salesLine,
      ]
        .filter((l) => l !== undefined)
        .join("\n")
        .trim();

      const result = await sendWhatsAppTextToChatIdPos(location.whatsappGroupChatId, message);
      if (!result.success) {
        return res.status(502).json({ message: result.error ?? "Failed to send WhatsApp message" });
      }

      res.json({ success: true, message: "Stock report sent to WhatsApp" });
    } catch (error: any) {
      console.error("[/api/pos/send-shift-report]", {
        locationId: req.body.locationId,
        chatId: (error as any)?.chatId ?? undefined,
        error: error?.message ?? error,
      });
      res.status(500).json({ message: error.message });
    }
  });

  // ── POS Stock PDF → WhatsApp ──────────────────────────────────────────────
  app.post("/api/pos/send-stock-pdf", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const userId = req.session.userId!;

      let locationId: number | null = null;
      if (req.body.locationId) {
        locationId = parseInt(req.body.locationId as string);
      } else {
        const ucr = await db
          .select({ assignedLocationId: userCompanyRoles.assignedLocationId })
          .from(userCompanyRoles)
          .where(and(eq(userCompanyRoles.userId, userId), eq(userCompanyRoles.companyId, companyId)))
          .limit(1);
        locationId = ucr[0]?.assignedLocationId ?? null;
      }

      if (!locationId) return res.status(400).json({ message: "No location found for this user" });

      const [location] = await db
        .select()
        .from(locations)
        .where(and(eq(locations.id, locationId), eq(locations.companyId, companyId)))
        .limit(1);

      if (!location) return res.status(404).json({ message: "Location not found" });

      if (!location.whatsappGroupChatId) {
        return res.status(400).json({ message: "No WhatsApp group configured for this location" });
      }

      // Fetch stock inventory grouped
      const stockRows = await db
        .select({
          name:      stockItems.name,
          unit:      stockItems.uom,
          quantity:  inventory.quantity,
          groupName: stockGroups.name,
          groupCode: stockGroups.code,
        })
        .from(inventory)
        .innerJoin(stockItems, eq(inventory.stockItemId, stockItems.id))
        .leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id))
        .where(and(eq(inventory.locationId, locationId), eq(inventory.companyId, companyId)))
        .orderBy(asc(stockGroups.name), asc(stockItems.name));

      // Filter zero-qty rows and group
      const nonZero = stockRows.filter(r => parseFloat(r.quantity ?? "0") !== 0);
      const grouped: Record<string, { name: string; items: typeof nonZero }> = {};
      for (const row of nonZero) {
        const key = row.groupCode ?? row.groupName ?? "Unassigned";
        if (!grouped[key]) grouped[key] = { name: row.groupName ?? "Unassigned", items: [] };
        grouped[key].items.push(row);
      }
      const grandTotal = nonZero.reduce((s, r) => s + Math.floor(parseFloat(r.quantity ?? "0")), 0);
      const now = new Date();
      const dateHeader  = format(now, "dd-MMM-yy");
      const printedStr  = `Printed: ${format(now, "dd-MMM-yy HH:mm")}`;
      const captionDate = format(now, "dd MMM yyyy, h:mm a");

      // Build PDF with PDFKit — mirroring the LocationInventory print template
      const doc = new PDFDocument({ size: "A4", margin: 40, autoFirstPage: true });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      let pageNum = 1;

      // helper: draw page footer (page number)
      const drawFooter = () => {
        const pageH = doc.page.height;
        doc.fontSize(8).font("Helvetica").fillColor("#888888")
          .text(`Page ${pageNum}`, 40, pageH - 28, { width: 515, align: "right" });
      };

      doc.on("pageAdded", () => {
        pageNum++;
      });

      await new Promise<void>((resolve, reject) => {
        doc.on("end", resolve);
        doc.on("error", reject);

        // ── Header ──────────────────────────────────────────────────────────
        // Location name — bold + underline
        doc.fontSize(16).font("Helvetica-Bold").fillColor("#000000");
        const nameText = location.name;
        const nameW = doc.widthOfString(nameText);
        const nameX = (515 - nameW) / 2 + 40;
        const nameY = doc.y;
        doc.text(nameText, { align: "center" });
        doc.moveTo(nameX, nameY + 18).lineTo(nameX + nameW, nameY + 18)
          .strokeColor("#000000").lineWidth(0.75).stroke();

        // "Godown Summary"
        doc.fontSize(12).font("Helvetica-Bold")
          .text("Godown Summary", { align: "center" });

        // Date (dd-MMM-yy)
        doc.fontSize(9).font("Helvetica").fillColor("#333333")
          .text(dateHeader, { align: "center" });

        doc.moveDown(0.4);

        // "Printed: …" left  /  "Page 1" right
        const metaY = doc.y;
        doc.fontSize(8).font("Helvetica").fillColor("#666666");
        doc.text(printedStr, 40, metaY, { lineBreak: false });
        doc.text("Page 1", 40, metaY, { width: 515, align: "right", lineBreak: false });
        doc.moveDown(0.6);

        // Separator
        doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor("#cccccc").lineWidth(0.75).stroke();
        doc.moveDown(0.5);

        // ── Column header ────────────────────────────────────────────────────
        const colParticulars = 40;
        const colQtyRight    = 555;
        const colQtyW        = 90;

        const thY = doc.y;
        doc.rect(40, thY - 2, 515, 28).fillColor("#1a3a5c").fill();
        doc.fontSize(10).font("Helvetica-Bold").fillColor("#ffffff");
        doc.text("Particulars", colParticulars + 4, thY + 2, { lineBreak: false });
        doc.text("Closing Balance", colQtyRight - colQtyW, thY + 2, { width: colQtyW, align: "right", lineBreak: false });

        // "Quantity" sub-label
        doc.fontSize(7.5).font("Helvetica").fillColor("#b0c4d8");
        doc.text("Quantity", colQtyRight - colQtyW, thY + 15, { width: colQtyW, align: "right", lineBreak: false });
        doc.moveDown(1.5);

        doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor("#1a3a5c").lineWidth(1).stroke();
        doc.moveDown(0.4);

        // ── Rows ─────────────────────────────────────────────────────────────
        for (const [, { name, items }] of Object.entries(grouped)) {
          const groupQty = items.reduce((s, i) => s + Math.floor(parseFloat(i.quantity ?? "0")), 0);
          const groupUom = items[0]?.unit ?? "";

          // Group header row — dark background, bold text
          const gy = doc.y;
          doc.rect(40, gy - 2, 515, 16).fillColor("#dde3ec").fill();
          doc.moveTo(40, gy - 2).lineTo(555, gy - 2).strokeColor("#4a6080").lineWidth(0.75).stroke();
          doc.font("Helvetica-Bold").fontSize(10).fillColor("#1a3a5c");
          doc.text(name, colParticulars, gy, { lineBreak: false });
          doc.text(`${groupQty.toLocaleString()} ${groupUom}`.trim(), colQtyRight - colQtyW, gy, { width: colQtyW, align: "right", lineBreak: false });
          doc.moveDown(0.9);
          const gyBottom = doc.y;
          doc.moveTo(40, gyBottom).lineTo(555, gyBottom).strokeColor("#4a6080").lineWidth(0.75).stroke();
          doc.moveDown(0.2);

          // Item rows
          for (let ii = 0; ii < items.length; ii++) {
            const item = items[ii];
            const qty = Math.floor(parseFloat(item.quantity ?? "0"));
            const uom = item.unit ?? "";
            const isNeg = qty < 0;
            const iy = doc.y;
            // Alternate row tint
            if (ii % 2 === 1) {
              doc.rect(40, iy - 2, 515, 15).fillColor("#f4f6f9").fill();
            }
            if (isNeg) {
              doc.rect(40, iy - 2, 515, 15).fillColor("#fff0f0").fill();
            }
            doc.font("Helvetica").fontSize(9.5).fillColor(isNeg ? "#c0392b" : "#111111");
            doc.text(item.name, colParticulars + 10, iy, { lineBreak: false });
            const qtyLabel = `${qty.toLocaleString()} ${uom}`.trim();
            doc.font(isNeg ? "Helvetica-Bold" : "Helvetica")
               .text(qtyLabel, colQtyRight - colQtyW, iy, { width: colQtyW, align: "right", lineBreak: false });
            doc.moveDown(0.85);
            // Visible separator line between items
            doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor("#c8d0da").lineWidth(0.5).stroke();
            doc.moveDown(0.1);
          }
          doc.moveDown(0.2);
        }

        // ── Grand total ──────────────────────────────────────────────────────
        doc.moveDown(0.3);
        doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor("#1a3a5c").lineWidth(1.25).stroke();
        doc.moveDown(0.3);
        const ty = doc.y;
        doc.rect(40, ty - 2, 515, 20).fillColor("#1a3a5c").fill();
        doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#ffffff");
        const gtUom = nonZero[0]?.unit ?? "";
        doc.text("Grand Total", colParticulars + 4, ty + 3, { lineBreak: false });
        doc.text(`${grandTotal.toLocaleString()} ${gtUom}`.trim(), colQtyRight - colQtyW, ty + 3, { width: colQtyW, align: "right", lineBreak: false });
        doc.moveDown(1.2);
        doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor("#1a3a5c").lineWidth(1.25).stroke();

        drawFooter();
        doc.end();
      });

      const pdfBuffer = Buffer.concat(chunks);
      const safeLocationName = location.name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
      const fileName = `Stock_${safeLocationName}_${format(now, "yyyyMMdd_HHmm")}.pdf`;
      const caption  = `📍 ${location.name} — Stock Report\n🕐 ${captionDate}`;

      console.log(`[WA stock upload] chatId=${location.whatsappGroupChatId} file=${fileName} size=${pdfBuffer.length}`);
      const result = await sendWhatsAppFileByUploadPos(
        location.whatsappGroupChatId,
        pdfBuffer,
        fileName,
        caption,
      );

      if (!result.success) {
        console.error("[/api/pos/send-stock-pdf]", {
          locationId,
          chatId: location.whatsappGroupChatId,
          pdfUrl,
          error: result.error,
        });
        return res.status(502).json({ message: result.error ?? "Failed to send WhatsApp PDF" });
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("[/api/pos/send-stock-pdf]", {
        locationId: req.body.locationId,
        error: error?.message ?? error,
      });
      res.status(500).json({ message: error.message });
    }
  });

  // ── POS Customer Transactions (statement) ────────────────────────────────
  app.get("/api/pos/customers/:id/transactions", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const customerId = parseInt(req.params.id);
      if (isNaN(customerId)) return res.status(400).json({ message: "Invalid customer ID" });

      const customer = await storage.getCustomerById(customerId);
      if (!customer) return res.status(404).json({ message: "Customer not found" });
      if (customer.companyId !== companyId) return res.status(403).json({ message: "Access denied" });

      const { startDate, endDate } = req.query;
      let transactions: any[] = [];
      if (customer.ledgerAccountId) {
        transactions = await storage.getVoucherEntriesByLedger(
          customer.ledgerAccountId,
          startDate as string | undefined,
          endDate as string | undefined,
        );
      } else {
        transactions = await storage.getVoucherEntriesByCustomer(
          customerId,
          startDate as string | undefined,
          endDate as string | undefined,
        );
      }

      res.json(transactions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── POS Send Invoice to WhatsApp ──────────────────────────────────────────
  app.post("/api/pos/send-invoice-whatsapp", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { voucherId } = req.body;
      if (!voucherId) return res.status(400).json({ message: "voucherId is required" });

      // Fetch the voucher
      const [voucher] = await db
        .select()
        .from(vouchers)
        .where(and(eq(vouchers.id, parseInt(voucherId)), eq(vouchers.companyId, companyId)))
        .limit(1);

      if (!voucher) return res.status(404).json({ message: "Voucher not found" });

      // Fetch the location for this voucher
      const locationId = voucher.locationId;
      if (!locationId) return res.status(400).json({ message: "Voucher has no location" });

      const [location] = await db
        .select()
        .from(locations)
        .where(and(eq(locations.id, locationId), eq(locations.companyId, companyId)))
        .limit(1);

      if (!location) return res.status(404).json({ message: "Location not found" });
      if (!location.whatsappGroupChatId) {
        return res.status(400).json({ message: "WhatsApp group not configured for this location" });
      }

      // Fetch sale items with all fields needed for the invoice PDF
      const items = await db
        .select({
          name:            stockItems.name,
          quantity:        salesItems.quantity,
          sellingPrice:    salesItems.sellingPrice,
          configuredPrice: salesItems.configuredPrice,
          totalSales:      salesItems.totalSales,
        })
        .from(salesItems)
        .innerJoin(stockItems, eq(salesItems.stockItemId, stockItems.id))
        .where(eq(salesItems.voucherId, voucher.id));

      const senderName = req.user?.username || "POS";
      const totalAmount = parseFloat(voucher.totalAmount);

      // ── Number formatting helpers ────────────────────────────────────────────
      const fmtN = (n: number): string => {
        if (n === 0) return "0";
        const abs = Math.abs(n);
        const s = abs % 1 === 0
          ? abs.toLocaleString("en-US")
          : abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return (n < 0 ? "-" : "") + s;
      };
      const fmtC = (n: number) => `$ ${fmtN(n)}`;

      // ── Build PDF ────────────────────────────────────────────────────────────
      // A4 width=595.28pt; left/right margin=36 → usable=523.28
      const ML = 36, MR = 36;
      const PW = 595.28;
      const USE = PW - ML - MR; // 523.28

      // Column proportions — Description wider for readability
      const cols = [
        { label: "Description", w: Math.floor(USE * 0.32), align: "left"   as const },
        { label: "Qty",         w: Math.floor(USE * 0.07), align: "center" as const },
        { label: "Rate",        w: Math.floor(USE * 0.10), align: "right"  as const },
        { label: "Amount",      w: Math.floor(USE * 0.11), align: "right"  as const },
        { label: "Config",      w: Math.floor(USE * 0.10), align: "right"  as const },
        { label: "P/L Bale",   w: Math.floor(USE * 0.13), align: "right"  as const },
        { label: "Total P/L",  w: Math.floor(USE * 0.13), align: "right"  as const },
      ];
      // Pad last column to cover rounding gaps
      const totalColW = cols.reduce((s, c) => s + c.w, 0);
      cols[cols.length - 1].w += USE - totalColW;

      let cx = ML;
      const colX: number[] = [];
      for (const c of cols) { colX.push(cx); cx += c.w; }
      const tableRight = ML + USE;

      const ROW_H    = 20;   // was 14 — more breathing room
      const HDR_H    = 22;   // was 16
      const CELL_PAD = 5;    // was 3
      const FS_HDR   = 8.5;  // was 7
      const FS_ROW   = 8.5;  // was 7

      // Accent colour for header strip
      const ACCENT   = "#1a3a5c";
      const ACCENT_BG = "#eef2f7";

      const pdoc = new PDFDocument({ size: "A4", margin: ML, autoFirstPage: true });
      const pchunks: Buffer[] = [];
      pdoc.on("data", (c: Buffer) => pchunks.push(c));

      await new Promise<void>((resolve, reject) => {
        pdoc.on("end", resolve);
        pdoc.on("error", reject);

        const drawCell = (
          text: string,
          x: number, y: number, w: number, h: number,
          opts: { align?: "left"|"center"|"right"; bold?: boolean; color?: string; bg?: string; border?: string; fontSize?: number } = {}
        ) => {
          const bg     = opts.bg ?? null;
          const border = opts.border ?? "#bbbbbb";
          if (bg) { pdoc.rect(x, y, w, h).fillColor(bg).fill(); }
          pdoc.rect(x, y, w, h).strokeColor(border).lineWidth(0.5).stroke();
          pdoc.font(opts.bold ? "Helvetica-Bold" : "Helvetica")
              .fontSize(opts.fontSize ?? FS_ROW)
              .fillColor(opts.color ?? "#000000");
          const textY = y + (h - (opts.fontSize ?? FS_ROW)) / 2 - 0.5;
          pdoc.text(text, x + CELL_PAD, textY, {
            width: w - CELL_PAD * 2,
            align: opts.align ?? "left",
            lineBreak: false,
          });
        };

        // ── Title block ────────────────────────────────────────────────────────
        // Thin top accent bar
        pdoc.rect(ML, 28, USE, 3).fillColor(ACCENT).fill();
        pdoc.font("Helvetica-Bold").fontSize(15).fillColor(ACCENT)
          .text("POS INVOICE", ML, 38, { width: USE, align: "center", lineBreak: false });
        // Location name (sub-title)
        pdoc.font("Helvetica").fontSize(9).fillColor("#555555")
          .text(location.name, ML, 57, { width: USE, align: "center", lineBreak: false });
        // Bottom rule under title
        pdoc.moveTo(ML, 70).lineTo(tableRight, 70).strokeColor(ACCENT).lineWidth(1).stroke();

        // ── Date / User row ────────────────────────────────────────────────────
        const infoY = 75;
        pdoc.font("Helvetica-Bold").fontSize(9).fillColor("#222222");
        pdoc.text(`Date:  ${voucher.voucherDate}`, ML, infoY, { lineBreak: false });
        pdoc.text(`User:  ${senderName}`, ML, infoY, { width: USE, align: "right", lineBreak: false });
        pdoc.moveTo(ML, infoY + 14).lineTo(tableRight, infoY + 14).strokeColor("#cccccc").lineWidth(0.75).stroke();

        // ── Credit sale label ──────────────────────────────────────────────────
        let tableStartY = infoY + 22;
        if (voucher.isCreditSale) {
          pdoc.rect(ML, tableStartY, USE, 16)
            .fillColor("#fff3cd").fill();
          pdoc.rect(ML, tableStartY, USE, 16)
            .strokeColor("#e0a800").lineWidth(0.75).stroke();
          pdoc.font("Helvetica-Bold").fontSize(8.5).fillColor("#856404")
            .text("CREDIT SALE", ML + CELL_PAD, tableStartY + 4, { lineBreak: false });
          tableStartY += 20;
        }

        // ── Table header ───────────────────────────────────────────────────────
        let hy = tableStartY;
        for (let i = 0; i < cols.length; i++) {
          drawCell(cols[i].label, colX[i], hy, cols[i].w, HDR_H, {
            align: cols[i].align, bold: true,
            bg: ACCENT_BG, border: "#8fa8c8", fontSize: FS_HDR,
            color: ACCENT,
          });
        }
        let rowY = hy + HDR_H;

        // ── Item rows ──────────────────────────────────────────────────────────
        let totalQty = 0, totalAmt = 0, totalPL = 0;
        items.forEach((item, idx) => {
          const qty     = parseFloat(item.quantity);
          const rate    = parseFloat(item.sellingPrice);
          const amt     = qty * rate;
          const config  = parseFloat(item.configuredPrice ?? "0");
          const plBale  = rate - config;
          const pl      = plBale * qty;
          totalQty += qty; totalAmt += amt; totalPL += pl;

          const bg = idx % 2 === 0 ? "#ffffff" : "#f8fafc";
          const plBaleColor  = plBale > 0 ? "#15803d" : plBale < 0 ? "#b91c1c" : "#000000";
          const plTotalColor = pl     > 0 ? "#15803d" : pl     < 0 ? "#b91c1c" : "#000000";

          drawCell(item.name,    colX[0], rowY, cols[0].w, ROW_H, { align: "left",   bg, border: "#d8e0ea" });
          drawCell(fmtN(qty),    colX[1], rowY, cols[1].w, ROW_H, { align: "center", bg, border: "#d8e0ea" });
          drawCell(fmtC(rate),   colX[2], rowY, cols[2].w, ROW_H, { align: "right",  bg, border: "#d8e0ea" });
          drawCell(fmtC(amt),    colX[3], rowY, cols[3].w, ROW_H, { align: "right",  bg, border: "#d8e0ea" });
          drawCell(fmtC(config), colX[4], rowY, cols[4].w, ROW_H, { align: "right",  bg, border: "#d8e0ea" });
          drawCell(fmtC(plBale), colX[5], rowY, cols[5].w, ROW_H, { align: "right",  bg, border: "#d8e0ea", color: plBaleColor });
          drawCell(fmtC(pl),     colX[6], rowY, cols[6].w, ROW_H, { align: "right",  bg, border: "#d8e0ea", color: plTotalColor });
          rowY += ROW_H;
        });

        // ── Totals row ─────────────────────────────────────────────────────────
        const plTotColor = totalPL > 0 ? "#15803d" : totalPL < 0 ? "#b91c1c" : "#000000";
        const TOT_H = ROW_H + 2;
        drawCell("TOTAL",        colX[0], rowY, cols[0].w, TOT_H, { bold: true, bg: ACCENT_BG, border: "#8fa8c8", color: ACCENT });
        drawCell(fmtN(totalQty), colX[1], rowY, cols[1].w, TOT_H, { align: "center", bold: true, bg: ACCENT_BG, border: "#8fa8c8", color: ACCENT });
        drawCell("",             colX[2], rowY, cols[2].w, TOT_H, { bg: ACCENT_BG, border: "#8fa8c8" });
        drawCell(fmtC(totalAmt), colX[3], rowY, cols[3].w, TOT_H, { align: "right",  bold: true, bg: ACCENT_BG, border: "#8fa8c8", color: ACCENT });
        drawCell("",             colX[4], rowY, cols[4].w, TOT_H, { bg: ACCENT_BG, border: "#8fa8c8" });
        drawCell("",             colX[5], rowY, cols[5].w, TOT_H, { bg: ACCENT_BG, border: "#8fa8c8" });
        drawCell(fmtC(totalPL),  colX[6], rowY, cols[6].w, TOT_H, { align: "right",  bold: true, bg: ACCENT_BG, border: "#8fa8c8", color: plTotColor });
        rowY += TOT_H + 10;

        // ── Total Paid ─────────────────────────────────────────────────────────
        pdoc.moveTo(ML, rowY).lineTo(tableRight, rowY).strokeColor(ACCENT).lineWidth(1).stroke();
        rowY += 7;
        pdoc.font("Helvetica-Bold").fontSize(12).fillColor(ACCENT);
        pdoc.text("TOTAL PAID:", ML, rowY, { lineBreak: false });
        pdoc.text(fmtC(totalAmount), ML, rowY, { width: USE, align: "right", lineBreak: false });
        rowY += 22;

        // ── Note ───────────────────────────────────────────────────────────────
        if (voucher.description) {
          pdoc.rect(ML, rowY, USE, 20).fillColor("#f8f9fa").fill();
          pdoc.rect(ML, rowY, USE, 20).strokeColor("#cccccc").lineWidth(0.75).stroke();
          pdoc.font("Helvetica-Bold").fontSize(9).fillColor("#555555")
            .text("Note: ", ML + CELL_PAD, rowY + 5, { continued: true, lineBreak: false });
          pdoc.font("Helvetica").fillColor("#111111")
            .text(voucher.description, { lineBreak: false });
          rowY += 28;
        }

        // ── Footer ─────────────────────────────────────────────────────────────
        rowY += 8;
        pdoc.moveTo(ML, rowY).lineTo(tableRight, rowY).strokeColor("#cccccc").lineWidth(0.75).stroke();
        rowY += 7;
        pdoc.font("Helvetica").fontSize(8.5).fillColor("#888888")
          .text("Thank you for your business!", ML, rowY, { width: USE, align: "center" });

        pdoc.end();
      });

      const pdfBuffer = Buffer.concat(pchunks);
      const company   = await storage.getCompanyById(companyId);
      const safeLoc   = (location.name ?? "").replace(/[^a-zA-Z0-9 \-]/g, "").trim();
      const safeCo    = (company?.name ?? "").replace(/[^a-zA-Z0-9 \-]/g, "").trim();
      const safeDate  = (voucher.voucherDate ?? getClientDate(req)).replace(/[^0-9-]/g, "");
      const fileName  = `${safeLoc} ${safeCo} ${safeDate}.pdf`.replace(/\s+/g, " ").trim();
      const caption   = `📍 ${location.name} — ${voucher.voucherNumber}`;

      console.log(`[WA invoice upload] chatId=${location.whatsappGroupChatId} file=${fileName} size=${pdfBuffer.length}`);
      const result = await sendWhatsAppFileByUploadPos(
        location.whatsappGroupChatId,
        pdfBuffer,
        fileName,
        caption,
      );
      if (!result.success) {
        return res.status(502).json({ message: result.error ?? "Failed to send WhatsApp PDF" });
      }

      res.json({ success: true, message: "Invoice PDF sent to WhatsApp" });
    } catch (error: any) {
      console.error("[/api/pos/send-invoice-whatsapp]", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Stock Transfers - LIST all for current company (with location names and item counts)
}
