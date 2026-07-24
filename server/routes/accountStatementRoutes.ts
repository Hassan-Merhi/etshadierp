/**
 * Account statement & detail routes.
 *
 * Deleted-voucher listings, pre-period opening balances, statement PDF
 * rendering, and statement Excel export for a specific account. Extracted
 * from accountRoutes.ts as a sub-registrar; behaviour is unchanged.
 */
import type { Express } from "express";
import { logger } from "../lib/logger";
import path from "path";
import fs from "fs";
import { eq, and, desc, isNull, isNotNull, sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth } from "../auth";
import { isParentCompanyContext } from "./helpers/supplierBalanceHelpers";
import {
  bankAccounts,
  companies,
  customerBalances,
  customerOrders,
  customers,
  employees,
  fixedAssets,
  ledgerAccounts,
  suppliers,
  voucherEntries,
  vouchers,
} from "@shared/schema";

export function registerAccountStatementRoutes(app: Express) {
  // Get deleted (soft-deleted) vouchers for a specific account — used by the Accounts page
  // to show recoverable vouchers directly in the ledger view.
  app.get("/api/accounts/:type/:id/deleted-vouchers", requireAuth, async (req, res) => {
    try {
      const accountType = req.params.type;
      const accountId = parseInt(req.params.id);
      const companyId = req.session.currentCompanyId;

      if (isNaN(accountId)) return res.status(400).json({ message: "Invalid ID" });
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // Build the account-specific filter on voucherEntries
      let entryFilter: any;
      switch (accountType) {
        case "ledger":
          entryFilter = eq(voucherEntries.ledgerAccountId, accountId);
          break;
        case "bank":
          entryFilter = eq(voucherEntries.bankAccountId, accountId);
          break;
        case "fixed-asset":
          entryFilter = eq(voucherEntries.fixedAssetId, accountId);
          break;
        case "supplier":
          entryFilter = eq(voucherEntries.supplierId, accountId);
          break;
        case "employee":
          entryFilter = eq(voucherEntries.employeeId, accountId);
          break;
        case "customer":
          entryFilter = eq(voucherEntries.customerId, accountId);
          break;
        default:
          return res.json([]);
      }

      const results = await db
        .selectDistinct({
          id: vouchers.id,
          voucherNumber: vouchers.voucherNumber,
          voucherType: vouchers.voucherType,
          voucherDate: vouchers.voucherDate,
          totalAmount: vouchers.totalAmount,
          description: vouchers.description,
          locationName: vouchers.locationName,
          deletedAt: vouchers.deletedAt,
        })
        .from(vouchers)
        .innerJoin(voucherEntries, eq(voucherEntries.voucherId, vouchers.id))
        .where(and(eq(vouchers.companyId, companyId), isNotNull(vouchers.deletedAt), entryFilter))
        .orderBy(desc(vouchers.deletedAt));

      res.json(results);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Compute the pre-period (opening) balance for any account type
  // endDate = last day BEFORE the current period start
  app.get("/api/accounts/:type/:id/pre-period-balance", requireAuth, async (req, res) => {
    try {
      const accountType = req.params.type;
      const accountId = parseInt(req.params.id);
      const { endDate } = req.query as { endDate?: string };
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      if (isNaN(accountId)) return res.status(400).json({ message: "Invalid account ID" });

      // Map type to the FK column name in voucher_entries
      const typeToColumn: Record<string, any> = {
        ledger: voucherEntries.ledgerAccountId,
        bank: voucherEntries.bankAccountId,
        "fixed-asset": voucherEntries.fixedAssetId,
        supplier: voucherEntries.supplierId,
        employee: voucherEntries.employeeId,
        customer: voucherEntries.customerId,
      };
      const entryColumn = typeToColumn[accountType];
      if (!entryColumn) return res.status(400).json({ message: "Unknown account type" });

      // Get initial opening balance from the account table
      let rawOB = 0;
      let obSide = "Dr";
      if (accountType === "ledger") {
        const [acct] = await db
          .select({ ob: ledgerAccounts.openingBalance, side: ledgerAccounts.openingBalanceSide })
          .from(ledgerAccounts)
          .where(eq(ledgerAccounts.id, accountId));
        // If this ledger account is linked to a customer, the customer's
        // opening balance is the authoritative source of truth.
        const [linkedCust] = await db
          .select({ id: customers.id, ob: customers.openingBalance, side: customers.openingBalanceSide })
          .from(customers)
          .where(eq(customers.ledgerAccountId, accountId))
          .limit(1);
        rawOB = parseFloat(linkedCust?.ob ?? acct?.ob ?? "0") || 0;
        obSide = linkedCust?.side ?? acct?.side ?? "Dr";

        // For factory customer-linked ledger accounts, use combined formula
        // (sales + customerBalances non-INVOICE + voucherEntries via both paths, all before endDate)
        if (linkedCust) {
          const currentCompany = await storage.getCompanyById(companyId);
          if (currentCompany?.companyType === "factory") {
            const custId = linkedCust.id;
            const dateFilter = endDate ? sql`${vouchers.voucherDate} < ${endDate}` : sql`1=1`;
            const orderDateFilter = endDate ? sql`${customerOrders.orderDate} < ${endDate}` : sql`1=1`;
            const cbDateFilter = endDate ? sql`${customerBalances.transactionDate} < ${endDate}` : sql`1=1`;

            const [salesRows, cbRows, lVRows, cVRows] = await Promise.all([
              db
                .select({
                  total: sql<string>`COALESCE(SUM(CAST(${customerOrders.grandTotal} AS numeric)), 0)`,
                })
                .from(customerOrders)
                .where(
                  and(
                    eq(customerOrders.customerId, custId),
                    eq(customerOrders.companyId, companyId),
                    eq(customerOrders.status, "FINALIZED"),
                    orderDateFilter
                  )
                ),

              db
                .select({
                  net: sql<string>`COALESCE(SUM(CAST(${customerBalances.debitAmount} AS numeric) - CAST(${customerBalances.creditAmount} AS numeric)), 0)`,
                })
                .from(customerBalances)
                .where(
                  and(
                    eq(customerBalances.customerId, custId),
                    eq(customerBalances.companyId, companyId),
                    sql`${customerBalances.referenceType} IS DISTINCT FROM 'INVOICE'`,
                    cbDateFilter
                  )
                ),

              db
                .select({
                  net: sql<string>`COALESCE(SUM(CAST(${voucherEntries.debitAmount} AS numeric) - CAST(${voucherEntries.creditAmount} AS numeric)), 0)`,
                })
                .from(voucherEntries)
                .leftJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
                .where(
                  and(
                    eq(voucherEntries.ledgerAccountId, accountId),
                    eq(vouchers.optional, false),
                    isNull(vouchers.deletedAt),
                    sql`${vouchers.voucherNumber} NOT LIKE 'CHARGE-%'`,
                    dateFilter
                  )
                ),

              db
                .select({
                  net: sql<string>`COALESCE(SUM(CAST(${voucherEntries.debitAmount} AS numeric) - CAST(${voucherEntries.creditAmount} AS numeric)), 0)`,
                })
                .from(voucherEntries)
                .leftJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
                .where(
                  and(
                    eq(voucherEntries.customerId, custId),
                    isNull(voucherEntries.ledgerAccountId),
                    eq(vouchers.optional, false),
                    isNull(vouchers.deletedAt),
                    sql`${vouchers.voucherNumber} NOT LIKE 'CHARGE-%'`,
                    dateFilter
                  )
                ),
            ]);

            const salesTotal = parseFloat(salesRows[0]?.total || "0");
            const nonInvNet = parseFloat(cbRows[0]?.net || "0");
            const vNet = parseFloat(lVRows[0]?.net || "0") + parseFloat(cVRows[0]?.net || "0");
            const ob = parseFloat(linkedCust.ob || "0");
            const side = linkedCust.side || "Dr";
            const prePeriodBalance = (side === "Dr" ? ob : -ob) + salesTotal + nonInvNet + vNet;
            return res.json({ balance: prePeriodBalance });
          }
        }
      } else if (accountType === "bank") {
        const [acct] = await db
          .select({ ob: bankAccounts.openingBalance, side: bankAccounts.openingBalanceSide })
          .from(bankAccounts)
          .where(eq(bankAccounts.id, accountId));
        rawOB = parseFloat(acct?.ob ?? "0") || 0;
        obSide = acct?.side ?? "Dr";
      } else if (accountType === "supplier") {
        // The supplier opening balance only belongs to the parent company's
        // books — never guess this via "lowest company ID".
        const isParentForSupplier = await isParentCompanyContext(companyId);
        if (isParentForSupplier) {
          const [acct] = await db
            .select({ ob: suppliers.openingBalance })
            .from(suppliers)
            .where(eq(suppliers.id, accountId));
          rawOB = parseFloat(acct?.ob ?? "0") || 0;
        } else {
          rawOB = 0;
        }
        obSide = "Cr";
      } else if (accountType === "employee") {
        const [acct] = await db
          .select({ ob: employees.openingBalance })
          .from(employees)
          .where(eq(employees.id, accountId));
        rawOB = parseFloat(acct?.ob ?? "0") || 0;
        obSide = "Cr";
      } else if (accountType === "customer") {
        const [acct] = await db
          .select({ ob: customers.openingBalance })
          .from(customers)
          .where(eq(customers.id, accountId));
        rawOB = parseFloat(acct?.ob ?? "0") || 0;
        obSide = "Dr";
      } else if (accountType === "fixed-asset") {
        const [acct] = await db
          .select({ ob: fixedAssets.openingBalance })
          .from(fixedAssets)
          .where(eq(fixedAssets.id, accountId));
        rawOB = parseFloat(acct?.ob ?? "0") || 0;
        obSide = "Dr";
      }

      // Signed initial opening balance
      // Supplier: positive rawOB is treated as Cr (they're owed money)
      // Others: Cr side means negative in Dr-positive convention
      const isSupplier = accountType === "supplier";
      let balance = isSupplier ? rawOB : obSide === "Cr" ? -rawOB : rawOB;

      // Sum all voucher entries before endDate (exclusive of period start)
      if (endDate) {
        const conditions: any[] = [
          eq(entryColumn, accountId),
          eq(vouchers.optional, false),
          isNull(vouchers.deletedAt),
          sql`${vouchers.voucherDate} < ${endDate}`,
        ];
        // Suppliers are shared across companies — scope strictly to this
        // company's own vouchers or the pre-period balance would silently
        // include every other company's history for the same supplier.
        if (isSupplier) {
          conditions.push(eq(vouchers.companyId, companyId));
        }
        const [totals] = await db
          .select({
            totalDebit: sql<string>`COALESCE(SUM(${voucherEntries.debitAmount}), 0)`,
            totalCredit: sql<string>`COALESCE(SUM(${voucherEntries.creditAmount}), 0)`,
          })
          .from(voucherEntries)
          .leftJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
          .where(and(...conditions));

        const sumDebit = parseFloat(totals?.totalDebit ?? "0") || 0;
        const sumCredit = parseFloat(totals?.totalCredit ?? "0") || 0;
        if (isSupplier) {
          balance += sumCredit - sumDebit;
        } else {
          balance += sumDebit - sumCredit;
        }
      }

      res.json({ balance });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Account Statement PDF export ──────────────────────────────────────────
  app.get("/api/accounts/:type/:id/statement-pdf", requireAuth, async (req: any, res: any) => {
    try {
      const accountType = req.params.type;
      const accountId = parseInt(req.params.id);
      const companyId = (req.session as any).currentCompanyId;
      const { startDate, endDate, lang = "en" } = req.query as { startDate?: string; endDate?: string; lang?: string };

      if (!companyId) return res.status(400).json({ message: "No company selected" });
      if (isNaN(accountId)) return res.status(400).json({ message: "Invalid account ID" });

      const { generateAccountStatementPdf } = await import("../lib/accountStatementPdfGenerator");
      const pdfBuf = await generateAccountStatementPdf({ accountType, accountId, companyId, startDate, endDate, lang });

      // Resolve human-readable account name for the filename
      let resolvedName = `${accountType}_${accountId}`;
      try {
        if (accountType === "ledger") {
          const [r] = await db
            .select({ name: ledgerAccounts.name })
            .from(ledgerAccounts)
            .where(eq(ledgerAccounts.id, accountId));
          resolvedName = r?.name ?? resolvedName;
        } else if (accountType === "bank") {
          const [r] = await db
            .select({ name: bankAccounts.name })
            .from(bankAccounts)
            .where(eq(bankAccounts.id, accountId));
          resolvedName = r?.name ?? resolvedName;
        } else if (accountType === "fixed-asset") {
          const [r] = await db
            .select({ name: fixedAssets.name })
            .from(fixedAssets)
            .where(eq(fixedAssets.id, accountId));
          resolvedName = r?.name ?? resolvedName;
        } else if (accountType === "supplier") {
          const [r] = await db.select({ name: suppliers.legalName }).from(suppliers).where(eq(suppliers.id, accountId));
          resolvedName = r?.name ?? resolvedName;
        } else if (accountType === "customer") {
          const [r] = await db
            .select({ name: customers.legalName })
            .from(customers)
            .where(eq(customers.id, accountId));
          resolvedName = r?.name ?? resolvedName;
        } else if (accountType === "employee") {
          const [r] = await db
            .select({ firstName: employees.firstName, lastName: employees.lastName })
            .from(employees)
            .where(eq(employees.id, accountId));
          if (r) resolvedName = `${r.firstName} ${r.lastName}`.trim();
        }
      } catch {}
      const safeAccName = resolvedName.replace(/[^\w\s.()\-]/g, "_").replace(/\s+/g, "_");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=statement_${safeAccName}.pdf`);
      res.end(pdfBuf);
      return;

      // Legacy code below is unreachable — kept for reference only
    } catch (err: any) {
      logger.error("Statement PDF error:", { error: err });
      if (!res.headersSent) res.status(500).json({ message: err.message });
    }
  });

  // ── Ledger / Account Statement — Excel export ────────────────────────────
  app.get("/api/accounts/statement/export-excel", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId as number;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const accountType = (req.query.accountType as string) || "ledger";
      const accountId = parseInt(req.query.accountId as string);
      if (isNaN(accountId)) return res.status(400).json({ message: "Invalid accountId" });
      const startDate = (req.query.startDate as string) || undefined;
      const endDate = (req.query.endDate as string) || undefined;

      // Resolve account name and opening balance
      let accountName = "Account";
      let openingBalance = 0;
      let openingBalanceSide = "Dr";

      const [company] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, companyId));

      if (accountType === "ledger") {
        const [acct] = await db
          .select({ name: ledgerAccounts.name, openingBalance: ledgerAccounts.openingBalance, openingBalanceSide: ledgerAccounts.openingBalanceSide })
          .from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.id, accountId), eq(ledgerAccounts.companyId, companyId)));
        if (!acct) return res.status(404).json({ message: "Account not found" });
        accountName = acct.name;
        openingBalance = parseFloat(acct.openingBalance || "0");
        openingBalanceSide = (acct as any).openingBalanceSide || "Dr";
      } else if (accountType === "bank") {
        const [acct] = await db
          .select({ name: bankAccounts.name })
          .from(bankAccounts)
          .where(and(eq(bankAccounts.id, accountId), eq(bankAccounts.companyId, companyId)));
        if (!acct) return res.status(404).json({ message: "Bank account not found" });
        accountName = acct.name;
      } else if (accountType === "supplier") {
        const [acct] = await db.select({ name: suppliers.legalName }).from(suppliers).where(eq(suppliers.id, accountId));
        if (!acct) return res.status(404).json({ message: "Supplier not found" });
        accountName = acct.name ?? "Supplier";
      } else if (accountType === "employee") {
        const [acct] = await db
          .select({ firstName: employees.firstName, lastName: employees.lastName })
          .from(employees)
          .where(and(eq(employees.id, accountId), eq(employees.companyId, companyId)));
        if (!acct) return res.status(404).json({ message: "Employee not found" });
        accountName = `${acct.firstName} ${acct.lastName}`.trim();
      }

      // Fetch transactions
      let txRows: any[] = [];
      if (accountType === "ledger") {
        txRows = await storage.getVoucherEntriesByLedger(accountId, startDate, endDate, companyId);
      } else if (accountType === "bank") {
        txRows = await storage.getVoucherEntriesByBankAccount(accountId, startDate, endDate);
      } else if (accountType === "supplier") {
        txRows = await storage.getVoucherEntriesBySupplier(accountId, companyId, startDate, endDate);
      } else if (accountType === "employee") {
        txRows = await storage.getVoucherEntriesByEmployee(accountId, companyId, startDate, endDate);
      }

      // Compute brought-forward balance (entries before startDate when filtering)
      let allTxForBF: any[] = [];
      if (startDate && accountType === "ledger") {
        allTxForBF = await storage.getVoucherEntriesByLedger(accountId, undefined, undefined, companyId);
      }
      let bfBalance = openingBalanceSide === "Dr" ? openingBalance : -openingBalance;
      if (startDate && allTxForBF.length > 0) {
        for (const r of allTxForBF) {
          const rDate = (r.voucherDate || "").toString().slice(0, 10);
          if (rDate < startDate) bfBalance += parseFloat(r.debitAmount || "0") - parseFloat(r.creditAmount || "0");
        }
      }

      // Build running balance rows
      let runBal = startDate ? bfBalance : (openingBalanceSide === "Dr" ? openingBalance : -openingBalance);
      const enrichedRows = txRows.map((r: any) => {
        const dr = parseFloat(r.debitAmount || "0");
        const cr = parseFloat(r.creditAmount || "0");
        runBal += dr - cr;
        return { ...r, dr, cr, runBal };
      });

      const totalDr = enrichedRows.reduce((s: number, r: any) => s + r.dr, 0);
      const totalCr = enrichedRows.reduce((s: number, r: any) => s + r.cr, 0);
      const closingRaw = runBal;
      const closingBalance2 = Math.abs(closingRaw);
      const closingBalanceSide2 = closingRaw >= 0 ? "Dr" : "Cr";

      const numFmt = "#,##0.00";
      const navyFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF1F3864" } };
      const lightBlueFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFEFF3FB" } };
      const greyFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF5F5F5" } };
      const allBorders = {
        top: { style: "thin" as const }, bottom: { style: "thin" as const },
        left: { style: "thin" as const }, right: { style: "thin" as const },
      };

      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Statement");

      sheet.columns = [
        { key: "date", width: 13 },
        { key: "voucher", width: 18 },
        { key: "particulars", width: 38 },
        { key: "dr", width: 16 },
        { key: "cr", width: 16 },
        { key: "balance", width: 18 },
      ];

      // Logo row
      try {
        const logoPath = path.join(process.cwd(), "server", "hmd-logo.png");
        if (fs.existsSync(logoPath)) {
          const logoBuf = fs.readFileSync(logoPath);
          const logoId = workbook.addImage({ buffer: logoBuf as Buffer, extension: "jpeg" });
          const logoRow = sheet.addRow([]);
          logoRow.height = 80;
          sheet.addImage(logoId, { tl: { col: 2.5, row: 0 }, ext: { width: 260, height: 80 } });
          sheet.mergeCells(`A1:F1`);
        }
      } catch {}

      // Header block
      const rComp = sheet.addRow([company?.name || "Company"]);
      rComp.getCell(1).font = { bold: true, size: 14, color: { argb: "FF1F3864" } };
      sheet.mergeCells(`A${rComp.number}:F${rComp.number}`);

      const rTitle = sheet.addRow(["Account Statement"]);
      rTitle.getCell(1).font = { bold: true, size: 11 };
      sheet.mergeCells(`A${rTitle.number}:F${rTitle.number}`);

      const rAcct = sheet.addRow([`Account: ${accountName}   |   Type: ${accountType.charAt(0).toUpperCase() + accountType.slice(1)}`]);
      sheet.mergeCells(`A${rAcct.number}:F${rAcct.number}`);

      if (openingBalance !== 0 && accountType === "ledger") {
        const rOb = sheet.addRow([`Opening Balance: ${openingBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${openingBalanceSide}`]);
        sheet.mergeCells(`A${rOb.number}:F${rOb.number}`);
      }

      if (startDate || endDate) {
        const rPeriod = sheet.addRow([`Period: ${startDate || "Start"} to ${endDate || "End"}`]);
        rPeriod.getCell(1).font = { italic: true, color: { argb: "FF555555" } };
        sheet.mergeCells(`A${rPeriod.number}:F${rPeriod.number}`);
      }

      const rPrinted = sheet.addRow([`Printed: ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`]);
      sheet.mergeCells(`A${rPrinted.number}:F${rPrinted.number}`);
      sheet.addRow([]);

      // Column headers
      const hdr = sheet.addRow(["Date", "Voucher No.", "Particulars", "Debit (Dr)", "Credit (Cr)", "Balance"]);
      hdr.eachCell((cell) => {
        cell.fill = navyFill;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.border = allBorders;
        cell.alignment = { horizontal: "center" };
      });

      // Opening balance row (no filter) or B/F row (filtered)
      if (!startDate && openingBalance > 0 && accountType === "ledger") {
        const obBal = openingBalanceSide === "Dr" ? openingBalance : -openingBalance;
        const obRow = sheet.addRow([
          new Date().toLocaleDateString("en-GB"),
          "—",
          "Opening Balance",
          openingBalanceSide === "Dr" ? openingBalance : null,
          openingBalanceSide === "Cr" ? openingBalance : null,
          `${openingBalance.toFixed(2)} ${openingBalanceSide}`,
        ]);
        obRow.eachCell((cell) => { cell.fill = lightBlueFill; cell.border = allBorders; });
        obRow.getCell(4).numFmt = numFmt; obRow.getCell(5).numFmt = numFmt;
        obRow.getCell(4).alignment = { horizontal: "right" }; obRow.getCell(5).alignment = { horizontal: "right" };
        obRow.getCell(6).alignment = { horizontal: "right" };
      } else if (startDate && Math.abs(bfBalance) > 0.005 && accountType === "ledger") {
        const bfAbs = Math.abs(bfBalance);
        const bfSide = bfBalance >= 0 ? "Dr" : "Cr";
        const bfRow = sheet.addRow([
          new Date(startDate + "T00:00:00"),
          "—",
          "Balance Brought Forward",
          bfSide === "Dr" ? bfAbs : null,
          bfSide === "Cr" ? bfAbs : null,
          `${bfAbs.toFixed(2)} ${bfSide}`,
        ]);
        bfRow.eachCell((cell) => { cell.fill = lightBlueFill; cell.font = { bold: true }; cell.border = allBorders; });
        bfRow.getCell(1).numFmt = "dd/mm/yyyy";
        bfRow.getCell(4).numFmt = numFmt; bfRow.getCell(5).numFmt = numFmt;
        bfRow.getCell(4).alignment = { horizontal: "right" }; bfRow.getCell(5).alignment = { horizontal: "right" };
        bfRow.getCell(6).alignment = { horizontal: "right" };
      }

      // Data rows
      enrichedRows.forEach((row: any, idx: number) => {
        const dr = row.dr > 0 ? row.dr : null;
        const cr = row.cr > 0 ? row.cr : null;
        const dateVal = row.voucherDate ? new Date(row.voucherDate + "T00:00:00") : "";
        const particulars = row.narration || row.voucherDescription || row.voucherType || "—";
        const balAbs = Math.abs(row.runBal);
        const balSide = row.runBal >= 0 ? "Dr" : "Cr";
        const dataRow = sheet.addRow([
          dateVal,
          row.voucherNumber || "—",
          particulars,
          dr,
          cr,
          balAbs > 0 ? `${balAbs.toFixed(2)} ${balSide}` : "—",
        ]);
        dataRow.eachCell((cell) => { cell.border = allBorders; });
        if (idx % 2 === 0) dataRow.eachCell((cell) => { cell.fill = greyFill; });
        dataRow.getCell(1).numFmt = "dd/mm/yyyy";
        dataRow.getCell(4).numFmt = numFmt; dataRow.getCell(5).numFmt = numFmt;
        dataRow.getCell(4).alignment = { horizontal: "right" }; dataRow.getCell(5).alignment = { horizontal: "right" };
        dataRow.getCell(6).alignment = { horizontal: "right" };
      });

      // Totals row
      const totRow = sheet.addRow(["", "", "TOTAL", totalDr, totalCr, ""]);
      totRow.eachCell((cell) => { cell.fill = navyFill; cell.font = { bold: true, color: { argb: "FFFFFFFF" } }; cell.border = allBorders; });
      totRow.getCell(4).numFmt = numFmt; totRow.getCell(5).numFmt = numFmt;
      totRow.getCell(4).alignment = { horizontal: "right" }; totRow.getCell(5).alignment = { horizontal: "right" };

      // Closing balance row
      const cbRow = sheet.addRow([
        "", "", "Closing Balance",
        closingBalanceSide2 === "Dr" ? closingBalance2 : null,
        closingBalanceSide2 === "Cr" ? closingBalance2 : null,
        `${closingBalance2.toFixed(2)} ${closingBalanceSide2}`,
      ]);
      cbRow.eachCell((cell) => { cell.fill = lightBlueFill; cell.font = { bold: true }; cell.border = allBorders; });
      cbRow.getCell(4).numFmt = numFmt; cbRow.getCell(5).numFmt = numFmt;
      cbRow.getCell(4).alignment = { horizontal: "right" }; cbRow.getCell(5).alignment = { horizontal: "right" };
      cbRow.getCell(6).alignment = { horizontal: "right" };

      const safeAccName = accountName.replace(/[^\w\s.()\-]/g, "_").replace(/\s+/g, "_");
      const buf = Buffer.from(await workbook.xlsx.writeBuffer());
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${safeAccName}_Statement.xlsx"`);
      res.end(buf);
    } catch (err: any) {
      logger.error("Account statement Excel error:", { error: err });
      if (!res.headersSent) res.status(500).json({ message: err.message });
    }
  });
}
