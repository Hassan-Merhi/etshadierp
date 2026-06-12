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
  posShifts, userLocationCashAccounts,
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
import { getErpExportVisibility } from "../helpers/exportVisibility";
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

      // POS users can only send invoices for vouchers from their own shifts
      if (req.user?.role === "POS") {
        const [voucherToCheck] = await db
          .select({ id: vouchers.id, shiftId: vouchers.shiftId })
          .from(vouchers)
          .where(and(eq(vouchers.id, parseInt(voucherId)), eq(vouchers.companyId, companyId)))
          .limit(1);
        if (!voucherToCheck) {
          return res.status(404).json({ message: "Voucher not found" });
        }
        // Verify ownership via shift when a shiftId is present
        if (voucherToCheck.shiftId) {
          const [shift] = await db
            .select({ userId: posShifts.userId })
            .from(posShifts)
            .where(eq(posShifts.id, voucherToCheck.shiftId))
            .limit(1);
          if (!shift || shift.userId !== req.user.id) {
            return res.status(403).json({ message: "Access denied" });
          }
        }
      }

      const erpVis = await getErpExportVisibility(req);
      const hideProfitCols = erpVis.hideSelling || erpVis.hideCost || erpVis.hideSalesProfitCost;
      const pdfBuffer = await generateInvoicePdf(parseInt(voucherId), companyId, (req as any).user?.username, { hideProfitCols });

      // Build filename — for credit sales include customer name
      const locName  = location.name;
      const dateStr  = getClientDate(req);

      let customerNameForFile: string | null = null;
      const [voucherMeta] = await db
        .select({ isCreditSale: vouchers.isCreditSale })
        .from(vouchers)
        .where(eq(vouchers.id, parseInt(voucherId)))
        .limit(1);
      if (voucherMeta?.isCreditSale) {
        const [custEntry] = await db
          .select({ name: ledgerAccounts.name })
          .from(voucherEntries)
          .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, voucherEntries.ledgerAccountId))
          .where(and(
            eq(voucherEntries.voucherId, parseInt(voucherId)),
            sql`${voucherEntries.debitAmount}::numeric > 0`,
          ))
          .limit(1);
        customerNameForFile = custEntry?.name || null;
      }

      const rawName = customerNameForFile
        ? `${customerNameForFile} Invoice ${locName} ${dateStr}`
        : `${locName} Invoice ${dateStr}`;
      const safeName = rawName.replace(/[^\w\s.()\-]/g, "_").trim();
      const caption  = "";

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
      // Detect supplier_partner company — uses split accounting (Cr Payable + Cr Profit) instead of Cr Sales
      const [currentCoRow] = await db
        .select({ companyType: companies.companyType })
        .from(companies)
        .where(eq(companies.id, req.session.currentCompanyId!))
        .limit(1);
      const isSpCompany = currentCoRow?.companyType === "supplier_partner";

      const isPOSUser = req.user?.role === "POS";

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

      // POS cash account enforcement: look up the mapped cash account from DB.
      // For POS users on non-credit sales, the cash account is determined server-side
      // from user_location_cash_accounts, not from the frontend submission.
      let posEnforcedCashAccountId: number | null = null;
      if (isPOSUser && !isCreditSale) {
        const parsedLocId = locationId ? Number(locationId) : null;
        // Block immediately — POS users must always supply a location for cash sales.
        if (!parsedLocId) {
          return res.status(400).json({ message: "Location is required for POS sales" });
        }
        const [locMapping] = await db
          .select({ cashAccountId: userLocationCashAccounts.cashAccountId })
          .from(userLocationCashAccounts)
          .where(
            and(
              eq(userLocationCashAccounts.userId, req.user!.id),
              eq(userLocationCashAccounts.companyId, req.session.currentCompanyId!),
              eq(userLocationCashAccounts.locationId, parsedLocId),
            )
          )
          .limit(1);
        if (locMapping) {
          posEnforcedCashAccountId = locMapping.cashAccountId;
        } else {
          // Legacy fallback: only apply when this user has NO mappings at all
          // (pre-migration POS user). If any mapping exists, this location is
          // simply not configured — block with a clear error instead of using
          // a session account that belongs to a different location.
          const [anyMapping] = await db
            .select({ id: userLocationCashAccounts.id })
            .from(userLocationCashAccounts)
            .where(
              and(
                eq(userLocationCashAccounts.userId, req.user!.id),
                eq(userLocationCashAccounts.companyId, req.session.currentCompanyId!),
              )
            )
            .limit(1);
          if (!anyMapping && req.session.cashAccountId) {
            posEnforcedCashAccountId = req.session.cashAccountId;
          } else {
            return res.status(400).json({
              message: "No cash account assigned for this POS location. Contact admin.",
            });
          }
        }
      }

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
      } else if (posEnforcedCashAccountId !== null) {
        // POS users: use the server-enforced cash account from user_location_cash_accounts
        accountType = "cash";
        accountId = posEnforcedCashAccountId;
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

      // Validate shiftId if one was provided — if invalid/closed, just ignore it and proceed without a shift
      let effectiveShiftId: number | null = shiftId || null;
      if (effectiveShiftId) {
        const shift = await storage.getShiftById(effectiveShiftId);
        if (!shift || shift.companyId !== req.session.currentCompanyId || shift.locationId !== locationId || shift.status !== "open" || shift.userId !== req.user?.id) {
          effectiveShiftId = null;
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
      // Use getOrCreateLedgerAccount so soft-deleted duplicates don't cause a
      // unique-constraint crash — it handles the 23505 error and falls back to
      // fetching the existing (possibly soft-deleted) row.
      let salesAccount = await storage.getOrCreateLedgerAccount({
        companyId: req.session.currentCompanyId!,
        code: "SALES",
        name: "Sales Revenue",
        accountType: "Income",
        openingBalance: "0",
        active: true,
      });

      if (salesAccount.accountType !== "Income") {
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

      // ── SP company: fetch configured POS accounts & pre-compute supplier cost ──
      let spPosPayableAccountId: number | null = null;
      let spPosProfitAccountId: number | null = null;
      let spPosCostClrAccountId: number | null = null;
      let spPosDeductionClrAccountId: number | null = null;
      let totalSupplierCost = 0;
      // Per-qty deduction that silently reduces Supplier Cash Payable (not income/expense)
      const spPosDeductionPerQty = isSpCompany
        ? (parseFloat(String((location as any).supplierPartnerPayableDeductionPerQty ?? "0")) || 0)
        : 0;
      const spPosTotalQtySold = isSpCompany
        ? inventoryValidation.reduce((sum, v) => sum + v.saleQty, 0)
        : 0;
      if (isSpCompany) {
        const spSettings = await storage.getCompanySettings(req.session.currentCompanyId!);
        spPosPayableAccountId = spSettings?.spPosPayableAccountId ?? null;
        spPosProfitAccountId = spSettings?.spPosProfitAccountId ?? null;
        if (!spPosPayableAccountId || !spPosProfitAccountId) {
          return res.status(400).json({
            message: "Supplier POS payable/profit accounts are not configured. Go to SP Setup to set them up.",
          });
        }
        // Look up Stock Cost Payable Clearing account (sp_cost_clearing subType)
        const [clrAcct] = await db
          .select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(
            and(
              eq(ledgerAccounts.companyId, req.session.currentCompanyId!),
              eq(ledgerAccounts.subType, "sp_cost_clearing"),
              isNull(ledgerAccounts.deletedAt),
            ),
          )
          .limit(1);
        spPosCostClrAccountId = clrAcct?.id ?? null;
        // Look up Supplier Payable Deduction Clearing account (sp_pay_deduction_clearing subType)
        const [ddcAcct] = await db
          .select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(
            and(
              eq(ledgerAccounts.companyId, req.session.currentCompanyId!),
              eq(ledgerAccounts.subType, "sp_pay_deduction_clearing"),
              isNull(ledgerAccounts.deletedAt),
            ),
          )
          .limit(1);
        spPosDeductionClrAccountId = ddcAcct?.id ?? null;
        // Pre-compute total supplier cost from inventory averageRate (includes landed/offloading cost)
        totalSupplierCost = inventoryValidation.reduce(
          (sum, v) => sum + v.saleQty * v.currentRate,
          0,
        );
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
            shiftId: effectiveShiftId,
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

        if (!isSpCompany) {
          // Normal ERP: credit the full sale amount to the Sales Revenue account
          await tx.insert(voucherEntries).values({
            voucherId: txVoucher.id,
            ledgerAccountId: salesAccount.id,
            debitAmount: "0",
            creditAmount: grandTotal.toFixed(2),
            narration: creditSaleNarration,
          });
        } else {
          // Supplier Partner accounting:
          //   Dr Cash                           = grandTotal  (debit entry already written above)
          //   Cr Supplier Cash Payable          = grandTotal − deductionAmount
          //   Cr Deduction Clearing (hidden)    = deductionAmount          (if deduction > 0)
          //
          // The deduction is a silent per-qty reduction to what is owed to the supplier
          // (e.g. a warehouse loss charge). It is NOT income, profit, or an expense —
          // it flows into a hidden clearing liability that is excluded from all reports.
          const grandTotalRounded = Number(grandTotal.toFixed(2));
          const spDeductionAmount = Number((spPosTotalQtySold * spPosDeductionPerQty).toFixed(2));
          // Guard: deduction cannot exceed the sale total
          if (spDeductionAmount > Math.abs(grandTotalRounded)) {
            throw new Error(
              `Supplier payable deduction (${spDeductionAmount}) exceeds the sale total (${grandTotalRounded}). ` +
              `Adjust the deduction per qty setting on this location.`
            );
          }
          const spPayableAmount = Number((grandTotalRounded - spDeductionAmount).toFixed(2));

          if (grandTotalRounded > 0) {
            // Cr Supplier Cash Payable = reduced payable
            if (spPayableAmount > 0) {
              await tx.insert(voucherEntries).values({
                voucherId: txVoucher.id,
                ledgerAccountId: spPosPayableAccountId!,
                debitAmount: "0",
                creditAmount: spPayableAmount.toFixed(2),
                narration: `Supplier Cash Payable — ${voucherNumber}`,
              });
            }
            // Cr Deduction Clearing = deduction (keeps voucher balanced)
            if (spDeductionAmount > 0 && spPosDeductionClrAccountId) {
              await tx.insert(voucherEntries).values({
                voucherId: txVoucher.id,
                ledgerAccountId: spPosDeductionClrAccountId,
                debitAmount: "0",
                creditAmount: spDeductionAmount.toFixed(2),
                narration: `Supplier Payable Deduction (${spPosTotalQtySold} qty × ${spPosDeductionPerQty}) — ${voucherNumber}`,
              });
            }
          } else if (grandTotalRounded < 0) {
            // Reversal: Dr Supplier Cash Payable
            if (spPayableAmount < 0) {
              await tx.insert(voucherEntries).values({
                voucherId: txVoucher.id,
                ledgerAccountId: spPosPayableAccountId!,
                debitAmount: Math.abs(spPayableAmount).toFixed(2),
                creditAmount: "0",
                narration: `Supplier Cash Payable reversal — ${voucherNumber}`,
              });
            }
            if (spDeductionAmount > 0 && spPosDeductionClrAccountId) {
              await tx.insert(voucherEntries).values({
                voucherId: txVoucher.id,
                ledgerAccountId: spPosDeductionClrAccountId,
                debitAmount: spDeductionAmount.toFixed(2),
                creditAmount: "0",
                narration: `Supplier Payable Deduction reversal — ${voucherNumber}`,
              });
            }
          }
        }

        const txSaleItems: any[] = [];

        for (const validatedItem of inventoryValidation) {
          const { item, newQty, currentRate, inventoryRecord, currentQty, saleQty } =
            validatedItem;

          // Fix 3: Authoritative stock check inside the transaction with row lock.
          // Catches race conditions where two cashiers sell the last unit concurrently.
          // Use FOR UPDATE OF i (not the whole JOIN) because PostgreSQL rejects
          // FOR UPDATE on the nullable side of a LEFT JOIN.
          const stockLockResult = await (tx as any).execute(sql`
            SELECT i.quantity, si.name AS item_name
            FROM inventory i
            LEFT JOIN stock_items si ON si.id = i.stock_item_id
            WHERE i.location_id = ${parsedLocationId} AND i.stock_item_id = ${item.stockItemId}
            FOR UPDATE OF i
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

      try {
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId: req.session.currentCompanyId!,
          action: "create",
          tableName: "vouchers",
          recordId: voucher.id,
          recordIdentifier: voucherNumber,
          changes: {
            voucherNumber: { new: voucherNumber },
            voucherType: { new: "Sales" },
            saleType: { new: isCreditSale ? "Credit Invoice" : "Cash Sale" },
            location: { new: location.name },
            totalAmount: { new: grandTotal.toFixed(2) },
            date: { new: voucherDate },
            itemCount: { new: saleItems.length },
            customer: { new: customerAccount ? (customerAccount as any).name : null },
          },
        });
      } catch { /* non-fatal */ }

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

      // Detect supplier_partner for SP-specific accounting on edit
      const [editCoRow] = await db
        .select({ companyType: companies.companyType })
        .from(companies)
        .where(eq(companies.id, req.session.currentCompanyId!))
        .limit(1);
      const isSpCompanyEdit = editCoRow?.companyType === "supplier_partner";

      // For SP companies fetch configured POS payable/profit accounts upfront
      let editSpPayableAccountId: number | null = null;
      let editSpProfitAccountId: number | null = null;
      let editSpCostClrAccountId: number | null = null;
      let editSpDeductionClrAccountId: number | null = null;
      if (isSpCompanyEdit) {
        const spSettings = await storage.getCompanySettings(req.session.currentCompanyId!);
        editSpPayableAccountId = spSettings?.spPosPayableAccountId ?? null;
        editSpProfitAccountId = spSettings?.spPosProfitAccountId ?? null;
        if (!editSpPayableAccountId || !editSpProfitAccountId) {
          return res.status(400).json({
            message: "Supplier POS payable/profit accounts are not configured. Go to SP Setup to set them up.",
          });
        }
        // Look up Stock Cost Payable Clearing account (sp_cost_clearing subType)
        const [clrAcct] = await db
          .select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(
            and(
              eq(ledgerAccounts.companyId, req.session.currentCompanyId!),
              eq(ledgerAccounts.subType, "sp_cost_clearing"),
              isNull(ledgerAccounts.deletedAt),
            ),
          )
          .limit(1);
        editSpCostClrAccountId = clrAcct?.id ?? null;
        // Look up Supplier Payable Deduction Clearing account (sp_pay_deduction_clearing subType)
        const [ddcAcct] = await db
          .select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(
            and(
              eq(ledgerAccounts.companyId, req.session.currentCompanyId!),
              eq(ledgerAccounts.subType, "sp_pay_deduction_clearing"),
              isNull(ledgerAccounts.deletedAt),
            ),
          )
          .limit(1);
        editSpDeductionClrAccountId = ddcAcct?.id ?? null;
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

      // POS restrictions on existing sales:
      //   - Cannot change location: block if a different locationId is sent.
      //   - Cannot change payment account: silently strip paymentAccountType/paymentAccountId
      //     so the handler's preservation branch runs. Returning 403 here would break
      //     the POS edit form which always sends these fields even when unchanged.
      //   - Date changes are blocked by the canModifyDate middleware above.
      if (req.user?.role === "POS") {
        if (newLocationId && parseInt(newLocationId) !== existingVoucher.locationId) {
          return res.status(403).json({ message: "POS users cannot change the location of an existing sale" });
        }
        // Strip payment account fields — force the handler to preserve the original account
        (req.body as any).paymentAccountType = undefined;
        (req.body as any).paymentAccountId = undefined;
      }

      // Determine target location - use new location if provided, otherwise keep existing
      const oldLocationId = existingVoucher.locationId!;
      const targetLocationId = newLocationId ? parseInt(newLocationId) : oldLocationId;
      const locationChanged = targetLocationId !== oldLocationId;

      // SP edit: load target location's per-qty deduction rate
      let editSpDeductionPerQty = 0;
      if (isSpCompanyEdit) {
        const [editTargetLoc] = await db
          .select({ supplierPartnerPayableDeductionPerQty: locations.supplierPartnerPayableDeductionPerQty })
          .from(locations)
          .where(eq(locations.id, targetLocationId))
          .limit(1);
        editSpDeductionPerQty = parseFloat(String(editTargetLoc?.supplierPartnerPayableDeductionPerQty ?? "0")) || 0;
      }

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
        let totalSupplierCostEdit = 0;
        let totalQtySoldEdit = 0;
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
          totalSupplierCostEdit += totalCost;
          totalQtySoldEdit += sellQty;
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

        if (!isSpCompanyEdit) {
          // Normal ERP: single credit to Sales Revenue account
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
        } else {
          // Supplier Partner edit accounting (mirrors new-sale logic):
          //   Dr Cash / Receivable              = grandTotal  (debit entry already written above)
          //   Cr Supplier Cash Payable          = grandTotal − deductionAmount
          //   Cr Deduction Clearing (hidden)    = deductionAmount          (if deduction > 0)
          const grandTotalRounded = Number(grandTotal.toFixed(2));
          const editDeductionAmount = Number((totalQtySoldEdit * editSpDeductionPerQty).toFixed(2));
          if (editDeductionAmount > Math.abs(grandTotalRounded)) {
            throw new Error(
              `Supplier payable deduction (${editDeductionAmount}) exceeds the sale total (${grandTotalRounded}). ` +
              `Adjust the deduction per qty setting on this location.`
            );
          }
          const editSpPayableAmount = Number((grandTotalRounded - editDeductionAmount).toFixed(2));

          if (grandTotalRounded > 0) {
            if (editSpPayableAmount > 0) {
              await tx.insert(voucherEntries).values({
                voucherId,
                ledgerAccountId: editSpPayableAccountId!,
                debitAmount: "0",
                creditAmount: editSpPayableAmount.toFixed(2),
                narration: `Supplier Cash Payable`,
              });
            }
            if (editDeductionAmount > 0 && editSpDeductionClrAccountId) {
              await tx.insert(voucherEntries).values({
                voucherId,
                ledgerAccountId: editSpDeductionClrAccountId,
                debitAmount: "0",
                creditAmount: editDeductionAmount.toFixed(2),
                narration: `Supplier Payable Deduction (${totalQtySoldEdit} qty × ${editSpDeductionPerQty})`,
              });
            }
          } else if (grandTotalRounded < 0) {
            if (editSpPayableAmount < 0) {
              await tx.insert(voucherEntries).values({
                voucherId,
                ledgerAccountId: editSpPayableAccountId!,
                debitAmount: Math.abs(editSpPayableAmount).toFixed(2),
                creditAmount: "0",
                narration: `Supplier Cash Payable reversal`,
              });
            }
            if (editDeductionAmount > 0 && editSpDeductionClrAccountId) {
              await tx.insert(voucherEntries).values({
                voucherId,
                ledgerAccountId: editSpDeductionClrAccountId,
                debitAmount: editDeductionAmount.toFixed(2),
                creditAmount: "0",
                narration: `Supplier Payable Deduction reversal`,
              });
            }
          }
        }
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

      try {
        const _posChanges: Record<string, { old: any; new: any }> = {};
        if (existingVoucher.totalAmount !== updatedVoucher.totalAmount)
          _posChanges.totalAmount = { old: existingVoucher.totalAmount, new: updatedVoucher.totalAmount };
        if (existingVoucher.voucherDate !== updatedVoucher.voucherDate)
          _posChanges.date = { old: existingVoucher.voucherDate, new: updatedVoucher.voucherDate };
        if (existingVoucher.locationId !== updatedVoucher.locationId)
          _posChanges.locationId = { old: existingVoucher.locationId, new: updatedVoucher.locationId };
        _posChanges.itemCount = { new: updatedSalesItems.length };
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId: req.session.currentCompanyId!,
          action: "update",
          tableName: "vouchers",
          recordId: voucherId,
          recordIdentifier: updatedVoucher.voucherNumber,
          changes: _posChanges,
        });
      } catch { /* non-fatal */ }
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

      let shifts = await storage.getShiftsByLocation(locationId, limit);
      // POS users can only see their own shifts
      if (req.user?.role === "POS") {
        const posUserId = req.user.id;
        shifts = shifts.filter(s => s.userId === posUserId);
      }
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

      // POS users can only access their own shifts
      if (req.user?.role === "POS" && shift.userId !== req.user.id) {
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
      // Use getOrCreateLedgerAccount to survive soft-deleted duplicates that
      // would cause a unique-constraint crash with a plain INSERT.
      const customerAccount = await storage.getOrCreateLedgerAccount({
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

      const { buffer: pdfBuffer } = await generateStockPdf(companyId, location.name, locationId, location.name);
      const now = new Date();
      const safeLocationName = location.name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
      const fileName = `Stock_${safeLocationName}_${format(now, "yyyyMMdd_HHmm")}.pdf`;
      const caption  = "";

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

      // POS users can only send invoices for vouchers from their own shifts
      if (req.user?.role === "POS" && voucher.shiftId) {
        const [shift] = await db
          .select({ userId: posShifts.userId })
          .from(posShifts)
          .where(eq(posShifts.id, voucher.shiftId))
          .limit(1);
        if (!shift || shift.userId !== req.user.id) {
          return res.status(403).json({ message: "Access denied" });
        }
      }

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

      const senderName = req.user?.username || "POS";
      const waVis = await getErpExportVisibility(req);
      const hideProfitCols = waVis.hideSelling || waVis.hideCost || waVis.hideSalesProfitCost;
      const pdfBuffer = await generateInvoicePdf(parseInt(voucherId), companyId, senderName, { hideProfitCols });
      const safeDate  = (voucher.voucherDate ?? getClientDate(req)).replace(/[^0-9-]/g, "");
      const safeLoc   = (location.name ?? "").replace(/[^\w\s.()\-]/g, "_").trim();

      // For credit sales, resolve customer name for the filename
      let customerNameForFile2: string | null = null;
      if (voucher.isCreditSale) {
        const [custEntry2] = await db
          .select({ name: ledgerAccounts.name })
          .from(voucherEntries)
          .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, voucherEntries.ledgerAccountId))
          .where(and(
            eq(voucherEntries.voucherId, voucher.id),
            sql`${voucherEntries.debitAmount}::numeric > 0`,
          ))
          .limit(1);
        customerNameForFile2 = custEntry2?.name || null;
      }

      const rawFileName2 = customerNameForFile2
        ? `${customerNameForFile2} Invoice ${safeLoc} ${safeDate}`
        : `${safeLoc} Invoice ${safeDate}`;
      const fileName  = rawFileName2.replace(/[^\w\s.()\-]/g, "_").replace(/\s+/g, " ").trim() + ".pdf";
      const caption   = "";

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
