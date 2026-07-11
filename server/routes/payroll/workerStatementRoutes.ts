import { parseId, parseOptionalId } from "../../lib/parseId";
import { getClientDate } from "../../lib/dateUtils";
import type { Express } from "express";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { eq, and, desc, sql, ilike, gte, lte, inArray, isNotNull, isNull } from "drizzle-orm";
import multer from "multer";
import path from "path";
import fs from "fs";
import XLSX from "xlsx";
import ExcelJS from "exceljs";
import {
  factoryWorkers,
  insertFactoryWorkerSchema,
  factoryDaybookEntries,
  factoryBales,
  factoryPayrolls,
  factoryWorkerDocuments,
  factoryWorkerAdvances,
  factoryAdvanceRepayments,
  factoryWorkerDeductions,
  factoryAttendance,
  ledgerAccounts,
  bankAccounts,
  vouchers,
  voucherEntries,
  companies,
  companySettings,
} from "@shared/schema";

/** Prefer the factory-pinned company ID so cross-tab ERP company switches don't corrupt factory writes. */
function getFactoryCompanyId(req: any): number | undefined {
  return (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
}

/** Write a single daybook entry (factory audit log). */
async function writeDaybookEntry(
  dbOrTx: any,
  opts: {
    companyId: number;
    txDate: string;
    txType: string;
    referenceId?: number;
    referenceTable?: string;
    description: string;
    metaJson?: string;
    currencyCode?: string;
    amountCurrency?: number;
    fxRateToUsd?: number;
    amountUsd?: number;
    createdBy?: number;
  }
) {
  const currency = opts.currencyCode || "USD";
  const fxRate = opts.fxRateToUsd || 1;
  const amtCurrency = opts.amountCurrency || 0;
  const amtUsd =
    opts.amountUsd !== undefined ? opts.amountUsd : currency === "USD" ? amtCurrency : amtCurrency * fxRate;
  await dbOrTx.insert(factoryDaybookEntries).values({
    companyId: opts.companyId,
    txDate: opts.txDate,
    txType: opts.txType,
    referenceId: opts.referenceId || null,
    referenceTable: opts.referenceTable || null,
    description: opts.description,
    metaJson: opts.metaJson || null,
    currencyCode: currency,
    amountCurrency: String(amtCurrency),
    fxRateToUsd: String(fxRate),
    amountUsd: String(amtUsd),
    createdBy: opts.createdBy || null,
  });
}

/** Find or create a ledger account by name for a company. Returns the account row.
 *  Skips soft-deleted accounts and handles race-condition unique-constraint failures. */
async function findOrCreateLedger(companyId: number, name: string, accountType: string): Promise<{ id: number }> {
  const [existing] = await db
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.name, name), isNull(ledgerAccounts.deletedAt)));
  if (existing) return existing;

  for (let attempt = 0; attempt < 5; attempt++) {
    const [maxCodeRow] = await db
      .select({ maxCode: sql`MAX(CAST(code AS INTEGER))` })
      .from(ledgerAccounts)
      .where(and(eq(ledgerAccounts.companyId, companyId), sql`code ~ '^\\d+$'`));
    const nextCode = String((parseInt((maxCodeRow as any)?.maxCode || "0") || 0) + 1 + attempt);
    try {
      const [created] = await db
        .insert(ledgerAccounts)
        .values({ companyId, code: nextCode, name, accountType, active: true, isHidden: false })
        .returning({ id: ledgerAccounts.id });
      return created;
    } catch (err: any) {
      if (err?.code === "23505" || err?.message?.includes("unique")) {
        const [nowFound] = await db
          .select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.name, name), isNull(ledgerAccounts.deletedAt)));
        if (nowFound) return nowFound;
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Unable to create ledger account "${name}" after multiple attempts`);
}

const workerUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(process.cwd(), "uploads", "workers");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
});

function computeMonthlyPay(salary: number, startStr: string, endStr: string): number {
  const start = new Date(startStr + "T00:00:00");
  const end = new Date(endStr + "T00:00:00");
  let total = 0;
  let cur = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cur <= end) {
    const year = cur.getFullYear();
    const month = cur.getMonth();
    const monthLastDay = new Date(year, month + 1, 0);
    const daysInThisMonth = monthLastDay.getDate();
    const segStart = new Date(Math.max(cur.getTime(), start.getTime()));
    const segEnd = new Date(Math.min(monthLastDay.getTime(), end.getTime()));
    const daysInSeg = Math.floor((segEnd.getTime() - segStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    total += salary * (daysInSeg / daysInThisMonth);
    cur = new Date(year, month + 1, 1);
  }
  return total;
}

// Helper: Compute monthly pay from actual attendance records.
// Monthly payroll uses attendance-based calculation (Present/Late = 1 day, Half Day = 0.5 day)
// rather than calendar-day proration to match actual work performed.
function computeMonthlyPayFromAttendance(baseSalary: number, periodStart: string, attendanceRows: any[]): number {
  const daysInMonth = (dateStr: string) => {
    const d = new Date(dateStr);
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  };

  // Count actual days worked: Present/Late = 1 full day, Half Day = 0.5
  let attendedDays = 0;
  for (const row of attendanceRows) {
    const s = row.status || "Absent";
    if (s === "Present" || s === "Late") attendedDays += 1;
    else if (s === "Half Day") attendedDays += 0.5;
  }

  // Daily rate: salary / days in the month of periodStart
  const daysInStartMonth = daysInMonth(periodStart);
  const dailyRate = baseSalary / daysInStartMonth;
  return attendedDays * dailyRate;
}

export function registerWorkerStatementRoutes(app: Express) {
  app.delete("/api/factory/advance-repayments/:id", requireAuth, async (req: any, res: any) => {
    try {
      const currentRole = (req.session as any).currentRole;
      if (currentRole !== "Admin" && currentRole !== "Owner" && currentRole !== "Developer") {
        return res.status(403).json({ message: "Only Admin or Owner can delete repayments" });
      }
      const companyId = req.query.companyId ? parseOptionalId(req.query.companyId) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const repaymentId = parseId(req.params.id);
      if (repaymentId === null) return res.status(400).json({ message: "Invalid id" });

      const [repayment] = await db
        .select()
        .from(factoryAdvanceRepayments)
        .where(and(eq(factoryAdvanceRepayments.id, repaymentId), eq(factoryAdvanceRepayments.companyId, companyId)));
      if (!repayment) return res.status(404).json({ message: "Repayment not found" });

      const [advance] = await db
        .select()
        .from(factoryWorkerAdvances)
        .where(eq(factoryWorkerAdvances.id, repayment.advanceId));

      const repayAmt = parseFloat(repayment.amount || "0");
      const currentBal = parseFloat(advance?.remainingBalance || "0");
      const restoredBal = currentBal + repayAmt;

      await db.transaction(async (tx: any) => {
        await tx.delete(factoryAdvanceRepayments).where(eq(factoryAdvanceRepayments.id, repaymentId));

        if (advance) {
          await tx
            .update(factoryWorkerAdvances)
            .set({
              remainingBalance: restoredBal.toFixed(2),
              fullyPaid: false,
            })
            .where(eq(factoryWorkerAdvances.id, advance.id));
        }
      });

      const [worker] = await db
        .select({ fullName: factoryWorkers.fullName })
        .from(factoryWorkers)
        .where(eq(factoryWorkers.id, repayment.workerId));

      await writeDaybookEntry(db, {
        companyId,
        txDate: getClientDate(req),
        txType: "ADVANCE_REPAYMENT_DELETED",
        referenceId: repaymentId,
        referenceTable: "factory_advance_repayments",
        description: `Repayment deleted for ${worker?.fullName || "Worker"}: $${repayAmt.toFixed(2)} (advance #${repayment.advanceId})`,
        amountCurrency: repayAmt,
        currencyCode: "USD",
        amountUsd: repayAmt,
        createdBy: (req.session as any).userId ? parseInt((req.session as any).userId) : undefined,
      });

      res.json({ message: "Repayment deleted", restoredBalance: restoredBal.toFixed(2) });
    } catch (error: any) {
      console.error("Error deleting repayment:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/backfill-payroll-vouchers", requireAuth, async (req: any, res: any) => {
    try {
      const currentRole = (req.session as any).currentRole;
      if (currentRole !== "Admin" && currentRole !== "Owner" && currentRole !== "Developer") {
        return res.status(403).json({ message: "Only Admin or Owner can run backfill" });
      }

      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const paidPayrolls = await db
        .select({
          id: factoryPayrolls.id,
          companyId: factoryPayrolls.companyId,
          workerId: factoryPayrolls.workerId,
          netSalary: factoryPayrolls.netSalary,
          cashAccountId: factoryPayrolls.cashAccountId,
          periodStart: factoryPayrolls.periodStart,
          periodEnd: factoryPayrolls.periodEnd,
          paidAt: factoryPayrolls.paidAt,
        })
        .from(factoryPayrolls)
        .where(
          and(
            eq(factoryPayrolls.companyId, companyId),
            eq(factoryPayrolls.status, "PAID"),
            isNotNull(factoryPayrolls.cashAccountId)
          )
        );

      const existingVouchers = await db
        .select({
          voucherNumber: vouchers.voucherNumber,
        })
        .from(vouchers)
        .where(
          and(
            eq(vouchers.sourceModule, "FACTORY"),
            eq(vouchers.voucherType, "Payment"),
            sql`${vouchers.voucherNumber} LIKE 'PAYMENT-PAY-%'`
          )
        );

      const existingPayrollIds = new Set(
        existingVouchers
          .map((v: any) => {
            const parts = v.voucherNumber.split("-");
            return parseInt(parts[2]);
          })
          .filter((id: number) => !isNaN(id))
      );

      const toBackfill = paidPayrolls.filter((p: any) => {
        const net = parseFloat(p.netSalary || "0");
        return net > 0 && !existingPayrollIds.has(p.id);
      });

      const skipped = paidPayrolls
        .filter((p: any) => {
          const net = parseFloat(p.netSalary || "0");
          return net <= 0 || existingPayrollIds.has(p.id);
        })
        .map((p: any) => p.id);

      if (toBackfill.length === 0) {
        return res.json({ message: "No payrolls need backfill", found: paidPayrolls.length, backfilled: 0, skipped });
      }

      const companyIds = [...new Set(toBackfill.map((p: any) => p.companyId))];
      const workerIds = [...new Set(toBackfill.map((p: any) => p.workerId))];

      const workerRows = await db
        .select({ id: factoryWorkers.id, fullName: factoryWorkers.fullName })
        .from(factoryWorkers)
        .where(inArray(factoryWorkers.id, workerIds));
      const workerMap = new Map(workerRows.map((w: any) => [w.id, w.fullName]));

      const backfilledIds: number[] = [];

      await db.transaction(async (tx: any) => {
        const payrollAccountCache = new Map<number, number>();

        for (const cid of companyIds) {
          let [found] = await tx
            .select({ id: ledgerAccounts.id })
            .from(ledgerAccounts)
            .where(and(eq(ledgerAccounts.companyId, cid), eq(ledgerAccounts.name, "Factory Worker Payroll")));

          if (!found) {
            const [maxCode] = await tx
              .select({ maxCode: sql`MAX(CAST(code AS INTEGER))` })
              .from(ledgerAccounts)
              .where(and(eq(ledgerAccounts.companyId, cid), sql`code ~ '^\d+$'`));
            const nextCode = String((parseInt(maxCode?.maxCode || "0") || 0) + 1);
            [found] = await tx
              .insert(ledgerAccounts)
              .values({
                companyId: cid,
                code: nextCode,
                name: "Factory Worker Payroll",
                accountType: "Expense",
                active: true,
                isHidden: false,
              })
              .returning();
          }
          payrollAccountCache.set(cid, found.id);
        }

        for (const pr of toBackfill) {
          const netAmt = parseFloat(pr.netSalary || "0");
          const cashAcctId = pr.cashAccountId!;
          const payrollAcctId = payrollAccountCache.get(pr.companyId)!;
          const workerName = ((workerMap.get(pr.workerId) as string) || "").trim() || `Worker #${pr.workerId}`;
          const narration = `Payroll backfill: ${workerName} (${pr.periodStart} – ${pr.periodEnd})`;
          const voucherDate = pr.paidAt ? new Date(pr.paidAt).toISOString().split("T")[0] : getClientDate(req);

          const [pVoucher] = await tx
            .insert(vouchers)
            .values({
              companyId: pr.companyId,
              voucherNumber: `PAYMENT-PAY-${pr.id}-${Date.now()}`,
              voucherType: "Payment",
              voucherDate,
              description: narration,
              totalAmount: netAmt.toFixed(2),
              currency: "USD",
              sourceModule: "FACTORY",
            })
            .returning();

          await tx.insert(voucherEntries).values([
            {
              voucherId: pVoucher.id,
              ledgerAccountId: payrollAcctId,
              debitAmount: netAmt.toFixed(2),
              creditAmount: "0",
              narration,
            },
            {
              voucherId: pVoucher.id,
              ledgerAccountId: cashAcctId,
              debitAmount: "0",
              creditAmount: netAmt.toFixed(2),
              narration,
            },
          ]);

          backfilledIds.push(pr.id);
        }
      });

      res.json({
        message: `Backfilled ${backfilledIds.length} payroll(s)`,
        found: paidPayrolls.length,
        backfilled: backfilledIds.length,
        backfilledPayrollIds: backfilledIds,
        skippedPayrollIds: skipped,
      });
    } catch (error: any) {
      console.error("Error backfilling payroll vouchers:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/workers/:id/statement", requireAuth, async (req: any, res: any) => {
    try {
      const workerId = parseId(req.params.id);
      if (workerId === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(workerId)) return res.status(400).json({ message: "Invalid worker ID" });

      const companyId = getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { startDate, endDate } = req.query;

      const advanceConditions: any[] = [
        eq(factoryWorkerAdvances.workerId, workerId),
        eq(factoryWorkerAdvances.companyId, companyId),
      ];
      if (startDate) advanceConditions.push(sql`${factoryWorkerAdvances.advanceDate} >= ${startDate}`);
      if (endDate) advanceConditions.push(sql`${factoryWorkerAdvances.advanceDate} <= ${endDate}`);

      const advances = await db
        .select()
        .from(factoryWorkerAdvances)
        .where(and(...advanceConditions))
        .orderBy(factoryWorkerAdvances.advanceDate);

      const payrollConditions: any[] = [
        eq(factoryPayrolls.workerId, workerId),
        eq(factoryPayrolls.companyId, companyId),
        eq(factoryPayrolls.status, "PAID"),
      ];
      if (startDate) payrollConditions.push(sql`${factoryPayrolls.paidAt}::date >= ${startDate}`);
      if (endDate) payrollConditions.push(sql`${factoryPayrolls.paidAt}::date <= ${endDate}`);

      const payrolls = await db
        .select()
        .from(factoryPayrolls)
        .where(and(...payrollConditions))
        .orderBy(factoryPayrolls.paidAt);

      const entries: any[] = [];

      for (const adv of advances) {
        entries.push({
          entryId: adv.id,
          voucherId: adv.id,
          date: adv.advanceDate,
          debitAmount: adv.amount,
          creditAmount: "0",
          narration: adv.notes || "Advance payment",
          voucherNumber: `ADV-${adv.id}`,
          voucherType: "Advance",
          voucherDate: adv.advanceDate,
          voucherDescription: adv.notes || "Advance payment",
          currency: "USD",
        });
      }

      for (const pr of payrolls) {
        const paidDate = pr.paidAt ? new Date(pr.paidAt).toISOString().split("T")[0] : pr.periodEnd;
        entries.push({
          entryId: 100000 + pr.id,
          voucherId: 100000 + pr.id,
          date: paidDate,
          debitAmount: "0",
          creditAmount: pr.netSalary || "0",
          narration: `Payroll ${pr.periodStart} to ${pr.periodEnd}`,
          voucherNumber: `PAY-${pr.id}`,
          voucherType: "Payroll",
          voucherDate: paidDate,
          voucherDescription: `Payroll ${pr.periodStart} to ${pr.periodEnd}`,
          currency: "USD",
        });
      }

      entries.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

      let runningBalance = 0;
      for (const entry of entries) {
        runningBalance += parseFloat(entry.debitAmount || "0") - parseFloat(entry.creditAmount || "0");
        entry.runningBalance = runningBalance;
      }

      res.json(entries);
    } catch (error: any) {
      console.error("Error fetching factory worker statement:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Factory Worker Statement PDF ──────────────────────────────────────────
  app.get("/api/factory/workers/:id/statement-pdf", requireAuth, async (req: any, res: any) => {
    try {
      const workerId = parseId(req.params.id);
      if (workerId === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(workerId)) return res.status(400).json({ message: "Invalid worker ID" });
      const companyId = getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };

      // Worker info
      const [worker] = await db
        .select()
        .from(factoryWorkers)
        .where(and(eq(factoryWorkers.id, workerId), eq(factoryWorkers.companyId, companyId)));
      if (!worker) return res.status(404).json({ message: "Worker not found" });
      const workerName = worker.fullName || `Worker #${workerId}`;

      // Advances
      const advConds: any[] = [
        eq(factoryWorkerAdvances.workerId, workerId),
        eq(factoryWorkerAdvances.companyId, companyId),
      ];
      if (startDate) advConds.push(sql`${factoryWorkerAdvances.advanceDate} >= ${startDate}`);
      if (endDate) advConds.push(sql`${factoryWorkerAdvances.advanceDate} <= ${endDate}`);
      const advances = await db
        .select()
        .from(factoryWorkerAdvances)
        .where(and(...advConds))
        .orderBy(factoryWorkerAdvances.advanceDate);

      // Payrolls
      const payConds: any[] = [
        eq(factoryPayrolls.workerId, workerId),
        eq(factoryPayrolls.companyId, companyId),
        eq(factoryPayrolls.status, "PAID"),
      ];
      if (startDate) payConds.push(sql`${factoryPayrolls.paidAt}::date >= ${startDate}`);
      if (endDate) payConds.push(sql`${factoryPayrolls.paidAt}::date <= ${endDate}`);
      const payrolls = await db
        .select()
        .from(factoryPayrolls)
        .where(and(...payConds))
        .orderBy(factoryPayrolls.paidAt);

      // Build entries
      const entries: any[] = [];
      for (const adv of advances) {
        entries.push({
          date: adv.advanceDate,
          type: "Advance",
          description: adv.notes || "Advance payment",
          debit: parseFloat(adv.amount || "0"),
          credit: 0,
        });
      }
      for (const pr of payrolls) {
        const paidDate = pr.paidAt ? new Date(pr.paidAt).toISOString().split("T")[0] : pr.periodEnd;
        entries.push({
          date: paidDate,
          type: "Payroll",
          description: `Payroll ${pr.periodStart} to ${pr.periodEnd}`,
          debit: 0,
          credit: parseFloat(pr.netSalary || "0"),
        });
      }
      entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      let running = 0;
      const rowsWithBalance = entries.map((e) => {
        running += e.debit - e.credit;
        return { ...e, runningBalance: running };
      });

      // Company info
      const [co] = await db.select().from(companies).where(eq(companies.id, companyId));
      const [sett] = await db
        .select()
        .from(companySettings)
        .where(eq(companySettings.companyId, companyId))
        .catch(() => [null]);
      const companyName = (co as any)?.name ?? "Company";
      const logoUrl: string | null = (sett as any)?.logoUrl ?? null;
      const baseCurrency = (co as any)?.baseCurrency ?? "USD";
      const currMap: Record<string, string> = { USD: "$ ", GBP: "£", EUR: "€", CFA: "CFA ", AED: "AED " };
      const sym = currMap[baseCurrency.toUpperCase()] ?? baseCurrency + " ";
      const fmtAmt = (n: number) =>
        sym +
        Math.abs(n)
          .toFixed(2)
          .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      const fmtDate = (s: string) =>
        new Date(s.split("T")[0] + "T00:00:00").toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        });
      const periodStr =
        startDate && endDate
          ? `${fmtDate(startDate)} — ${fmtDate(endDate)}`
          : startDate
            ? `From ${fmtDate(startDate)}`
            : endDate
              ? `Up to ${fmtDate(endDate)}`
              : "All Time";
      const generatedStr = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

      const PDFDocument = (await import("pdfkit")).default;
      const pathMod = await import("path");

      // Arabic font setup — always register so Arabic names render correctly
      const fontDir = pathMod.join(process.cwd(), "server", "fonts");
      const arabicFontPath = pathMod.join(fontDir, "Amiri-Regular.ttf");
      const hasArabicFont = fs.existsSync(arabicFontPath);

      const doc = new PDFDocument({ margin: 40, size: "A4" });
      if (hasArabicFont) doc.registerFont("Arabic", arabicFontPath);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=statement_${workerName.replace(/\s+/g, "_")}.pdf`);
      doc.pipe(res);

      // Arabic reshaping helpers — always loaded
      let wConvertArabic: ((t: string) => string) | null = null;
      let wBidiInst: {
        getEmbeddingLevels: (t: string, d: string) => any;
        getReorderedString: (t: string, l: any) => string;
      } | null = null;
      try {
        const reshaperMod = require("arabic-reshaper") as { convertArabic: (t: string) => string };
        wConvertArabic = reshaperMod.convertArabic;
        const bidiFactory = require("bidi-js") as () => typeof wBidiInst;
        wBidiInst = (bidiFactory as any)();
      } catch {}

      const wContainsArabic = (text: string) => /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
      const wShapeText = (text: string): string => {
        if (!text || !wConvertArabic) return text;
        try {
          const reshaped = wConvertArabic(text);
          if (wBidiInst) {
            const levels = wBidiInst.getEmbeddingLevels(reshaped, "rtl");
            return wBidiInst.getReorderedString(reshaped, levels);
          }
          return reshaped;
        } catch {
          return text;
        }
      };

      // Render text with automatic Arabic font switching per cell
      const wRenderText = (text: string, x: number, yPos: number, w: number, align: "left" | "right") => {
        const hasAr = hasArabicFont && wContainsArabic(text);
        doc
          .font(hasAr ? "Arabic" : "Helvetica")
          .fontSize(7.5)
          .text(hasAr ? wShapeText(text) : text, x, yPos, { width: w, align: hasAr ? "right" : align });
      };

      // Header
      const wHmdLogoPath = path.join(process.cwd(), "server", "hmd-logo.png");
      if (fs.existsSync(wHmdLogoPath)) {
        try {
          doc.image(wHmdLogoPath, (doc.page.width - 220) / 2, 20, { width: 220 });
        } catch {}
      }
      const wNameHasAr = hasArabicFont && wContainsArabic(workerName);
      doc
        .fontSize(10)
        .font(wNameHasAr ? "Arabic" : "Helvetica")
        .fillColor("#555555")
        .text(wNameHasAr ? `كشف حساب: ${wShapeText(workerName)}` : `Account Statement: ${workerName}`, 40, 102, {
          width: 515,
          align: wNameHasAr ? "right" : "center",
        });

      const headerBottom = 110;
      doc
        .moveTo(40, headerBottom + 4)
        .lineTo(555, headerBottom + 4)
        .lineWidth(0.5)
        .strokeColor("#cccccc")
        .stroke();
      doc.lineWidth(1).strokeColor("#000000");

      const metaY = headerBottom + 10;
      doc.fillColor("#444444").fontSize(8).font("Helvetica");
      doc.text(`Period: ${periodStr}`, 40, metaY);
      doc.text(`Generated: ${generatedStr}`, 40, doc.y + 2);
      doc.moveDown(0.5);

      const PAGE_H = 841.89;
      const MARGIN_BOTTOM = 60;
      const colX = [40, 110, 205, 370, 435, 500];
      const colW = [70, 95, 165, 65, 65, 55];
      const colHdr = ["DATE", "TYPE", "PARTICULARS", "DEBIT", "CREDIT", "BALANCE"];
      const colAln: Array<"left" | "right"> = ["left", "left", "left", "right", "right", "right"];
      const ROW_H = 14;
      const HDR_H = 15;

      const drawHdr = (yh: number) => {
        doc.rect(40, yh, 515, HDR_H).fill("#1F3864");
        doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(7.5);
        colHdr.forEach((h, i) => doc.text(h, colX[i] + 2, yh + 3.5, { width: colW[i] - 4, align: colAln[i] }));
        doc.fillColor("#000000").font("Helvetica").fontSize(7.5);
      };

      const tableY = doc.y + 4;
      drawHdr(tableY);
      let y = tableY + HDR_H;

      // Opening row
      doc.rect(40, y, 515, ROW_H).fill("#F0F4FF");
      doc.fillColor("#000000").font("Helvetica").fontSize(7.5);
      doc.text("Opening Balance", colX[2] + 2, y + 3, { width: colW[2] - 4, align: "left" });
      doc.text("-", colX[3] + 2, y + 3, { width: colW[3] - 4, align: "right" });
      doc.text("-", colX[4] + 2, y + 3, { width: colW[4] - 4, align: "right" });
      doc.text(`${sym}0.00 Dr`, colX[5] + 2, y + 3, { width: colW[5] - 4, align: "right" });
      y += ROW_H;

      // Rows
      rowsWithBalance.forEach((row, idx) => {
        if (y + ROW_H > PAGE_H - MARGIN_BOTTOM) {
          doc.addPage();
          y = 40;
          drawHdr(y);
          y += HDR_H;
        }
        if (idx % 2 === 1) {
          doc.rect(40, y, 515, ROW_H).fill("#F8F8F8");
          doc.fillColor("#000000");
        }
        const bal = row.runningBalance;
        const balSide = bal >= 0 ? "Dr" : "Cr";
        wRenderText(fmtDate(row.date), colX[0] + 2, y + 3, colW[0] - 4, "left");
        wRenderText(row.type, colX[1] + 2, y + 3, colW[1] - 4, "left");
        wRenderText(row.description, colX[2] + 2, y + 3, colW[2] - 4, "left");
        doc.font("Helvetica").fontSize(7.5);
        doc.text(row.debit > 0 ? fmtAmt(row.debit) : "-", colX[3] + 2, y + 3, { width: colW[3] - 4, align: "right" });
        doc.text(row.credit > 0 ? fmtAmt(row.credit) : "-", colX[4] + 2, y + 3, { width: colW[4] - 4, align: "right" });
        doc.text(`${fmtAmt(bal)} ${balSide}`, colX[5] + 2, y + 3, { width: colW[5] - 4, align: "right" });
        y += ROW_H;
      });

      // Footer
      y += 3;
      doc.moveTo(40, y).lineTo(555, y).lineWidth(0.5).strokeColor("#888888").stroke();
      y += 5;
      const totD = rowsWithBalance.reduce((s, r) => s + r.debit, 0);
      const totC = rowsWithBalance.reduce((s, r) => s + r.credit, 0);
      const closing = rowsWithBalance.length > 0 ? rowsWithBalance[rowsWithBalance.length - 1].runningBalance : 0;
      const closingSide = closing >= 0 ? "Dr" : "Cr";

      if (y + 52 > PAGE_H - 20) {
        doc.addPage();
        y = 40;
      }
      doc.rect(40, y, 515, 16).fill("#EFF3FB");
      doc.fillColor("#000000").font("Helvetica").fontSize(8);
      doc.text("Current Period Total", colX[2] + 2, y + 4, { width: colW[2] - 4, align: "left" });
      doc.text(fmtAmt(totD), colX[3] + 2, y + 4, { width: colW[3] - 4, align: "right" });
      doc.text(fmtAmt(totC), colX[4] + 2, y + 4, { width: colW[4] - 4, align: "right" });
      y += 17;
      doc.rect(40, y, 515, 16).fill("#1F3864");
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8);
      doc.text("Closing Balance", colX[2] + 2, y + 4, { width: colW[2] - 4, align: "left" });
      doc.text(`${fmtAmt(closing)} ${closingSide}`, colX[5] + 2, y + 4, { width: colW[5] - 4, align: "right" });

      doc.end();
    } catch (err: any) {
      console.error("Worker statement PDF error:", err);
      if (!res.headersSent) res.status(500).json({ message: err.message });
    }
  });

  // DELETE /api/factory/workers/:id - Permanently delete a factory worker
  app.delete("/api/factory/workers/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(id)) return res.status(400).json({ message: "Invalid worker ID" });

      // Check if the worker has any bale entries
      const baleCheck = await db.execute(
        sql`SELECT COUNT(*) as cnt FROM factory_bales WHERE worker_id = ${id} AND company_id = ${companyId} AND status NOT IN ('REMOVED','DELETED')`
      );
      const baleCount = parseInt((baleCheck.rows[0] as any)?.cnt || "0");
      if (baleCount > 0) {
        return res.status(400).json({
          message: `Cannot delete: this worker has ${baleCount} bale entries. Remove all bale entries first.`,
        });
      }

      // Check for payroll entries
      const payrollCheck = await db.execute(
        sql`SELECT COUNT(*) as cnt FROM factory_payrolls WHERE worker_id = ${id} AND company_id = ${companyId}`
      );
      const payrollCount = parseInt((payrollCheck.rows[0] as any)?.cnt || "0");
      if (payrollCount > 0) {
        return res.status(400).json({ message: `Cannot delete: this worker has ${payrollCount} payroll record(s).` });
      }

      const [deleted] = await db
        .delete(factoryWorkers)
        .where(and(eq(factoryWorkers.id, id), eq(factoryWorkers.companyId, companyId)))
        .returning({ id: factoryWorkers.id });

      if (!deleted) return res.status(404).json({ message: "Worker not found" });
      res.json({ message: "Worker deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting factory worker:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/repair-orphaned-vouchers
  // Finds and deletes vouchers that were created for payroll/advance events that have
  // since been undone or deleted, leaving stale ledger entries (wrong cash balance etc).
  app.post("/api/factory/repair-orphaned-vouchers", requireAuth, async (req: any, res: any) => {
    try {
      const currentRole = (req.session as any).currentRole;
      if (!["Admin", "Owner", "Developer"].includes(currentRole)) {
        return res.status(403).json({ message: "Only Admin, Owner, or Developer can run ledger repair" });
      }
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      let deletedPayrollVouchers = 0;
      let deletedAdvanceVouchers = 0;

      await db.transaction(async (tx: any) => {
        // ── PAYMENT-PAY-{payrollId}-{ts} ────────────────────────────────────────
        // Should exist only when the referenced payroll is in PAID status.
        // If the payroll is DRAFT, APPROVED, or deleted → the voucher is orphaned.
        const payVouchers = await tx
          .select({ id: vouchers.id, voucherNumber: vouchers.voucherNumber })
          .from(vouchers)
          .where(and(eq(vouchers.companyId, companyId), sql`${vouchers.voucherNumber} LIKE 'PAYMENT-PAY-%'`));

        const orphanedPayVoucherIds: number[] = [];
        for (const v of payVouchers) {
          const parts = v.voucherNumber.split("-");
          const payrollId = parseInt(parts[2]);
          if (!payrollId || isNaN(payrollId)) {
            orphanedPayVoucherIds.push(v.id);
            continue;
          }
          const [payroll] = await tx
            .select({ status: factoryPayrolls.status })
            .from(factoryPayrolls)
            .where(and(eq(factoryPayrolls.id, payrollId), eq(factoryPayrolls.companyId, companyId)));
          if (!payroll || payroll.status !== "PAID") {
            orphanedPayVoucherIds.push(v.id);
          }
        }

        if (orphanedPayVoucherIds.length > 0) {
          await tx.delete(voucherEntries).where(inArray(voucherEntries.voucherId, orphanedPayVoucherIds));
          await tx.delete(vouchers).where(inArray(vouchers.id, orphanedPayVoucherIds));
          deletedPayrollVouchers = orphanedPayVoucherIds.length;
        }

        // ── PAYMENT-ADV-{advanceId}-{ts} ────────────────────────────────────────
        // Should exist only when the referenced advance still exists in the table.
        // If the advance was deleted → the voucher is orphaned.
        const advVouchers = await tx
          .select({ id: vouchers.id, voucherNumber: vouchers.voucherNumber })
          .from(vouchers)
          .where(and(eq(vouchers.companyId, companyId), sql`${vouchers.voucherNumber} LIKE 'PAYMENT-ADV-%'`));

        const orphanedAdvVoucherIds: number[] = [];
        for (const v of advVouchers) {
          const parts = v.voucherNumber.split("-");
          const advanceId = parseInt(parts[2]);
          if (!advanceId || isNaN(advanceId)) {
            orphanedAdvVoucherIds.push(v.id);
            continue;
          }
          const [advance] = await tx
            .select({ id: factoryWorkerAdvances.id })
            .from(factoryWorkerAdvances)
            .where(and(eq(factoryWorkerAdvances.id, advanceId), eq(factoryWorkerAdvances.companyId, companyId)));
          if (!advance) {
            orphanedAdvVoucherIds.push(v.id);
          }
        }

        if (orphanedAdvVoucherIds.length > 0) {
          await tx.delete(voucherEntries).where(inArray(voucherEntries.voucherId, orphanedAdvVoucherIds));
          await tx.delete(vouchers).where(inArray(vouchers.id, orphanedAdvVoucherIds));
          deletedAdvanceVouchers = orphanedAdvVoucherIds.length;
        }

        // ── REPAY-SAL-{repaymentId}-{ts} and RECEIPT-REPAY-{repaymentId}-{ts} ──
        // Orphaned when the repayment record was deleted (e.g. via Reverse Advance)
        // but the voucher was not removed. Clean them up now.
        let deletedRepayVouchers = 0;
        const repayVouchers = await tx
          .select({ id: vouchers.id, voucherNumber: vouchers.voucherNumber })
          .from(vouchers)
          .where(
            and(
              eq(vouchers.companyId, companyId),
              sql`(${vouchers.voucherNumber} LIKE 'REPAY-SAL-%' OR ${vouchers.voucherNumber} LIKE 'RECEIPT-REPAY-%')`
            )
          );

        const orphanedRepayVoucherIds: number[] = [];
        for (const v of repayVouchers) {
          const m = v.voucherNumber.match(/^(?:REPAY-SAL|RECEIPT-REPAY)-(\d+)-/);
          if (!m) {
            orphanedRepayVoucherIds.push(v.id);
            continue;
          }
          const repaymentId = parseInt(m[1]);
          const [repayment] = await tx
            .select({ id: factoryAdvanceRepayments.id })
            .from(factoryAdvanceRepayments)
            .where(eq(factoryAdvanceRepayments.id, repaymentId));
          if (!repayment) {
            orphanedRepayVoucherIds.push(v.id);
          }
        }

        if (orphanedRepayVoucherIds.length > 0) {
          await tx.delete(voucherEntries).where(inArray(voucherEntries.voucherId, orphanedRepayVoucherIds));
          await tx.delete(vouchers).where(inArray(vouchers.id, orphanedRepayVoucherIds));
          deletedRepayVouchers = orphanedRepayVoucherIds.length;
        }

        // ── PAYROLL-GEN-{ts} ────────────────────────────────────────────────
        // A PAYROLL-GEN voucher is orphaned when no factory_payrolls rows exist
        // for the same company + periodStart (voucherDate). This happens when all
        // payrolls in a batch are deleted/undone individually and the repair
        // utility is run afterward as a safety net.
        const genVouchers = await tx
          .select({ id: vouchers.id, voucherDate: vouchers.voucherDate, description: vouchers.description })
          .from(vouchers)
          .where(and(eq(vouchers.companyId, companyId), sql`${vouchers.voucherNumber} LIKE 'PAYROLL-GEN-%'`));

        const orphanedGenVoucherIds: number[] = [];
        for (const v of genVouchers) {
          // Parse periodEnd from description: "Payroll expense: N workers (YYYY-MM-DD – YYYY-MM-DD)"
          const periodMatch = (v.description as string | null)?.match(
            /\((\d{4}-\d{2}-\d{2})\s*[–-]\s*(\d{4}-\d{2}-\d{2})\)/
          );
          const periodStart = v.voucherDate as string;
          const periodEnd = periodMatch ? periodMatch[2] : null;

          const whereConditions: any[] = [
            eq(factoryPayrolls.companyId, companyId),
            eq(factoryPayrolls.periodStart, periodStart),
          ];
          if (periodEnd) whereConditions.push(eq(factoryPayrolls.periodEnd, periodEnd));

          const [payrollExists] = await tx
            .select({ id: factoryPayrolls.id })
            .from(factoryPayrolls)
            .where(and(...whereConditions))
            .limit(1);

          if (!payrollExists) {
            orphanedGenVoucherIds.push(v.id);
          }
        }

        let deletedGenVouchers = 0;
        if (orphanedGenVoucherIds.length > 0) {
          await tx.delete(voucherEntries).where(inArray(voucherEntries.voucherId, orphanedGenVoucherIds));
          await tx.delete(vouchers).where(inArray(vouchers.id, orphanedGenVoucherIds));
          deletedGenVouchers = orphanedGenVoucherIds.length;
        }
      });

      res.json({
        message: "Ledger repair complete",
        deletedPayrollVouchers,
        deletedAdvanceVouchers,
        total: deletedPayrollVouchers + deletedAdvanceVouchers,
      });
    } catch (error: any) {
      console.error("Repair orphaned vouchers error:", error);
      res.status(500).json({ message: error.message });
    }
  });
}
