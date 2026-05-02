import { getClientDate } from "../lib/dateUtils";
import type { Express } from "express";
import { checkFactoryAdmin } from "./factory/_helpers";
import { eq, and, desc, sql, ilike, gte, lte, inArray, isNotNull } from "drizzle-orm";
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
  factoryAttendance,
  ledgerAccounts,
  vouchers,
  voucherEntries,
  companies,
  companySettings,
} from "@shared/schema";

/** Prefer the factory-pinned company ID so cross-tab ERP company switches don't corrupt factory writes. */
function getFactoryCompanyId(req: any): number | undefined {
  return (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
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
  const end   = new Date(endStr   + "T00:00:00");
  let total = 0;
  let cur = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cur <= end) {
    const year  = cur.getFullYear();
    const month = cur.getMonth();
    const monthLastDay    = new Date(year, month + 1, 0);
    const daysInThisMonth = monthLastDay.getDate();
    const segStart = new Date(Math.max(cur.getTime(), start.getTime()));
    const segEnd   = new Date(Math.min(monthLastDay.getTime(), end.getTime()));
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

import { registerFactoryWorkerPayrollRoutes } from "./factoryWorkerPayrollRoutes";

export function registerFactoryWorkerRoutes(app: Express, requireAuth: any, db: any) {

  async function writeDaybookEntry(dbOrTx: any, opts: {
    companyId: number; txDate: string; txType: string;
    referenceId?: number; referenceTable?: string; description: string;
    metaJson?: string; currencyCode?: string; amountCurrency?: number;
    fxRateToUsd?: number; amountUsd?: number; createdBy?: number;
  }) {
    const currency = opts.currencyCode || "USD";
    const fxRate = opts.fxRateToUsd || 1;
    const amtCurrency = opts.amountCurrency || 0;
    const amtUsd = opts.amountUsd !== undefined ? opts.amountUsd : (currency === "USD" ? amtCurrency : amtCurrency * fxRate);
    await dbOrTx.insert(factoryDaybookEntries).values({
      companyId: opts.companyId, txDate: opts.txDate, txType: opts.txType,
      referenceId: opts.referenceId || null, referenceTable: opts.referenceTable || null,
      description: opts.description, metaJson: opts.metaJson || null,
      currencyCode: currency, amountCurrency: String(amtCurrency),
      fxRateToUsd: String(fxRate), amountUsd: String(amtUsd), createdBy: opts.createdBy || null,
    });
  }

  async function findOrCreateLedger(companyId: number, name: string, accountType: string): Promise<{ id: number }> {
    let [found] = await db.select({ id: ledgerAccounts.id })
      .from(ledgerAccounts)
      .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.name, name)));
    if (found) return found;

    for (let attempt = 0; attempt < 10; attempt++) {
      const [maxRow] = await db.select({ maxCode: sql`MAX(CAST(code AS INTEGER))` })
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.companyId, companyId), sql`code ~ '^\d+$'`));
      const nextCode = String((parseInt(maxRow?.maxCode || "0") || 0) + 1 + attempt);
      try {
        [found] = await db.insert(ledgerAccounts).values({
          companyId, code: nextCode, name, accountType,
          active: true, isHidden: false,
        }).returning();
        if (found) return found;
      } catch (err: any) {
        if (err?.message?.includes("company_code_unique")) {
          const [nowFound] = await db.select({ id: ledgerAccounts.id })
            .from(ledgerAccounts)
            .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.name, name)));
          if (nowFound) return nowFound;
          continue;
        }
        throw err;
      }
    }
    throw new Error(`Unable to create ledger account "${name}" after multiple attempts`);
  }

  // GET /api/factory/workers/with-balances - List active workers with computed current balances
  // Balance = total advances (debit) minus total paid payroll net salary (credit), all-time
  app.get("/api/factory/workers/with-balances", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const workers = await db
        .select()
        .from(factoryWorkers)
        .where(and(eq(factoryWorkers.companyId, companyId), eq(factoryWorkers.active, true)))
        .orderBy(factoryWorkers.fullName);

      // Compute balance for each worker using SQL aggregation
      const advanceTotals = await db
        .select({
          workerId: factoryWorkerAdvances.workerId,
          total: sql<string>`COALESCE(SUM(${factoryWorkerAdvances.amount}), 0)`,
        })
        .from(factoryWorkerAdvances)
        .where(eq(factoryWorkerAdvances.companyId, companyId))
        .groupBy(factoryWorkerAdvances.workerId);

      const payrollTotals = await db
        .select({
          workerId: factoryPayrolls.workerId,
          total: sql<string>`COALESCE(SUM(${factoryPayrolls.netSalary}), 0)`,
        })
        .from(factoryPayrolls)
        .where(and(
          eq(factoryPayrolls.companyId, companyId),
          sql`${factoryPayrolls.status} = 'PAID'`,
        ))
        .groupBy(factoryPayrolls.workerId);

      const advanceMap = new Map(advanceTotals.map((r) => [r.workerId, parseFloat(r.total)]));
      const payrollMap = new Map(payrollTotals.map((r) => [r.workerId, parseFloat(r.total)]));

      const result = workers.map((w) => ({
        ...w,
        currentBalance: (advanceMap.get(w.id) ?? 0) - (payrollMap.get(w.id) ?? 0),
      }));

      res.json(result);
    } catch (error: any) {
      console.error("Error fetching factory workers with balances:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/workers - List workers
  app.get("/api/factory/workers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { active, search, position, department } = req.query;

      const conditions: any[] = [eq(factoryWorkers.companyId, companyId)];

      if (active === "true") {
        conditions.push(eq(factoryWorkers.active, true));
      } else if (active === "false") {
        conditions.push(eq(factoryWorkers.active, false));
      }

      if (search) {
        conditions.push(ilike(factoryWorkers.fullName, `%${search}%`));
      }
      if (position) {
        conditions.push(eq(factoryWorkers.position, position as string));
      }
      if (department) {
        conditions.push(eq(factoryWorkers.department, department as string));
      }

      const results = await db
        .select()
        .from(factoryWorkers)
        .where(and(...conditions))
        .orderBy(factoryWorkers.fullName);

      res.json(results);
    } catch (error: any) {
      console.error("Error fetching factory workers:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/workers/document-counts - Document count per worker
  app.get("/api/factory/workers/document-counts", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const rows = await db
        .select({
          workerId: factoryWorkerDocuments.workerId,
          count: sql<number>`count(*)::int`,
        })
        .from(factoryWorkerDocuments)
        .where(eq(factoryWorkerDocuments.companyId, companyId))
        .groupBy(factoryWorkerDocuments.workerId);
      const result: Record<number, number> = {};
      for (const row of rows) result[row.workerId] = row.count;
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/workers/template.xlsx - Download Excel import template
  app.get("/api/factory/workers/template.xlsx", requireAuth, async (req: any, res: any) => {
    try {
      const wb = new ExcelJS.Workbook();
      const sheet = wb.addWorksheet("Workers");
      const headers = [
        "Full Name", "Employee Code", "National ID", "Passport Number", "Date of Birth", "Nationality",
        "Gender", "Marital Status", "Phone 1", "Phone 2", "Emergency Contact Name", "Emergency Contact Phone",
        "Address", "City", "Country", "Position", "Department", "Date Joined", "Contract Start",
        "Salary Type", "Base Salary", "Per Bale Rate", "Per KG Rate",
        "Pay Frequency", "Hourly Rate", "Weekly Salary", "Bi-Weekly Salary",
        "Visa Number", "Visa Expiry", "Work Permit Number", "Work Permit Expiry",
        "Residential Permit", "Residential Permit Expiry", "Bank Name", "Bank Account Number",
        "Payment Method", "Notes",
      ];
      const headerRow = sheet.addRow(headers);
      headerRow.font = { bold: true };
      headerRow.eachCell((cell: any) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "1F4E79" } };
        cell.font = { bold: true, color: { argb: "FFFFFF" } };
      });

      // Hint row: valid values for key columns
      const hintValues = [
        "", "", "", "", "YYYY-MM-DD", "",
        "Male / Female", "Single / Married / Divorced", "", "", "", "",
        "", "", "", "", "", "YYYY-MM-DD", "YYYY-MM-DD",
        "Monthly / Daily / Per Bale / Per KG", "number", "number", "number",
        "Monthly / Hourly / Weekly / Bi-Weekly", "number", "number", "number",
        "", "YYYY-MM-DD", "", "YYYY-MM-DD",
        "", "YYYY-MM-DD", "", "",
        "Cash / Bank / Transfer", "",
      ];
      const hintRow = sheet.addRow(hintValues);
      hintRow.eachCell((cell: any) => {
        if (cell.value) {
          cell.font = { italic: true, color: { argb: "888888" }, size: 9 };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "F5F5F5" } };
        }
      });

      // Example data row
      const exampleRow = sheet.addRow([
        "Ahmed Hassan", "FW-001", "A12345678", "P9876543", "1990-05-15", "Moroccan",
        "Male", "Married", "+212-600-123456", "+212-600-000000", "Fatima Hassan", "+212-600-654321",
        "123 Rue Mohammed V", "Casablanca", "Morocco", "Sorter", "Production", "2024-01-15", "2024-01-15",
        "Monthly", "3000", "2.50", "0.15",
        "Monthly", "0", "0", "0",
        "V2024-001", "2026-01-14", "WP2024-001", "2026-01-14",
        "RP2024-001", "2026-01-14", "Attijariwafa Bank", "007-123456789",
        "Bank", "Example row — delete before importing",
      ]);
      exampleRow.eachCell((cell: any) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE7" } };
        cell.font = { italic: true, color: { argb: "5D4037" } };
      });
      // Label in the first cell to make it obvious
      exampleRow.getCell(1).font = { bold: true, italic: true, color: { argb: "5D4037" } };

      headers.forEach((_, i) => { sheet.getColumn(i + 1).width = 22; });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", 'attachment; filename="worker_import_template.xlsx"');
      await wb.xlsx.write(res);
      res.end();
    } catch (error: any) {
      console.error("Error generating template:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/workers/import-excel - Bulk import/update workers from Excel
  app.post("/api/factory/workers/import-excel", requireAuth, workerUpload.single("file"), async (req: any, res: any) => {
    try {
      // Always use the session's current company; never trust client-provided companyId
      const companyId = getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "companyId required" });
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      // Parse xlsx
      const workbook = XLSX.readFile(req.file.path);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      fs.unlinkSync(req.file.path);

      // Case-insensitive column mapping
      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
      const colMap: Record<string, string> = {
        fullname: "fullName", employeecode: "employeeCode", nationalid: "nationalId",
        passportnumber: "passportNumber", dateofbirth: "dateOfBirth", nationality: "nationality",
        gender: "gender", maritalstatus: "maritalStatus", phone1: "phone1", phone2: "phone2",
        emergencycontactname: "emergencyContactName", emergencycontactphone: "emergencyContactPhone",
        address: "address", city: "city", country: "country", position: "position",
        department: "department", datejoined: "dateJoined", contractstart: "contractStartDate",
        salarytype: "salaryType", basesalary: "baseSalary", perbalerate: "perBaleRate",
        perkgrate: "perKgRate", payfrequency: "payFrequency", hourlyrate: "hourlyRate",
        weeklysalary: "weeklySalary", biweeklysalary: "biWeeklySalary",
        visanumber: "visaNumber", visaexpiry: "visaExpiry",
        workpermitnumber: "workPermitNumber", workpermitexpiry: "workPermitExpiry",
        residentialpermit: "residentialPermit", residentialpermitexpiry: "residentialPermitExpiry",
        bankname: "bankName", bankaccountnumber: "bankAccountNumber",
        paymentmethod: "paymentMethod", notes: "notes",
      };

      let created = 0, updated = 0, skipped = 0;
      const errors: string[] = [];

      // Load existing workers for fast lookup
      const existingWorkers = await db.select().from(factoryWorkers).where(eq(factoryWorkers.companyId, companyId));

      // Determine next HMD code number for auto-assignment during import
      const importPrefix = "HMD";
      let nextHmdNum = existingWorkers.reduce((max, w: any) => {
        if (!w.employeeCode) return max;
        const m = w.employeeCode.match(new RegExp(`^${importPrefix}(\\d+)$`));
        return m ? Math.max(max, parseInt(m[1], 10)) : max;
      }, 0);
      const byCode = new Map(existingWorkers.filter((w: any) => w.employeeCode).map((w: any) => [w.employeeCode, w]));
      const byPassport = new Map(existingWorkers.filter((w: any) => w.passportNumber).map((w: any) => [w.passportNumber, w]));
      const byNationalId = new Map(existingWorkers.filter((w: any) => w.nationalId).map((w: any) => [w.nationalId, w]));

      const parseDate = (v: any): string | null => {
        if (!v) return null;
        if (typeof v === "number") {
          // Excel serial date
          const d = new Date(Math.round((v - 25569) * 86400 * 1000));
          return d.toISOString().split("T")[0];
        }
        const s = String(v).trim();
        if (!s) return null;
        const d = new Date(s);
        return isNaN(d.getTime()) ? null : d.toISOString().split("T")[0];
      };

      for (let i = 0; i < rows.length; i++) {
        const raw = rows[i];
        try {
          // Map raw keys to field names
          const mapped: any = {};
          for (const [rawKey, rawVal] of Object.entries(raw)) {
            const key = colMap[normalize(rawKey)];
            if (key) mapped[key] = rawVal;
          }
          if (!mapped.fullName) { skipped++; errors.push(`Row ${i + 2}: missing Full Name`); continue; }

          // Date fields
          for (const f of ["dateOfBirth", "dateJoined", "contractStartDate", "visaExpiry", "workPermitExpiry", "residentialPermitExpiry"]) {
            if (mapped[f] !== undefined) mapped[f] = parseDate(mapped[f]);
          }
          // Numeric fields
          for (const f of ["baseSalary", "perBaleRate", "perKgRate", "hourlyRate", "weeklySalary", "biWeeklySalary"]) {
            if (mapped[f] !== undefined && mapped[f] !== "") mapped[f] = String(parseFloat(mapped[f]) || 0);
          }

          // Find existing worker
          const existing = byCode.get(mapped.employeeCode) || byPassport.get(mapped.passportNumber) || byNationalId.get(mapped.nationalId);
          if (existing) {
            await db.update(factoryWorkers).set({ ...mapped, updatedAt: new Date() }).where(and(eq(factoryWorkers.id, existing.id), eq(factoryWorkers.companyId, companyId)));
            updated++;
          } else {
            const [newWorker] = await db.insert(factoryWorkers).values({ ...mapped, companyId }).returning();
            if (!newWorker.employeeCode) {
              nextHmdNum++;
              const autoCode = `${importPrefix}${String(nextHmdNum).padStart(3, "0")}`;
              await db.update(factoryWorkers).set({ employeeCode: autoCode }).where(eq(factoryWorkers.id, newWorker.id));
            }
            created++;
          }
        } catch (e: any) {
          skipped++;
          errors.push(`Row ${i + 2}: ${e.message}`);
        }
      }

      const today = getClientDate(req);
      await writeDaybookEntry(db, {
        companyId, txDate: today, txType: "WORKER_IMPORT",
        description: `Worker import: ${created} created, ${updated} updated, ${skipped} skipped`,
        createdBy: (req.session as any).userId ? parseInt((req.session as any).userId) : undefined,
      });

      res.json({ created, updated, skipped, errors });
    } catch (error: any) {
      console.error("Error importing workers:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/workers/reassign-codes - Bulk reassign HMD001, HMD002... codes
  app.post("/api/factory/workers/reassign-codes", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const prefix = (req.body.prefix as string) || "HMD";

      const allWorkers = await db
        .select({ id: factoryWorkers.id, fullName: factoryWorkers.fullName })
        .from(factoryWorkers)
        .where(eq(factoryWorkers.companyId, companyId))
        .orderBy(factoryWorkers.id);

      const results: { id: number; name: string; code: string }[] = [];

      for (let i = 0; i < allWorkers.length; i++) {
        const code = `${prefix}${String(i + 1).padStart(3, "0")}`;
        await db
          .update(factoryWorkers)
          .set({ employeeCode: code, updatedAt: new Date() })
          .where(and(eq(factoryWorkers.id, allWorkers[i].id), eq(factoryWorkers.companyId, companyId)));
        results.push({ id: allWorkers[i].id, name: allWorkers[i].fullName, code });
      }

      res.json({ updated: results.length, codes: results });
    } catch (error: any) {
      console.error("Error reassigning worker codes:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/workers/:id - Get single worker with computed stats
  app.get("/api/factory/workers/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [worker] = await db
        .select()
        .from(factoryWorkers)
        .where(and(eq(factoryWorkers.id, id), eq(factoryWorkers.companyId, companyId)));

      if (!worker) return res.status(404).json({ message: "Worker not found" });

      const bales = await db
        .select()
        .from(factoryBales)
        .where(and(eq(factoryBales.finalizedBy, id), eq(factoryBales.companyId, companyId)));

      const totalBales = bales.length;
      const totalKg = bales.reduce((sum: number, b: any) => sum + parseFloat(b.weightKg || "0"), 0);

      const payrolls = await db
        .select()
        .from(factoryPayrolls)
        .where(and(eq(factoryPayrolls.workerId, id), eq(factoryPayrolls.companyId, companyId)));

      const totalEarnings = payrolls.reduce((sum: number, p: any) => sum + parseFloat(p.netSalary || "0"), 0);

      res.json({
        ...worker,
        stats: {
          totalBales,
          totalKg: totalKg.toFixed(3),
          totalEarnings: totalEarnings.toFixed(2),
          payrollCount: payrolls.length,
        },
      });
    } catch (error: any) {
      console.error("Error fetching factory worker:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/workers - Create worker
  app.post("/api/factory/workers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const rawData = { ...req.body, companyId };
      for (const f of ["dateOfBirth", "dateJoined", "contractStartDate", "contractEndDate", "visaExpiry", "workPermitExpiry", "residentialPermitExpiry"]) {
        if (rawData[f] === "" || rawData[f] === undefined) rawData[f] = null;
      }
      for (const f of ["baseSalary", "perBaleRate", "perKgRate", "overtimeRate", "hourlyRate", "weeklySalary", "biWeeklySalary"]) {
        if (rawData[f] === "" || rawData[f] === undefined) rawData[f] = "0";
      }
      if (rawData.transportAllowance === "" || rawData.transportAllowance === undefined) rawData.transportAllowance = null;
      if (rawData.numberOfChildren === "" || rawData.numberOfChildren === undefined) rawData.numberOfChildren = 0;
      const parsed = insertFactoryWorkerSchema.parse(rawData);
      const [worker] = await db.insert(factoryWorkers).values(parsed).returning();

      if (!worker.employeeCode) {
        const prefix = "HMD";
        const existing = await db
          .select({ employeeCode: factoryWorkers.employeeCode })
          .from(factoryWorkers)
          .where(eq(factoryWorkers.companyId, companyId));
        const maxNum = existing.reduce((max, w) => {
          if (!w.employeeCode) return max;
          const m = w.employeeCode.match(new RegExp(`^${prefix}(\\d+)$`));
          if (!m) return max;
          return Math.max(max, parseInt(m[1], 10));
        }, 0);
        const code = `${prefix}${String(maxNum + 1).padStart(3, "0")}`;
        const [updated] = await db
          .update(factoryWorkers)
          .set({ employeeCode: code })
          .where(eq(factoryWorkers.id, worker.id))
          .returning();
        Object.assign(worker, updated);
      }

      const today = getClientDate(req);
      await writeDaybookEntry(db, {
        companyId,
        txDate: today,
        txType: "WORKER_CREATED",
        referenceId: worker.id,
        referenceTable: "factory_workers",
        description: `New worker created: ${worker.fullName} (${worker.employeeCode})`,
        createdBy: (req.session as any).userId ? parseInt((req.session as any).userId) : undefined,
      });

      const now = new Date();
      const yearStart = new Date(now.getFullYear(), 0, 1);
      const joinDate = worker.dateJoined ? new Date(worker.dateJoined) : now;
      const absentEnd = new Date(joinDate);
      absentEnd.setDate(absentEnd.getDate() - 1);

      if (absentEnd >= yearStart) {
        const absentRecords: any[] = [];
        const cursor = new Date(yearStart);
        while (cursor <= absentEnd) {
          absentRecords.push({
            companyId,
            workerId: worker.id,
            attendanceDate: cursor.toISOString().split("T")[0],
            status: "Absent",
            notes: "Auto-absent (pre-join)",
          });
          cursor.setDate(cursor.getDate() + 1);
        }
        if (absentRecords.length > 0) {
          const BATCH = 500;
          for (let i = 0; i < absentRecords.length; i += BATCH) {
            await db.insert(factoryAttendance).values(absentRecords.slice(i, i + BATCH)).onConflictDoNothing();
          }
        }
      }

      res.json(worker);
    } catch (error: any) {
      console.error("Error creating factory worker:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // PATCH /api/factory/workers/:id - Update worker
  app.patch("/api/factory/workers/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const updateData = { ...req.body };
      for (const f of ["dateOfBirth", "dateJoined", "contractStartDate", "contractEndDate", "visaExpiry", "workPermitExpiry", "residentialPermitExpiry"]) {
        if (updateData[f] === "" || updateData[f] === undefined) updateData[f] = null;
      }
      for (const f of ["baseSalary", "perBaleRate", "perKgRate", "overtimeRate", "hourlyRate", "weeklySalary", "biWeeklySalary"]) {
        if (updateData[f] === "" || updateData[f] === undefined) updateData[f] = "0";
      }
      if (updateData.transportAllowance === "") updateData.transportAllowance = null;
      if (updateData.numberOfChildren === "" || updateData.numberOfChildren === undefined) updateData.numberOfChildren = 0;
      const [updated] = await db
        .update(factoryWorkers)
        .set({ ...updateData, updatedAt: new Date() })
        .where(and(eq(factoryWorkers.id, id), eq(factoryWorkers.companyId, companyId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Worker not found" });

      const today = getClientDate(req);
      await writeDaybookEntry(db, {
        companyId,
        txDate: today,
        txType: "WORKER_EDITED",
        referenceId: updated.id,
        referenceTable: "factory_workers",
        description: `Worker updated: ${updated.fullName}`,
        createdBy: (req.session as any).userId ? parseInt((req.session as any).userId) : undefined,
      });

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating factory worker:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // POST /api/factory/workers/:id/end-contract - End contract
  app.post("/api/factory/workers/:id/end-contract", requireAuth, async (req: any, res: any) => {
    try {
      if (!checkFactoryAdmin(req, res)) return;
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const today = getClientDate(req);

      const [updated] = await db
        .update(factoryWorkers)
        .set({ active: false, contractEndDate: today, updatedAt: new Date() })
        .where(and(eq(factoryWorkers.id, id), eq(factoryWorkers.companyId, companyId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Worker not found" });

      await writeDaybookEntry(db, {
        companyId,
        txDate: today,
        txType: "CONTRACT_ENDED",
        referenceId: updated.id,
        referenceTable: "factory_workers",
        description: `Contract ended for worker: ${updated.fullName} (${updated.employeeCode || "N/A"})`,
        createdBy: (req.session as any).userId ? parseInt((req.session as any).userId) : undefined,
      });

      res.json(updated);
    } catch (error: any) {
      console.error("Error ending worker contract:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // POST /api/factory/workers/:id/reactivate - Reactivate an inactive worker
  app.post("/api/factory/workers/:id/reactivate", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const today = getClientDate(req);

      const [updated] = await db
        .update(factoryWorkers)
        .set({ active: true, contractEndDate: null, updatedAt: new Date() })
        .where(and(eq(factoryWorkers.id, id), eq(factoryWorkers.companyId, companyId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Worker not found" });

      await writeDaybookEntry(db, {
        companyId,
        txDate: today,
        txType: "CONTRACT_REACTIVATED",
        referenceId: updated.id,
        referenceTable: "factory_workers",
        description: `Contract reactivated for worker: ${updated.fullName} (${updated.employeeCode || "N/A"})`,
        createdBy: (req.session as any).userId ? parseInt((req.session as any).userId) : undefined,
      });

      res.json(updated);
    } catch (error: any) {
      console.error("Error reactivating worker:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // POST /api/factory/workers/:id/photo - Upload photo
  app.post("/api/factory/workers/:id/photo", requireAuth, workerUpload.single("photo"), async (req: any, res: any) => {
    try {
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      if (!req.file) return res.status(400).json({ message: "No photo uploaded" });

      const id = parseInt(req.params.id);
      const photoUrl = `/api/factory/uploads/workers/${req.file.filename}`;

      const [updated] = await db
        .update(factoryWorkers)
        .set({ photoUrl, updatedAt: new Date() })
        .where(and(eq(factoryWorkers.id, id), eq(factoryWorkers.companyId, companyId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Worker not found" });

      const today = getClientDate(req);
      await writeDaybookEntry(db, {
        companyId,
        txDate: today,
        txType: "WORKER_PHOTO_UPLOADED",
        referenceId: updated.id,
        referenceTable: "factory_workers",
        description: `Photo uploaded for worker: ${updated.fullName}`,
        createdBy: (req.session as any).userId ? parseInt((req.session as any).userId) : undefined,
      });

      res.json(updated);
    } catch (error: any) {
      console.error("Error uploading worker photo:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // GET /api/factory/uploads/workers/:filename - Serve worker photos
  app.get("/api/factory/uploads/workers/:filename", (req: any, res: any) => {
    try {
      const filename = req.params.filename;
      const filePath = path.join(process.cwd(), "uploads", "workers", filename);
      if (!fs.existsSync(filePath)) return res.status(404).json({ message: "File not found" });
      res.sendFile(filePath);
    } catch (error: any) {
      console.error("Error serving worker photo:", error);
      res.status(500).json({ message: error.message });
    }
  });

  const docUpload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        const dir = path.join(process.cwd(), "uploads", "workers", "docs");
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
      },
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  // POST /api/factory/workers/:id/documents - Upload document
  app.post("/api/factory/workers/:id/documents", requireAuth, docUpload.single("file"), async (req: any, res: any) => {
    try {
      const companyId = getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const workerId = parseInt(req.params.id);
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const fileUrl = `/api/factory/uploads/workers/docs/${req.file.filename}`;

      // Read the uploaded file from disk and store its content in the DB so
      // it survives server redeploys/restarts (Render and Replit have
      // ephemeral disks). The disk copy is kept as a hot cache.
      let fileData: string | null = null;
      try {
        const buf = fs.readFileSync(req.file.path);
        fileData = buf.toString("base64");
      } catch (readErr) {
        console.error("Failed to read uploaded worker doc into DB:", readErr);
      }

      const [doc] = await db.insert(factoryWorkerDocuments).values({
        companyId,
        workerId,
        fileName: req.file.filename,
        originalName: req.file.originalname,
        fileUrl,
        fileType: req.file.mimetype,
        fileSize: req.file.size,
        fileData,
      }).returning();
      res.json(doc);
    } catch (error: any) {
      console.error("Error uploading worker document:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // GET /api/factory/workers/:id/documents - List documents
  // Note: file_data is intentionally excluded — it's a (potentially large)
  // base64 blob and the listing UI only needs metadata. The actual bytes
  // are streamed from /api/factory/uploads/workers/docs/:filename.
  app.get("/api/factory/workers/:id/documents", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const workerId = parseInt(req.params.id);
      const docs = await db.select({
        id:           factoryWorkerDocuments.id,
        companyId:    factoryWorkerDocuments.companyId,
        workerId:     factoryWorkerDocuments.workerId,
        fileName:     factoryWorkerDocuments.fileName,
        originalName: factoryWorkerDocuments.originalName,
        fileUrl:      factoryWorkerDocuments.fileUrl,
        fileType:     factoryWorkerDocuments.fileType,
        fileSize:     factoryWorkerDocuments.fileSize,
        uploadedAt:   factoryWorkerDocuments.uploadedAt,
      }).from(factoryWorkerDocuments)
        .where(and(eq(factoryWorkerDocuments.workerId, workerId), eq(factoryWorkerDocuments.companyId, companyId)))
        .orderBy(desc(factoryWorkerDocuments.uploadedAt));
      res.json(docs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // DELETE /api/factory/workers/:id/documents/:docId - Delete document
  app.delete("/api/factory/workers/:id/documents/:docId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const workerId = parseInt(req.params.id);
      const docId = parseInt(req.params.docId);
      const [doc] = await db.select().from(factoryWorkerDocuments)
        .where(and(eq(factoryWorkerDocuments.id, docId), eq(factoryWorkerDocuments.workerId, workerId), eq(factoryWorkerDocuments.companyId, companyId)));
      if (!doc) return res.status(404).json({ message: "Document not found" });
      const filePath = path.join(process.cwd(), "uploads", "workers", "docs", doc.fileName);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      await db.delete(factoryWorkerDocuments).where(eq(factoryWorkerDocuments.id, docId));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/uploads/workers/docs/:filename - Serve worker documents
  // Resolution order:
  //   1. Local disk cache (fast, used right after upload).
  //   2. Database fallback (file_data column) — needed because Render and
  //      Replit have ephemeral disks that get wiped on every redeploy.
  app.get("/api/factory/uploads/workers/docs/:filename", requireAuth, async (req: any, res: any) => {
    try {
      const filename = req.params.filename;
      const filePath = path.join(process.cwd(), "uploads", "workers", "docs", filename);

      if (fs.existsSync(filePath)) {
        return res.sendFile(filePath);
      }

      // Disk miss — fall back to the DB copy.
      const [doc] = await db.select({
        fileData:     factoryWorkerDocuments.fileData,
        fileType:     factoryWorkerDocuments.fileType,
        originalName: factoryWorkerDocuments.originalName,
      }).from(factoryWorkerDocuments)
        .where(eq(factoryWorkerDocuments.fileName, filename))
        .limit(1);

      if (!doc?.fileData) {
        return res.status(404).json({ message: "File not found" });
      }

      const buf = Buffer.from(doc.fileData, "base64");

      // Re-hydrate the disk cache so subsequent requests are fast.
      try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, buf);
      } catch (cacheErr) {
        console.error("Failed to re-hydrate worker doc disk cache:", cacheErr);
      }

      res.setHeader("Content-Type", doc.fileType || "application/octet-stream");
      if (doc.originalName) {
        res.setHeader("Content-Disposition", `inline; filename="${doc.originalName.replace(/"/g, "")}"`);
      }
      res.send(buf);
    } catch (error: any) {
      console.error("Error serving worker document:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/workers/:id/bales - Get bales associated with worker
  app.get("/api/factory/workers/:id/bales", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const { startDate, endDate } = req.query;

      const conditions: any[] = [
        eq(factoryBales.finalizedBy, id),
        eq(factoryBales.companyId, companyId),
      ];

      if (startDate) {
        conditions.push(sql`${factoryBales.finalizedAt} >= ${startDate}::timestamp`);
      }
      if (endDate) {
        conditions.push(sql`${factoryBales.finalizedAt} <= ${endDate}::timestamp + interval '1 day'`);
      }

      const bales = await db
        .select()
        .from(factoryBales)
        .where(and(...conditions))
        .orderBy(desc(factoryBales.finalizedAt));

      res.json(bales);
    } catch (error: any) {
      console.error("Error fetching worker bales:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/workers/:id/settle-and-end - Settlement calculation + end contract
  app.post("/api/factory/workers/:id/settle-and-end", requireAuth, async (req: any, res: any) => {
    try {
      if (!checkFactoryAdmin(req, res)) return;
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const { startDate, endDate, hoursWorked, dryRun, payNow, cashAccountId, skipSettlement } = req.body;

      const [worker] = await db.select().from(factoryWorkers).where(and(eq(factoryWorkers.id, id), eq(factoryWorkers.companyId, companyId)));
      if (!worker) return res.status(404).json({ message: "Worker not found" });
      if (!worker.active) return res.status(400).json({ message: "Worker contract already ended" });

      // Skip-settlement: just deactivate the worker immediately, no payroll record created
      if (skipSettlement) {
        const today = getClientDate(req);
        const endEffective = endDate || today;
        await db.update(factoryWorkers).set({ active: false, contractEndDate: endEffective, updatedAt: new Date() }).where(eq(factoryWorkers.id, id));
        await writeDaybookEntry(db, {
          companyId, txDate: today, txType: "CONTRACT_ENDED",
          referenceId: id, referenceTable: "factory_workers",
          description: `Contract ended (no settlement) for ${worker.fullName}`,
          amountCurrency: 0, amountUsd: 0,
          createdBy: (req.session as any).userId ? parseInt((req.session as any).userId) : undefined,
        });
        return res.json({ skipped: true, workerUpdated: true });
      }

      if (!startDate || !endDate) return res.status(400).json({ message: "startDate and endDate required" });

      const toDateStr = (v: any): string | null => {
        if (!v) return null;
        if (v instanceof Date) return v.toISOString().split("T")[0];
        return String(v).split("T")[0];
      };
      const workerJoinDate = toDateStr(worker.contractStartDate) || toDateStr(worker.dateJoined) || null;
      const effectiveStart = workerJoinDate && workerJoinDate > startDate ? workerJoinDate : startDate;

      if (effectiveStart > endDate && dryRun) {
        return res.json({ earned: "0.00", paid: "0.00", advances: "0.00", balance: "0.00", effectiveStart, dryRun: true });
      }

      // Helper functions
      const daysInPeriod = (s: string, e: string) => Math.floor((new Date(e).getTime() - new Date(s).getTime()) / (1000 * 60 * 60 * 24)) + 1;
      const countWeekdays = (s: string, e: string) => {
        let count = 0; const cur = new Date(s); const end = new Date(e);
        while (cur <= end) { const d = cur.getDay(); if (d !== 0 && d !== 6) count++; cur.setDate(cur.getDate() + 1); }
        return count;
      };
      const daysInMonth = (dateStr: string) => { const d = new Date(dateStr); return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); };

      const days = daysInPeriod(effectiveStart, endDate);
      const weekdays = countWeekdays(effectiveStart, endDate);
      const baseSal = parseFloat(worker.baseSalary || "0");
      const payFreq = worker.payFrequency || "Monthly";
      const salType = worker.salaryType || "Monthly";

      let earned = 0;
      const validRange = effectiveStart <= endDate;

      // Time-based frequencies use payFrequency field; production-based fall back to salaryType
      if (!validRange) {
        earned = 0;
      } else if (payFreq === "Hourly") {
        earned = (parseFloat(hoursWorked) || 0) * parseFloat(worker.hourlyRate || "0");
      } else if (payFreq === "Weekly") {
        earned = (days / 7) * parseFloat(worker.weeklySalary || "0");
      } else if (payFreq === "Bi-Weekly") {
        earned = (days / 14) * parseFloat(worker.biWeeklySalary || "0");
      } else if (salType === "Daily") {
        earned = weekdays * baseSal;
      } else if (salType === "Per Bale" || salType === "Per KG") {
        const bales = await db.select().from(factoryBales).where(and(
          eq(factoryBales.companyId, companyId),
          eq(factoryBales.finalizedBy, id),
          gte(factoryBales.finalizedAt, new Date(effectiveStart)),
          lte(factoryBales.finalizedAt, new Date(endDate + "T23:59:59.999Z")),
        ));
        if (salType === "Per Bale") {
          earned = bales.length * parseFloat(worker.perBaleRate || "0");
        } else {
          const totalKg = bales.reduce((s: number, b: any) => s + parseFloat(b.weightKg || "0"), 0);
          earned = totalKg * parseFloat(worker.perKgRate || "0");
        }
      } else {
        // Monthly: base pay on actual attendance records in the effective period
        const attendanceRows = await db.select().from(factoryAttendance).where(and(
          eq(factoryAttendance.workerId, id),
          eq(factoryAttendance.companyId, companyId),
          gte(factoryAttendance.attendanceDate, effectiveStart),
          lte(factoryAttendance.attendanceDate, endDate),
        ));
        if (attendanceRows.length === 0) {
          // No attendance records — fall back to calendar-day proration
          earned = computeMonthlyPay(baseSal, effectiveStart, endDate);
        } else {
          earned = computeMonthlyPayFromAttendance(baseSal, effectiveStart, attendanceRows);
        }
      }

      // Compute already paid: any APPROVED/PAID payroll whose period overlaps the settlement window.
      // Use overlap condition (periodStart <= endDate AND periodEnd >= effectiveStart) instead of
      // strict containment so that date mismatches between the settlement input and the payroll
      // period boundaries never silently drop prior payments.
      //
      // IMPORTANT: use gross paid (netSalary + advances_deducted) rather than netSalary alone.
      // netSalary already has advance-recovery deductions subtracted. If we only sum netSalary,
      // the recovered advance money vanishes from the calculation, making the balance look higher
      // than it actually is (phantom "still owed" amount equal to the advance that was recovered).
      // Adding back the advances column gives us the gross salary amount, which correctly matches
      // the gross "earned" figure from attendance/calendar — and outstanding advance debt is
      // tracked separately in the advances field of the response.
      const paidPayrolls = await db.select().from(factoryPayrolls).where(and(
        eq(factoryPayrolls.workerId, id),
        eq(factoryPayrolls.companyId, companyId),
        lte(factoryPayrolls.periodStart, endDate),
        gte(factoryPayrolls.periodEnd, effectiveStart),
        inArray(factoryPayrolls.status, ["APPROVED", "PAID"]),
      ));
      const totalPaid = paidPayrolls.reduce((s: number, p: any) =>
        s + parseFloat(p.netSalary || "0") + parseFloat(p.advances || "0") + parseFloat(p.deductions || "0"), 0);

      // Compute outstanding advances (remaining balance not yet recovered)
      const outstandingAdvances = await db.select().from(factoryWorkerAdvances).where(and(
        eq(factoryWorkerAdvances.workerId, id),
        eq(factoryWorkerAdvances.companyId, companyId),
        eq(factoryWorkerAdvances.fullyPaid, false),
      ));
      const totalAdvances = outstandingAdvances.reduce((s: number, a: any) => s + parseFloat(a.remainingBalance || "0"), 0);

      const balance = earned - totalPaid - totalAdvances;

      // dryRun: just return calculation, no DB changes
      if (dryRun) {
        return res.json({ earned: earned.toFixed(2), paid: totalPaid.toFixed(2), advances: totalAdvances.toFixed(2), balance: balance.toFixed(2), effectiveStart, dryRun: true });
      }

      const settlementStatus = payNow ? "PAID" : "APPROVED";
      const settlementPaidAt = payNow ? new Date() : null;

      // Insert settlement payroll record
      const [settlement] = await db.insert(factoryPayrolls).values({
        companyId,
        workerId: id,
        periodStart: effectiveStart,
        periodEnd: endDate,
        baseSalary: String(earned.toFixed(2)),
        baleEarnings: "0",
        kgEarnings: "0",
        overtimePay: "0",
        bonuses: "0",
        deductions: String(totalPaid.toFixed(2)),
        advances: String(totalAdvances.toFixed(2)),
        netSalary: String(balance.toFixed(2)),
        balesCount: 0,
        kgProcessed: "0",
        overtimeHours: "0",
        status: settlementStatus,
        notes: "Settlement - contract ended",
        cashAccountId: cashAccountId ? parseInt(cashAccountId) : null,
        paidAt: settlementPaidAt,
      } as any).returning();

      // Mark all outstanding advances as fully paid (recovered on settlement)
      if (outstandingAdvances.length > 0) {
        for (const adv of outstandingAdvances) {
          await db.update(factoryWorkerAdvances)
            .set({ fullyPaid: true, remainingBalance: "0" })
            .where(eq(factoryWorkerAdvances.id, adv.id));
        }
      }

      // Deactivate worker
      const today = getClientDate(req);
      await db.update(factoryWorkers).set({ active: false, contractEndDate: endDate, updatedAt: new Date() }).where(eq(factoryWorkers.id, id));

      await writeDaybookEntry(db, {
        companyId, txDate: today, txType: "CONTRACT_SETTLED",
        referenceId: id, referenceTable: "factory_workers",
        description: `Settlement for ${worker.fullName}: earned $${earned.toFixed(2)}, paid $${totalPaid.toFixed(2)}, advances $${totalAdvances.toFixed(2)}, balance $${balance.toFixed(2)}`,
        amountCurrency: Math.abs(balance), amountUsd: Math.abs(balance),
        createdBy: (req.session as any).userId ? parseInt((req.session as any).userId) : undefined,
      });

      res.json({ earned: earned.toFixed(2), paid: totalPaid.toFixed(2), advances: totalAdvances.toFixed(2), balance: balance.toFixed(2), effectiveStart, settlementPayrollId: settlement.id, workerUpdated: true });
    } catch (error: any) {
      console.error("Error settling worker contract:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/cash-accounts - Get ledger accounts for cash account picker
  registerFactoryWorkerPayrollRoutes(app);
}
