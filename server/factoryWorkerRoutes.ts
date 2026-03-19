import type { Express } from "express";
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
      const companyId = req.body.companyId ? parseInt(req.body.companyId) : getFactoryCompanyId(req);
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
              await db.update(factoryWorkers).set({ employeeCode: `FW-${companyId}-${newWorker.id}` }).where(eq(factoryWorkers.id, newWorker.id));
            }
            created++;
          }
        } catch (e: any) {
          skipped++;
          errors.push(`Row ${i + 2}: ${e.message}`);
        }
      }

      const today = new Date().toISOString().split("T")[0];
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
      if (rawData.numberOfChildren === "" || rawData.numberOfChildren === undefined) rawData.numberOfChildren = 0;
      const parsed = insertFactoryWorkerSchema.parse(rawData);
      const [worker] = await db.insert(factoryWorkers).values(parsed).returning();

      if (!worker.employeeCode) {
        const code = `FW-${companyId}-${worker.id}`;
        const [updated] = await db
          .update(factoryWorkers)
          .set({ employeeCode: code })
          .where(eq(factoryWorkers.id, worker.id))
          .returning();
        Object.assign(worker, updated);
      }

      const today = new Date().toISOString().split("T")[0];
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
      if (updateData.numberOfChildren === "" || updateData.numberOfChildren === undefined) updateData.numberOfChildren = 0;
      const [updated] = await db
        .update(factoryWorkers)
        .set({ ...updateData, updatedAt: new Date() })
        .where(and(eq(factoryWorkers.id, id), eq(factoryWorkers.companyId, companyId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Worker not found" });

      const today = new Date().toISOString().split("T")[0];
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
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const today = new Date().toISOString().split("T")[0];

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

      const today = new Date().toISOString().split("T")[0];
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
      const [doc] = await db.insert(factoryWorkerDocuments).values({
        companyId,
        workerId,
        fileName: req.file.filename,
        originalName: req.file.originalname,
        fileUrl,
        fileType: req.file.mimetype,
        fileSize: req.file.size,
      }).returning();
      res.json(doc);
    } catch (error: any) {
      console.error("Error uploading worker document:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // GET /api/factory/workers/:id/documents - List documents
  app.get("/api/factory/workers/:id/documents", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const workerId = parseInt(req.params.id);
      const docs = await db.select().from(factoryWorkerDocuments)
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
  app.get("/api/factory/uploads/workers/docs/:filename", requireAuth, (req: any, res: any) => {
    try {
      const filename = req.params.filename;
      const filePath = path.join(process.cwd(), "uploads", "workers", "docs", filename);
      if (!fs.existsSync(filePath)) return res.status(404).json({ message: "File not found" });
      res.sendFile(filePath);
    } catch (error: any) {
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
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const { startDate, endDate, hoursWorked, dryRun, payNow, cashAccountId } = req.body;
      if (!startDate || !endDate) return res.status(400).json({ message: "startDate and endDate required" });

      const [worker] = await db.select().from(factoryWorkers).where(and(eq(factoryWorkers.id, id), eq(factoryWorkers.companyId, companyId)));
      if (!worker) return res.status(404).json({ message: "Worker not found" });
      if (!worker.active) return res.status(400).json({ message: "Worker contract already ended" });

      const toDateStr = (v: any): string | null => {
        if (!v) return null;
        if (v instanceof Date) return v.toISOString().split("T")[0];
        return String(v).split("T")[0];
      };
      const workerJoinDate = toDateStr(worker.contractStartDate) || toDateStr(worker.dateJoined) || null;
      const effectiveStart = workerJoinDate && workerJoinDate > startDate ? workerJoinDate : startDate;

      if (effectiveStart > endDate && dryRun) {
        return res.json({ earned: "0.00", paid: "0.00", balance: "0.00", effectiveStart, dryRun: true });
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

      // Compute already paid in period (APPROVED or PAID payrolls)
      const paidPayrolls = await db.select().from(factoryPayrolls).where(and(
        eq(factoryPayrolls.workerId, id),
        eq(factoryPayrolls.companyId, companyId),
        gte(factoryPayrolls.periodStart, effectiveStart),
        lte(factoryPayrolls.periodEnd, endDate),
        inArray(factoryPayrolls.status, ["APPROVED", "PAID"]),
      ));
      const totalPaid = paidPayrolls.reduce((s: number, p: any) => s + parseFloat(p.netSalary || "0"), 0);
      const balance = earned - totalPaid;

      // dryRun: just return calculation, no DB changes
      if (dryRun) {
        return res.json({ earned: earned.toFixed(2), paid: totalPaid.toFixed(2), balance: balance.toFixed(2), effectiveStart, dryRun: true });
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
        advances: "0",
        netSalary: String(balance.toFixed(2)),
        balesCount: 0,
        kgProcessed: "0",
        overtimeHours: "0",
        status: settlementStatus,
        notes: "Settlement - contract ended",
        cashAccountId: cashAccountId ? parseInt(cashAccountId) : null,
        paidAt: settlementPaidAt,
      } as any).returning();

      // Deactivate worker
      const today = new Date().toISOString().split("T")[0];
      await db.update(factoryWorkers).set({ active: false, contractEndDate: endDate, updatedAt: new Date() }).where(eq(factoryWorkers.id, id));

      await writeDaybookEntry(db, {
        companyId, txDate: today, txType: "CONTRACT_SETTLED",
        referenceId: id, referenceTable: "factory_workers",
        description: `Settlement for ${worker.fullName}: earned $${earned.toFixed(2)}, paid $${totalPaid.toFixed(2)}, balance $${balance.toFixed(2)}`,
        amountCurrency: Math.abs(balance), amountUsd: Math.abs(balance),
        createdBy: (req.session as any).userId ? parseInt((req.session as any).userId) : undefined,
      });

      res.json({ earned: earned.toFixed(2), paid: totalPaid.toFixed(2), balance: balance.toFixed(2), effectiveStart, settlementPayrollId: settlement.id, workerUpdated: true });
    } catch (error: any) {
      console.error("Error settling worker contract:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/cash-accounts - Get ledger accounts for cash account picker
  app.get("/api/factory/cash-accounts", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const accounts = await db.select({ id: ledgerAccounts.id, name: ledgerAccounts.name, code: ledgerAccounts.code })
        .from(ledgerAccounts)
        .where(eq(ledgerAccounts.companyId, companyId))
        .orderBy(ledgerAccounts.name);
      res.json(accounts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/payrolls - All payroll records for company with worker info
  app.get("/api/factory/payrolls", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const payrolls = await db.select().from(factoryPayrolls)
        .where(eq(factoryPayrolls.companyId, companyId))
        .orderBy(desc(factoryPayrolls.periodEnd));
      // Attach worker names
      const workerIds = [...new Set(payrolls.map((p: any) => p.workerId))];
      const workers = workerIds.length ? await db.select({ id: factoryWorkers.id, fullName: factoryWorkers.fullName, employeeCode: factoryWorkers.employeeCode, position: factoryWorkers.position })
        .from(factoryWorkers).where(inArray(factoryWorkers.id, workerIds)) : [];
      const workerMap = new Map(workers.map((w: any) => [w.id, w]));
      const result = payrolls.map((p: any) => ({ ...p, worker: workerMap.get(p.workerId) || null }));
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/workers/:id/payrolls - Payroll history for one worker
  app.get("/api/factory/workers/:id/payrolls", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id);
      const payrolls = await db.select().from(factoryPayrolls)
        .where(and(eq(factoryPayrolls.workerId, id), eq(factoryPayrolls.companyId, companyId)))
        .orderBy(desc(factoryPayrolls.periodEnd));
      res.json(payrolls);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/payrolls/preview - Preview payroll calculation with attendance breakdown (no DB writes)
  app.post("/api/factory/payrolls/preview", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { workerIds, periodStart, periodEnd, daysCount, bonusPerWorker } = req.body;
      if (!periodStart || !periodEnd) return res.status(400).json({ message: "Period dates required" });

      const days = daysCount
        ? parseInt(daysCount)
        : Math.floor((new Date(periodEnd).getTime() - new Date(periodStart).getTime()) / (1000 * 60 * 60 * 24)) + 1;
      const bonus = parseFloat(bonusPerWorker || "0");

      let targetWorkers;
      if (workerIds && workerIds.length > 0) {
        targetWorkers = await db.select().from(factoryWorkers)
          .where(and(eq(factoryWorkers.companyId, companyId), inArray(factoryWorkers.id, workerIds)));
      } else {
        targetWorkers = await db.select().from(factoryWorkers)
          .where(and(eq(factoryWorkers.companyId, companyId), eq(factoryWorkers.active, true)));
      }

      // Fetch all attendance records for the period in one query
      const workerIdList = targetWorkers.map((w: any) => w.id);
      const attendanceRecords = workerIdList.length
        ? await db.select().from(factoryAttendance).where(
            and(
              eq(factoryAttendance.companyId, companyId),
              gte(factoryAttendance.attendanceDate, periodStart),
              lte(factoryAttendance.attendanceDate, periodEnd),
              inArray(factoryAttendance.workerId, workerIdList)
            )
          )
        : [];

      const attendanceByWorker = new Map<number, any[]>();
      for (const att of attendanceRecords) {
        const list = attendanceByWorker.get(att.workerId) || [];
        list.push(att);
        attendanceByWorker.set(att.workerId, list);
      }

      // Outstanding advances (salary deduction type)
      const allAdvances = await db.select().from(factoryWorkerAdvances)
        .where(and(
          eq(factoryWorkerAdvances.companyId, companyId),
          eq(factoryWorkerAdvances.fullyPaid, false),
          eq(factoryWorkerAdvances.repaymentType, "salary_deduction")
        ))
        .orderBy(factoryWorkerAdvances.advanceDate);
      const advanceByWorker: Record<number, number> = {};
      const advanceListByWorker: Record<number, typeof allAdvances> = {};
      for (const adv of allAdvances) {
        advanceByWorker[adv.workerId] = (advanceByWorker[adv.workerId] || 0) + parseFloat(adv.remainingBalance || "0");
        if (!advanceListByWorker[adv.workerId]) advanceListByWorker[adv.workerId] = [];
        advanceListByWorker[adv.workerId].push(adv);
      }

      // Count weekdays in period for totalWorkingDays
      let totalWorkingDays = 0;
      const cur = new Date(periodStart + "T00:00:00");
      const periodEndDate = new Date(periodEnd + "T00:00:00");
      while (cur <= periodEndDate) {
        const dow = cur.getDay();
        if (dow !== 0 && dow !== 6) totalWorkingDays++;
        cur.setDate(cur.getDate() + 1);
      }

      const result = targetWorkers.map((worker: any) => {
        const baseSal = parseFloat(worker.baseSalary || "0");
        const freq = worker.payFrequency || worker.salaryType || "Monthly";
        let base = 0;
        if (freq === "Weekly") base = (days / 7) * baseSal;
        else if (freq === "Bi-Weekly") base = (days / 14) * baseSal;
        else if (freq === "Daily" || worker.salaryType === "Daily") base = days * baseSal;
        else {
          // Monthly: use attendance-based calculation if records exist
          const workerAttRecords = attendanceByWorker.get(worker.id) || [];
          if (workerAttRecords.length === 0) {
            base = computeMonthlyPay(baseSal, periodStart, periodEnd);
          } else {
            base = computeMonthlyPayFromAttendance(baseSal, periodStart, workerAttRecords);
          }
        }

        const totalAdvanceBalance = advanceByWorker[worker.id] || 0;
        const advanceDeduction = Math.min(totalAdvanceBalance, base + bonus);
        const net = base + bonus - advanceDeduction;
        const pendingAdvances = (advanceListByWorker[worker.id] || []).map((a) => ({
          id: a.id,
          advanceDate: a.advanceDate,
          amount: a.amount,
          remainingBalance: a.remainingBalance,
          notes: a.notes,
        }));

        const workerAtt = attendanceByWorker.get(worker.id) || [];
        let presentDays = 0;
        let absentDays = 0;
        const presentDates: { date: string; status: string }[] = [];
        const absentDates: { date: string; status: string }[] = [];
        const halfDayDates: { date: string; status: string }[] = [];

        for (const att of workerAtt) {
          const entry = { date: att.attendanceDate, status: att.status };
          if (att.status === "Present" || att.status === "Late" || att.status === "Leave") {
            presentDays += 1;
            presentDates.push(entry);
          } else if (att.status === "Half Day") {
            presentDays += 0.5;
            absentDays += 0.5;
            halfDayDates.push(entry);
          } else if (att.status === "Absent") {
            absentDays += 1;
            absentDates.push(entry);
          }
        }

        // Sort dates ascending
        presentDates.sort((a, b) => a.date.localeCompare(b.date));
        absentDates.sort((a, b) => a.date.localeCompare(b.date));
        halfDayDates.sort((a, b) => a.date.localeCompare(b.date));

        return {
          id: worker.id,
          name: worker.fullName,
          position: worker.position || null,
          base,
          bonus,
          advanceDeduction,
          totalAdvanceBalance,
          pendingAdvances,
          net,
          totalWorkingDays,
          presentDays,
          absentDays,
          presentDates,
          absentDates,
          halfDayDates,
        };
      });

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/payrolls/generate-bulk - Generate draft payrolls for multiple workers
  app.post("/api/factory/payrolls/generate-bulk", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { workerIds, periodStart, periodEnd, daysCount, bonusPerWorker, cashAccountId, notes, advanceOverrides } = req.body;
      if (!periodStart || !periodEnd) return res.status(400).json({ message: "Period dates required" });
      // advanceOverrides: { [workerId: string]: number } — user-approved deduction per worker

      const days = daysCount ? parseInt(daysCount) : Math.floor((new Date(periodEnd).getTime() - new Date(periodStart).getTime()) / (1000 * 60 * 60 * 24)) + 1;
      const bonus = parseFloat(bonusPerWorker || "0");

      let targetWorkers;
      if (workerIds && workerIds.length > 0) {
        targetWorkers = await db.select().from(factoryWorkers).where(and(eq(factoryWorkers.companyId, companyId), inArray(factoryWorkers.id, workerIds)));
      } else {
        targetWorkers = await db.select().from(factoryWorkers).where(and(eq(factoryWorkers.companyId, companyId), eq(factoryWorkers.active, true)));
      }

      const daysInMonth = (d: string) => { const dt = new Date(d); return new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate(); };

      // Fetch all attendance records for the period (for monthly attendance-based calculation)
      const workerIdList = targetWorkers.map((w: any) => w.id);
      const attendanceRecords = workerIdList.length
        ? await db.select().from(factoryAttendance).where(
            and(
              eq(factoryAttendance.companyId, companyId),
              gte(factoryAttendance.attendanceDate, periodStart),
              lte(factoryAttendance.attendanceDate, periodEnd),
              inArray(factoryAttendance.workerId, workerIdList)
            )
          )
        : [];
      const attendanceByWorker = new Map<number, any[]>();
      for (const att of attendanceRecords) {
        const list = attendanceByWorker.get(att.workerId) || [];
        list.push(att);
        attendanceByWorker.set(att.workerId, list);
      }

      const allOutstandingAdvances = await db.select().from(factoryWorkerAdvances)
        .where(and(eq(factoryWorkerAdvances.companyId, companyId), eq(factoryWorkerAdvances.fullyPaid, false), eq(factoryWorkerAdvances.repaymentType, "salary_deduction")));
      const advanceByWorker: Record<number, number> = {};
      for (const adv of allOutstandingAdvances) {
        advanceByWorker[adv.workerId] = (advanceByWorker[adv.workerId] || 0) + parseFloat(adv.remainingBalance || "0");
      }

      // Pre-resolve ledger accounts OUTSIDE the transaction to prevent concurrent insert conflicts
      const [expenseAcc, payableAccGen] = await Promise.all([
        findOrCreateLedger(companyId, "Factory Worker Payroll", "Expense"),
        findOrCreateLedger(companyId, "Payroll Payable", "Liability"),
      ]);

      const created = await db.transaction(async (tx: any) => {
        let count = 0;
        let totalNet = 0;
        for (const worker of targetWorkers) {
          const baseSal = parseFloat(worker.baseSalary || "0");
          const freq = (worker as any).payFrequency || worker.salaryType || "Monthly";
          let base = 0;
          if (freq === "Weekly") base = (days / 7) * parseFloat((worker as any).weeklySalary || baseSal.toString());
          else if (freq === "Bi-Weekly") base = (days / 14) * parseFloat((worker as any).biWeeklySalary || baseSal.toString());
          else if (freq === "Daily" || worker.salaryType === "Daily") base = days * baseSal;
          else {
            // Monthly: use attendance-based calculation if records exist
            const workerAttRecords = attendanceByWorker.get(worker.id) || [];
            if (workerAttRecords.length === 0) {
              base = computeMonthlyPay(baseSal, periodStart, periodEnd);
            } else {
              base = computeMonthlyPayFromAttendance(baseSal, periodStart, workerAttRecords);
            }
          }
          const workerAdvanceBalance = advanceByWorker[worker.id] || 0;
          // Use user-approved override if provided, otherwise auto-deduct full balance
          const overrideAmt = advanceOverrides ? parseFloat(advanceOverrides[String(worker.id)] ?? "-1") : -1;
          const advanceDeduction = overrideAmt >= 0
            ? Math.min(overrideAmt, base + bonus, workerAdvanceBalance)
            : Math.min(workerAdvanceBalance, base + bonus);
          const net = base + bonus - advanceDeduction;
          await tx.insert(factoryPayrolls).values({
            companyId, workerId: worker.id, periodStart, periodEnd,
            baseSalary: base.toFixed(2), bonuses: bonus.toFixed(2),
            baleEarnings: "0", kgEarnings: "0", overtimePay: "0", deductions: "0",
            advances: advanceDeduction.toFixed(2),
            netSalary: net.toFixed(2), balesCount: 0, kgProcessed: "0", overtimeHours: "0",
            status: "DRAFT", notes: notes || null,
            cashAccountId: cashAccountId ? parseInt(cashAccountId) : null,
          } as any);
          // Settle advances immediately at generate time so remaining balance updates right away
          await settleAdvancesForPayroll(tx, companyId, worker.id, advanceDeduction);
          totalNet += net;
          count++;
        }
        // Accounting: Dr Payroll Expense / Cr Payroll Payable
        if (totalNet > 0) {
          const payableAcc = payableAccGen;
          const desc = `Payroll expense: ${count} worker${count !== 1 ? "s" : ""} (${periodStart} – ${periodEnd})`;
          const [genVoucher] = await tx.insert(vouchers).values({
            companyId,
            voucherNumber: `PAYROLL-GEN-${Date.now()}`,
            voucherType: "Journal",
            voucherDate: periodStart,
            description: desc,
            totalAmount: totalNet.toFixed(2),
            currency: "USD",
            sourceModule: "FACTORY",
          }).returning();
          await tx.insert(voucherEntries).values([
            { voucherId: genVoucher.id, ledgerAccountId: expenseAcc.id, debitAmount: totalNet.toFixed(2), creditAmount: "0", narration: desc },
            { voucherId: genVoucher.id, ledgerAccountId: payableAcc.id, debitAmount: "0", creditAmount: totalNet.toFixed(2), narration: desc },
          ]);
        }
        await writeDaybookEntry(tx, {
          companyId,
          txDate: periodStart,
          txType: "PAYROLL_GENERATED",
          description: `Payroll generated: ${count} worker${count !== 1 ? "s" : ""} for period ${periodStart} – ${periodEnd}`,
          amountCurrency: totalNet,
          amountUsd: totalNet,
        });
        return count;
      });
      res.json({ created });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // PATCH /api/factory/payrolls/:id/mark-paid - Mark single payroll as paid
  app.patch("/api/factory/payrolls/:id/mark-paid", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id);
      const cashAccountId = req.body.cashAccountId ? parseInt(req.body.cashAccountId) : null;

      // Pre-resolve ledger OUTSIDE the transaction to prevent concurrent insert conflicts
      const payableAccSingle = cashAccountId
        ? await findOrCreateLedger(companyId, "Payroll Payable", "Liability")
        : null;

      const updated = await db.transaction(async (tx: any) => {
        const [payroll] = await tx.update(factoryPayrolls)
          .set({ status: "PAID", paidAt: new Date(), cashAccountId } as any)
          .where(and(eq(factoryPayrolls.id, id), eq(factoryPayrolls.companyId, companyId)))
          .returning();
        if (!payroll) throw new Error("Payroll record not found");

        const [prWorker] = await tx.select({ fullName: factoryWorkers.fullName })
          .from(factoryWorkers).where(eq(factoryWorkers.id, payroll.workerId));
        const workerName = prWorker?.fullName?.trim() || `Worker #${payroll.workerId}`;
        const prToday = new Date().toISOString().split("T")[0];

        if (cashAccountId) {
          // Accounting: Dr Payroll Payable / Cr Cash (settling the liability created at run time)
          const payableAcc = payableAccSingle!;

          const netAmt = parseFloat(payroll.netSalary || "0");
          const narration = `Payroll payment: ${workerName} (${payroll.periodStart} – ${payroll.periodEnd})`;

          const [pVoucher] = await tx.insert(vouchers).values({
            companyId,
            voucherNumber: `PAYMENT-PAY-${payroll.id}-${Date.now()}`,
            voucherType: "Payment",
            voucherDate: prToday,
            description: narration,
            totalAmount: netAmt.toFixed(2),
            currency: "USD",
            sourceModule: "FACTORY",
          }).returning();

          await tx.insert(voucherEntries).values([
            {
              voucherId: pVoucher.id,
              ledgerAccountId: payableAcc.id,
              debitAmount: netAmt.toFixed(2),
              creditAmount: "0",
              narration,
            },
            {
              voucherId: pVoucher.id,
              ledgerAccountId: cashAccountId,
              debitAmount: "0",
              creditAmount: netAmt.toFixed(2),
              narration,
            },
          ]);
        }

        await writeDaybookEntry(tx, {
          companyId,
          txDate: prToday,
          txType: "PAYROLL_PAYMENT",
          referenceId: payroll.id,
          description: `Payroll paid: ${workerName} – ${parseFloat(payroll.netSalary || "0").toFixed(2)} (${payroll.periodStart} – ${payroll.periodEnd})`,
          amountCurrency: parseFloat(payroll.netSalary || "0"),
          amountUsd: parseFloat(payroll.netSalary || "0"),
        });

        return payroll;
      });

      res.json(updated);
    } catch (error: any) {
      if (error.message === "Payroll record not found") return res.status(404).json({ message: error.message });
      res.status(500).json({ message: error.message });
    }
  });

  async function settleAdvancesForPayroll(tx: any, companyId: number, workerId: number, advanceAmount: number) {
    if (advanceAmount <= 0) return;
    const outstanding = await tx.select().from(factoryWorkerAdvances)
      .where(and(
        eq(factoryWorkerAdvances.companyId, companyId),
        eq(factoryWorkerAdvances.workerId, workerId),
        eq(factoryWorkerAdvances.fullyPaid, false),
        eq(factoryWorkerAdvances.repaymentType, "salary_deduction"),
      ))
      .orderBy(factoryWorkerAdvances.advanceDate);
    let remaining = advanceAmount;
    for (const adv of outstanding) {
      if (remaining <= 0) break;
      const bal = parseFloat(adv.remainingBalance || "0");
      const reduce = Math.min(bal, remaining);
      const newBal = bal - reduce;
      await tx.update(factoryWorkerAdvances).set({
        remainingBalance: newBal.toFixed(2),
        fullyPaid: newBal <= 0,
      }).where(eq(factoryWorkerAdvances.id, adv.id));
      remaining -= reduce;
    }
  }

  // POST /api/factory/payrolls/mark-paid-bulk - Mark multiple payrolls as paid
  app.post("/api/factory/payrolls/mark-paid-bulk", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { payrollIds, cashAccountId } = req.body;
      if (!payrollIds?.length) return res.status(400).json({ message: "payrollIds required" });
      const cashId = cashAccountId ? parseInt(cashAccountId) : null;

      // Pre-resolve ledger OUTSIDE the transaction to prevent concurrent insert conflicts
      const payableAccBulk = cashId
        ? await findOrCreateLedger(companyId, "Payroll Payable", "Liability")
        : null;

      await db.transaction(async (tx: any) => {
        const payrollsToMark = await tx.select().from(factoryPayrolls)
          .where(and(eq(factoryPayrolls.companyId, companyId), inArray(factoryPayrolls.id, payrollIds)));

        await tx.update(factoryPayrolls)
          .set({ status: "PAID", paidAt: new Date(), cashAccountId: cashId } as any)
          .where(and(eq(factoryPayrolls.companyId, companyId), inArray(factoryPayrolls.id, payrollIds)));

        const bulkPrToday = new Date().toISOString().split("T")[0];

        // Accounting: Dr Payroll Payable / Cr Cash (settling liability created at run time)
        const payableAcc = payableAccBulk;

        const workerIds = [...new Set(payrollsToMark.map((p: any) => p.workerId))];
        const workerRows = await tx.select({ id: factoryWorkers.id, fullName: factoryWorkers.fullName })
          .from(factoryWorkers)
          .where(inArray(factoryWorkers.id, workerIds));
        const workerMap = new Map(workerRows.map((w: any) => [w.id, w.fullName]));

        for (const pr of payrollsToMark) {
          if (cashId && payableAcc) {
            const netAmt = parseFloat(pr.netSalary || "0");
            const workerName = (workerMap.get(pr.workerId) as string)?.trim() || `Worker #${pr.workerId}`;
            const narration = `Payroll payment: ${workerName} (${pr.periodStart} – ${pr.periodEnd})`;

            const [pVoucher] = await tx.insert(vouchers).values({
              companyId,
              voucherNumber: `PAYMENT-PAY-${pr.id}-${Date.now()}`,
              voucherType: "Payment",
              voucherDate: bulkPrToday,
              description: narration,
              totalAmount: netAmt.toFixed(2),
              currency: "USD",
              sourceModule: "FACTORY",
            }).returning();

            await tx.insert(voucherEntries).values([
              {
                voucherId: pVoucher.id,
                ledgerAccountId: payableAcc.id,
                debitAmount: netAmt.toFixed(2),
                creditAmount: "0",
                narration,
              },
              {
                voucherId: pVoucher.id,
                ledgerAccountId: cashId,
                debitAmount: "0",
                creditAmount: netAmt.toFixed(2),
                narration,
              },
            ]);
          }
        }

        await writeDaybookEntry(tx, {
          companyId,
          txDate: bulkPrToday,
          txType: "PAYROLL_PAYMENT",
          description: `Payroll bulk paid: ${payrollIds.length} worker${payrollIds.length !== 1 ? "s" : ""}`,
        });
      });

      res.json({ updated: payrollIds.length });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/payrolls/payment-summary-pdf - Compact payment summary PDF
  app.post("/api/factory/payrolls/payment-summary-pdf", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { payrollIds } = req.body;
      if (!payrollIds?.length) return res.status(400).json({ message: "payrollIds required" });

      const payrollRows = await db.select().from(factoryPayrolls)
        .where(and(eq(factoryPayrolls.companyId, companyId), inArray(factoryPayrolls.id, payrollIds)));
      if (!payrollRows.length) return res.status(404).json({ message: "No payroll records found" });

      const workerIdList = [...new Set(payrollRows.map((p: any) => p.workerId))];
      const workerRows = await db.select({ id: factoryWorkers.id, fullName: factoryWorkers.fullName })
        .from(factoryWorkers).where(inArray(factoryWorkers.id, workerIdList));
      const workerMap = new Map(workerRows.map((w: any) => [w.id, w.fullName]));

      const [companyRow] = await db.select({ name: companies.name })
        .from(companies).where(eq(companies.id, companyId));
      const companyName = companyRow?.name || "Company";

      const PDFDocument = (await import("pdfkit")).default;
      const doc = new PDFDocument({ margin: 40, size: "A4" });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => {
        const pdf = Buffer.concat(chunks);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="payment-summary.pdf"`);
        res.send(pdf);
      });

      // Header
      doc.fontSize(14).font("Helvetica-Bold").text(companyName, { align: "center" });
      doc.fontSize(10).font("Helvetica").text("Payment Summary", { align: "center" });
      doc.moveDown(0.3);
      doc.fontSize(8).fillColor("#666666")
        .text(`Generated: ${new Date().toLocaleDateString()}`, { align: "center" });
      doc.moveDown(0.8);

      // Period range
      const periods = [...new Set(payrollRows.map((p: any) => `${p.periodStart} – ${p.periodEnd}`))];
      doc.fontSize(8).fillColor("#333333").text(`Period: ${periods.join(", ")}`);
      doc.moveDown(0.5);

      // Table header
      const COL = { name: 40, present: 280, absent: 330, amount: 400 };
      const rowH = 18;
      const tableTop = doc.y;

      doc.rect(40, tableTop, 515, rowH).fill("#1F3864");
      doc.fillColor("#ffffff").fontSize(8).font("Helvetica-Bold");
      doc.text("Worker Name", COL.name, tableTop + 5, { width: 220 });
      doc.text("Present", COL.present, tableTop + 5, { width: 45, align: "center" });
      doc.text("Absent", COL.absent, tableTop + 5, { width: 45, align: "center" });
      doc.text("Amount", COL.amount, tableTop + 5, { width: 90, align: "right" });

      let y = tableTop + rowH;
      let totalAmt = 0;
      doc.font("Helvetica").fillColor("#000000");

      payrollRows.forEach((p: any, i: number) => {
        const name = (workerMap.get(p.workerId) as string) || `Worker #${p.workerId}`;
        const present = p.presentDays != null ? Number(p.presentDays) : "—";
        const absent = p.absentDays != null ? Number(p.absentDays) : "—";
        const net = parseFloat(p.netSalary || "0");
        totalAmt += net;

        if (i % 2 === 1) doc.rect(40, y, 515, rowH).fill("#f5f7fa");
        doc.fillColor("#000000").fontSize(8);
        doc.text(name, COL.name, y + 5, { width: 220 });
        doc.text(typeof present === "number" ? (present % 1 === 0 ? present.toFixed(0) : present.toFixed(1)) : "—", COL.present, y + 5, { width: 45, align: "center" });
        doc.text(typeof absent === "number" ? (absent % 1 === 0 ? absent.toFixed(0) : absent.toFixed(1)) : "—", COL.absent, y + 5, { width: 45, align: "center" });
        doc.text(net.toFixed(2), COL.amount, y + 5, { width: 90, align: "right" });
        y += rowH;
      });

      // Footer total
      doc.moveDown(0.5);
      doc.rect(40, y + 4, 515, rowH).fill("#1F3864");
      doc.fillColor("#ffffff").fontSize(9).font("Helvetica-Bold");
      doc.text("Total Amount Paid", COL.name, y + 9, { width: 340 });
      doc.text(totalAmt.toFixed(2), COL.amount, y + 9, { width: 90, align: "right" });

      doc.end();
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/workers/:id/stats - Get worker productivity stats
  app.get("/api/factory/workers/:id/stats", requireAuth, async (req: any, res: any) => {
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

      let estimatedEarnings = 0;
      const salaryType = worker.salaryType || "Monthly";

      if (salaryType === "Per Bale") {
        estimatedEarnings = totalBales * parseFloat(worker.perBaleRate || "0");
      } else if (salaryType === "Per KG") {
        estimatedEarnings = totalKg * parseFloat(worker.perKgRate || "0");
      } else if (salaryType === "Monthly" || salaryType === "Daily") {
        estimatedEarnings = parseFloat(worker.baseSalary || "0");
      }

      const payrolls = await db
        .select()
        .from(factoryPayrolls)
        .where(and(eq(factoryPayrolls.workerId, id), eq(factoryPayrolls.companyId, companyId)))
        .orderBy(desc(factoryPayrolls.periodEnd));

      const totalPaid = payrolls.reduce((sum: number, p: any) => sum + parseFloat(p.netSalary || "0"), 0);

      res.json({
        workerId: id,
        workerName: worker.fullName,
        salaryType,
        totalBales,
        totalKg: totalKg.toFixed(3),
        estimatedEarnings: estimatedEarnings.toFixed(2),
        totalPaid: totalPaid.toFixed(2),
        payrollCount: payrolls.length,
        recentPayrolls: payrolls.slice(0, 5),
      });
    } catch (error: any) {
      console.error("Error fetching worker stats:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ─── FACTORY WORKER ADVANCES ─────────────────────────────────────────

  // GET /api/factory/advance-repayments - List all repayments company-wide
  app.get("/api/factory/advance-repayments", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const conditions: any[] = [eq(factoryAdvanceRepayments.companyId, companyId)];
      if (req.query.workerId) conditions.push(eq(factoryAdvanceRepayments.workerId, parseInt(req.query.workerId as string)));

      const repayments = await db
        .select({
          id: factoryAdvanceRepayments.id,
          advanceId: factoryAdvanceRepayments.advanceId,
          workerId: factoryAdvanceRepayments.workerId,
          repaymentDate: factoryAdvanceRepayments.repaymentDate,
          amount: factoryAdvanceRepayments.amount,
          cashAccountId: factoryAdvanceRepayments.cashAccountId,
          notes: factoryAdvanceRepayments.notes,
          createdAt: factoryAdvanceRepayments.createdAt,
          advanceDate: factoryWorkerAdvances.advanceDate,
          advanceAmount: factoryWorkerAdvances.amount,
          advanceRemainingBalance: factoryWorkerAdvances.remainingBalance,
          workerName: factoryWorkers.fullName,
          cashAccountName: ledgerAccounts.name,
        })
        .from(factoryAdvanceRepayments)
        .innerJoin(factoryWorkerAdvances, eq(factoryAdvanceRepayments.advanceId, factoryWorkerAdvances.id))
        .innerJoin(factoryWorkers, eq(factoryAdvanceRepayments.workerId, factoryWorkers.id))
        .leftJoin(ledgerAccounts, eq(factoryAdvanceRepayments.cashAccountId, ledgerAccounts.id))
        .where(and(...conditions))
        .orderBy(desc(factoryAdvanceRepayments.repaymentDate));

      res.json(repayments);
    } catch (error: any) {
      console.error("Error fetching advance repayments:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/advances - List all advances for company
  app.get("/api/factory/advances", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const conditions: any[] = [eq(factoryWorkerAdvances.companyId, companyId)];
      if (req.query.workerId) conditions.push(eq(factoryWorkerAdvances.workerId, parseInt(req.query.workerId)));
      if (req.query.status === "outstanding") conditions.push(eq(factoryWorkerAdvances.fullyPaid, false));
      if (req.query.status === "paid") conditions.push(eq(factoryWorkerAdvances.fullyPaid, true));

      const advances = await db.select().from(factoryWorkerAdvances)
        .where(and(...conditions))
        .orderBy(desc(factoryWorkerAdvances.advanceDate));

      const workerIds = [...new Set(advances.map((a: any) => a.workerId))];
      let workerMap: Record<number, string> = {};
      if (workerIds.length > 0) {
        const workers = await db.select({ id: factoryWorkers.id, fullName: factoryWorkers.fullName })
          .from(factoryWorkers).where(inArray(factoryWorkers.id, workerIds));
        workerMap = Object.fromEntries(workers.map((w: any) => [w.id, w.fullName]));
      }

      const enriched = advances.map((a: any) => ({ ...a, workerName: workerMap[a.workerId] || `Worker #${a.workerId}` }));
      res.json(enriched);
    } catch (error: any) {
      console.error("Error fetching advances:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/workers/:id/advances - List advances for a specific worker
  app.get("/api/factory/workers/:id/advances", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const workerId = parseInt(req.params.id);

      const advances = await db.select().from(factoryWorkerAdvances)
        .where(and(eq(factoryWorkerAdvances.companyId, companyId), eq(factoryWorkerAdvances.workerId, workerId)))
        .orderBy(desc(factoryWorkerAdvances.advanceDate));

      res.json(advances);
    } catch (error: any) {
      console.error("Error fetching worker advances:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/workers/:id/advances - Record a new advance
  app.post("/api/factory/workers/:id/advances", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const workerId = parseInt(req.params.id);

      const amount = parseFloat(req.body.amount);
      if (!amount || amount <= 0) return res.status(400).json({ message: "Amount must be positive" });

      const [worker] = await db.select({ fullName: factoryWorkers.fullName })
        .from(factoryWorkers).where(and(eq(factoryWorkers.id, workerId), eq(factoryWorkers.companyId, companyId)));
      if (!worker) return res.status(404).json({ message: "Worker not found" });

      const advanceDate = req.body.advanceDate || new Date().toISOString().split("T")[0];
      const cashAccountId = req.body.cashAccountId ? parseInt(req.body.cashAccountId) : null;

      if (cashAccountId) {
        const [acct] = await db.select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.id, cashAccountId), eq(ledgerAccounts.companyId, companyId)));
        if (!acct) return res.status(400).json({ message: "Cash account not found for this company" });
      }

      const repaymentType = req.body.repaymentType === "manual_repayment" ? "manual_repayment" : "salary_deduction";

      const result = await db.transaction(async (tx: any) => {
        const [advance] = await tx.insert(factoryWorkerAdvances).values({
          companyId, workerId, advanceDate,
          amount: amount.toFixed(2),
          remainingBalance: amount.toFixed(2),
          cashAccountId,
          notes: req.body.notes || null,
          repaymentType,
        }).returning();

        let voucherId: number | null = null;

        if (cashAccountId) {
          let [advancesAccount] = await tx.select({ id: ledgerAccounts.id })
            .from(ledgerAccounts)
            .where(and(
              eq(ledgerAccounts.companyId, companyId),
              eq(ledgerAccounts.name, "Factory Worker Advances"),
            ));

          if (!advancesAccount) {
            const maxCodeResult = await tx.select({ maxCode: sql`MAX(CAST(code AS INTEGER))` })
              .from(ledgerAccounts)
              .where(and(eq(ledgerAccounts.companyId, companyId), sql`code ~ '^\d+$'`));
            const nextCode = String((parseInt(maxCodeResult[0]?.maxCode || "0") || 0) + 1);

            [advancesAccount] = await tx.insert(ledgerAccounts).values({
              companyId,
              code: nextCode,
              name: "Factory Worker Advances",
              accountType: "Asset",
              active: true,
              isHidden: false,
            }).returning();
          }

          const voucherNumber = `PAYMENT-ADV-${advance.id}-${Date.now()}`;
          const narration = `Advance to ${worker.fullName}: $${amount.toFixed(2)}`;

          const [createdVoucher] = await tx.insert(vouchers).values({
            companyId,
            voucherNumber,
            voucherType: "Payment",
            voucherDate: advanceDate,
            description: narration,
            totalAmount: amount.toFixed(2),
            currency: "USD",
            sourceModule: "FACTORY",
          }).returning();

          voucherId = createdVoucher.id;

          await tx.insert(voucherEntries).values([
            {
              voucherId: createdVoucher.id,
              ledgerAccountId: advancesAccount.id,
              debitAmount: amount.toFixed(2),
              creditAmount: "0",
              narration,
            },
            {
              voucherId: createdVoucher.id,
              ledgerAccountId: cashAccountId,
              debitAmount: "0",
              creditAmount: amount.toFixed(2),
              narration,
            },
          ]);
        }

        await writeDaybookEntry(tx, {
          companyId,
          txDate: advanceDate,
          txType: "ADVANCE_GIVEN",
          referenceId: advance.id,
          referenceTable: "factory_worker_advances",
          description: `Advance given to ${worker.fullName}: $${amount.toFixed(2)}`,
          amountCurrency: amount,
          amountUsd: amount,
          createdBy: (req.session as any).userId ? parseInt((req.session as any).userId) : undefined,
        });

        return { ...advance, voucherId, workerName: worker.fullName };
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error creating advance:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/advances/bulk - Record advances for multiple workers at once
  app.post("/api/factory/advances/bulk", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { items, advanceDate, cashAccountId: rawCashAccountId, repaymentType: rawRepaymentType, notes } = req.body;
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "No items provided" });
      }

      const advDate = advanceDate || new Date().toISOString().split("T")[0];
      const cashAccountId = rawCashAccountId ? parseInt(rawCashAccountId) : null;
      const repaymentType = rawRepaymentType === "manual_repayment" ? "manual_repayment" : "salary_deduction";

      if (cashAccountId) {
        const [acct] = await db.select({ id: ledgerAccounts.id }).from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.id, cashAccountId), eq(ledgerAccounts.companyId, companyId)));
        if (!acct) return res.status(400).json({ message: "Cash account not found for this company" });
      }

      const results = await db.transaction(async (tx: any) => {
        // Resolve or create the "Factory Worker Advances" ledger account once
        let advancesAccountId: number | null = null;
        if (cashAccountId) {
          let [advancesAccount] = await tx.select({ id: ledgerAccounts.id }).from(ledgerAccounts)
            .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.name, "Factory Worker Advances")));
          if (!advancesAccount) {
            const maxCodeResult = await tx.select({ maxCode: sql`MAX(CAST(code AS INTEGER))` })
              .from(ledgerAccounts)
              .where(and(eq(ledgerAccounts.companyId, companyId), sql`code ~ '^\d+$'`));
            const nextCode = String((parseInt(maxCodeResult[0]?.maxCode || "0") || 0) + 1);
            [advancesAccount] = await tx.insert(ledgerAccounts).values({
              companyId, code: nextCode, name: "Factory Worker Advances",
              accountType: "Asset", active: true, isHidden: false,
            }).returning();
          }
          advancesAccountId = advancesAccount.id;
        }

        const created: any[] = [];
        for (const item of items) {
          const workerId = parseInt(item.workerId);
          const amount = parseFloat(item.amount);
          if (!workerId || !amount || amount <= 0) continue;

          const [worker] = await tx.select({ fullName: factoryWorkers.fullName }).from(factoryWorkers)
            .where(and(eq(factoryWorkers.id, workerId), eq(factoryWorkers.companyId, companyId)));
          if (!worker) continue;

          const [advance] = await tx.insert(factoryWorkerAdvances).values({
            companyId, workerId, advanceDate: advDate,
            amount: amount.toFixed(2),
            remainingBalance: amount.toFixed(2),
            cashAccountId,
            notes: notes || null,
            repaymentType,
          }).returning();

          if (cashAccountId && advancesAccountId) {
            const narration = `Advance to ${worker.fullName}: $${amount.toFixed(2)}`;
            const voucherNumber = `PAYMENT-ADV-${advance.id}-${Date.now()}`;
            const [createdVoucher] = await tx.insert(vouchers).values({
              companyId, voucherNumber, voucherType: "Payment",
              voucherDate: advDate, description: narration,
              totalAmount: amount.toFixed(2), currency: "USD", sourceModule: "FACTORY",
            }).returning();
            await tx.insert(voucherEntries).values([
              { voucherId: createdVoucher.id, ledgerAccountId: advancesAccountId, debitAmount: amount.toFixed(2), creditAmount: "0", narration },
              { voucherId: createdVoucher.id, ledgerAccountId: cashAccountId, debitAmount: "0", creditAmount: amount.toFixed(2), narration },
            ]);
          }

          await writeDaybookEntry(tx, {
            companyId, txDate: advDate, txType: "ADVANCE_GIVEN",
            referenceId: advance.id, referenceTable: "factory_worker_advances",
            description: `Advance given to ${worker.fullName}: $${amount.toFixed(2)}`,
            amountCurrency: amount, amountUsd: amount,
            createdBy: (req.session as any).userId ? parseInt((req.session as any).userId) : undefined,
          });

          created.push({ ...advance, workerName: worker.fullName });
        }
        return created;
      });

      res.json({ created: results.length, advances: results });
    } catch (error: any) {
      console.error("Error creating bulk advances:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // PATCH /api/factory/advances/:id - Edit advance (admin/owner only)
  app.patch("/api/factory/advances/:id", requireAuth, async (req: any, res: any) => {
    try {
      const currentRole = (req.session as any).currentRole;
      if (currentRole !== "Admin" && currentRole !== "Owner") {
        return res.status(403).json({ message: "Only Admin or Owner can edit advances" });
      }
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id);

      const updates: any = {};
      if (req.body.notes !== undefined) updates.notes = req.body.notes;
      if (req.body.advanceDate) updates.advanceDate = req.body.advanceDate;

      const [updated] = await db.update(factoryWorkerAdvances).set(updates)
        .where(and(eq(factoryWorkerAdvances.id, id), eq(factoryWorkerAdvances.companyId, companyId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Advance not found" });
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating advance:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // DELETE /api/factory/advances/:id - Delete advance (admin/owner only)
  app.delete("/api/factory/advances/:id", requireAuth, async (req: any, res: any) => {
    try {
      const currentRole = (req.session as any).currentRole;
      if (currentRole !== "Admin" && currentRole !== "Owner") {
        return res.status(403).json({ message: "Only Admin or Owner can delete advances" });
      }
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id);

      const [advance] = await db.select().from(factoryWorkerAdvances)
        .where(and(eq(factoryWorkerAdvances.id, id), eq(factoryWorkerAdvances.companyId, companyId)));
      if (!advance) return res.status(404).json({ message: "Advance not found" });

      const [worker] = await db.select({ fullName: factoryWorkers.fullName })
        .from(factoryWorkers).where(eq(factoryWorkers.id, advance.workerId));

      const today = new Date().toISOString().split("T")[0];

      await db.transaction(async (tx: any) => {
        const repayments = await tx.select().from(factoryAdvanceRepayments)
          .where(eq(factoryAdvanceRepayments.advanceId, id));

        if (repayments.length > 0) {
          await tx.delete(factoryAdvanceRepayments)
            .where(eq(factoryAdvanceRepayments.advanceId, id));
        }

        await tx.delete(factoryWorkerAdvances)
          .where(and(eq(factoryWorkerAdvances.id, id), eq(factoryWorkerAdvances.companyId, companyId)));

        const repayNote = repayments.length > 0 ? ` (${repayments.length} repayment(s) also removed)` : "";
        await writeDaybookEntry(tx, {
          companyId,
          txDate: today,
          txType: "ADVANCE_DELETED",
          referenceId: id,
          referenceTable: "factory_worker_advances",
          description: `Advance deleted for ${worker?.fullName || "Unknown"}: $${parseFloat(advance.amount).toFixed(2)}${repayNote}`,
          createdBy: (req.session as any).userId ? parseInt((req.session as any).userId) : undefined,
        });
      });

      res.json({ message: "Advance deleted" });
    } catch (error: any) {
      console.error("Error deleting advance:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/advances/unvouchered", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const allAdvances = await db.select({
        id: factoryWorkerAdvances.id,
        workerId: factoryWorkerAdvances.workerId,
        advanceDate: factoryWorkerAdvances.advanceDate,
        amount: factoryWorkerAdvances.amount,
        remainingBalance: factoryWorkerAdvances.remainingBalance,
        cashAccountId: factoryWorkerAdvances.cashAccountId,
        notes: factoryWorkerAdvances.notes,
        repaymentType: factoryWorkerAdvances.repaymentType,
        workerName: factoryWorkers.fullName,
      })
        .from(factoryWorkerAdvances)
        .innerJoin(factoryWorkers, eq(factoryWorkerAdvances.workerId, factoryWorkers.id))
        .where(eq(factoryWorkerAdvances.companyId, companyId))
        .orderBy(desc(factoryWorkerAdvances.advanceDate));

      const existingVoucherAdvanceIds = await db.select({ voucherNumber: vouchers.voucherNumber })
        .from(vouchers)
        .where(and(
          eq(vouchers.companyId, companyId),
          sql`${vouchers.voucherNumber} LIKE 'PAYMENT-ADV-%'`,
        ));

      const voucheredIds = new Set<number>();
      for (const v of existingVoucherAdvanceIds) {
        const match = v.voucherNumber.match(/^PAYMENT-ADV-(\d+)-/);
        if (match) voucheredIds.add(parseInt(match[1]));
      }

      const unvouchered = allAdvances.filter((a) => !voucheredIds.has(a.id) || a.cashAccountId === null);

      res.json(unvouchered);
    } catch (error: any) {
      console.error("Error fetching unvouchered advances:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/advances/post-accounting", requireAuth, async (req: any, res: any) => {
    try {
      const currentRole = (req.session as any).currentRole;
      if (currentRole !== "Admin" && currentRole !== "Owner") {
        return res.status(403).json({ message: "Only Admin or Owner can post accounting" });
      }
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const cashAccountId = req.body.cashAccountId ? parseInt(req.body.cashAccountId) : null;
      if (!cashAccountId) return res.status(400).json({ message: "Cash account is required" });

      const [acct] = await db.select({ id: ledgerAccounts.id })
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.id, cashAccountId), eq(ledgerAccounts.companyId, companyId)));
      if (!acct) return res.status(400).json({ message: "Cash account not found for this company" });

      const result = await db.transaction(async (tx: any) => {
        const allAdvances = await tx.select({
          id: factoryWorkerAdvances.id,
          amount: factoryWorkerAdvances.amount,
          advanceDate: factoryWorkerAdvances.advanceDate,
          workerId: factoryWorkerAdvances.workerId,
          cashAccountId: factoryWorkerAdvances.cashAccountId,
          workerName: factoryWorkers.fullName,
        })
          .from(factoryWorkerAdvances)
          .innerJoin(factoryWorkers, eq(factoryWorkerAdvances.workerId, factoryWorkers.id))
          .where(eq(factoryWorkerAdvances.companyId, companyId));

        const existingVouchers = await tx.select({ voucherNumber: vouchers.voucherNumber })
          .from(vouchers)
          .where(and(
            eq(vouchers.companyId, companyId),
            sql`${vouchers.voucherNumber} LIKE 'PAYMENT-ADV-%'`,
          ));
        const alreadyPostedIds = new Set<number>();
        for (const v of existingVouchers) {
          const match = v.voucherNumber.match(/^PAYMENT-ADV-(\d+)-/);
          if (match) alreadyPostedIds.add(parseInt(match[1]));
        }

        const eligible = allAdvances.filter((a: any) => !alreadyPostedIds.has(a.id) || a.cashAccountId === null);
        const eligibleIds = new Set(eligible.map((a: any) => a.id));

        if (eligibleIds.size === 0) {
          return { posted: 0, skipped: 0 };
        }

        let [advancesAccount] = await tx.select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(and(
            eq(ledgerAccounts.companyId, companyId),
            eq(ledgerAccounts.name, "Factory Worker Advances"),
          ));

        if (!advancesAccount) {
          const maxCodeResult = await tx.select({ maxCode: sql`MAX(CAST(code AS INTEGER))` })
            .from(ledgerAccounts)
            .where(and(eq(ledgerAccounts.companyId, companyId), sql`code ~ '^\d+$'`));
          const nextCode = String((parseInt(maxCodeResult[0]?.maxCode || "0") || 0) + 1);

          [advancesAccount] = await tx.insert(ledgerAccounts).values({
            companyId,
            code: nextCode,
            name: "Factory Worker Advances",
            accountType: "Asset",
            active: true,
            isHidden: false,
          }).returning();
        }

        let posted = 0;
        let skipped = 0;
        for (const adv of eligible) {
          if (alreadyPostedIds.has(adv.id)) {
            if (adv.cashAccountId === null) {
              await tx.update(factoryWorkerAdvances)
                .set({ cashAccountId: cashAccountId })
                .where(eq(factoryWorkerAdvances.id, adv.id));
            }
            skipped++;
            continue;
          }

          const amount = parseFloat(adv.amount);
          const voucherNumber = `PAYMENT-ADV-${adv.id}-${Date.now()}`;
          const narration = `Advance to ${adv.workerName}: $${amount.toFixed(2)} (retroactive)`;

          const [createdVoucher] = await tx.insert(vouchers).values({
            companyId,
            voucherNumber,
            voucherType: "Payment",
            voucherDate: adv.advanceDate,
            description: narration,
            totalAmount: amount.toFixed(2),
            currency: "USD",
            sourceModule: "FACTORY",
          }).returning();

          await tx.insert(voucherEntries).values([
            {
              voucherId: createdVoucher.id,
              ledgerAccountId: advancesAccount.id,
              debitAmount: amount.toFixed(2),
              creditAmount: "0",
              narration,
            },
            {
              voucherId: createdVoucher.id,
              ledgerAccountId: cashAccountId,
              debitAmount: "0",
              creditAmount: amount.toFixed(2),
              narration,
            },
          ]);

          await tx.update(factoryWorkerAdvances)
            .set({ cashAccountId: cashAccountId })
            .where(eq(factoryWorkerAdvances.id, adv.id));

          posted++;
        }

        return { posted, skipped };
      });

      res.json({ message: `Posted accounting for ${result.posted} advance(s)${result.skipped ? ` (${result.skipped} already posted, skipped)` : ""}`, posted: result.posted, skipped: result.skipped });
    } catch (error: any) {
      console.error("Error posting advance accounting:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/workers/:id/advance-balance - Get total outstanding advance balance
  app.get("/api/factory/workers/:id/advance-balance", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const workerId = parseInt(req.params.id);

      const outstanding = await db.select().from(factoryWorkerAdvances)
        .where(and(
          eq(factoryWorkerAdvances.companyId, companyId),
          eq(factoryWorkerAdvances.workerId, workerId),
          eq(factoryWorkerAdvances.fullyPaid, false),
        ));

      const totalBalance = outstanding.reduce((s: number, a: any) => s + parseFloat(a.remainingBalance || "0"), 0);
      res.json({ totalBalance: totalBalance.toFixed(2), count: outstanding.length });
    } catch (error: any) {
      console.error("Error fetching advance balance:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ─── ADVANCE REPAYMENTS ─────────────────────────────────────────

  app.get("/api/factory/advances/:id/repayments", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const advanceId = parseInt(req.params.id);

      const [advance] = await db.select().from(factoryWorkerAdvances)
        .where(and(eq(factoryWorkerAdvances.id, advanceId), eq(factoryWorkerAdvances.companyId, companyId)));
      if (!advance) return res.status(404).json({ message: "Advance not found" });

      const repayments = await db.select().from(factoryAdvanceRepayments)
        .where(and(eq(factoryAdvanceRepayments.advanceId, advanceId), eq(factoryAdvanceRepayments.companyId, companyId)))
        .orderBy(desc(factoryAdvanceRepayments.repaymentDate));

      res.json(repayments);
    } catch (error: any) {
      console.error("Error fetching advance repayments:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/advances/:id/repayments", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const advanceId = parseInt(req.params.id);

      const [advance] = await db.select().from(factoryWorkerAdvances)
        .where(and(eq(factoryWorkerAdvances.id, advanceId), eq(factoryWorkerAdvances.companyId, companyId)));
      if (!advance) return res.status(404).json({ message: "Advance not found" });
      if (advance.repaymentType !== "manual_repayment") {
        return res.status(400).json({ message: "Only manual repayment advances can receive repayments" });
      }
      if (advance.fullyPaid) {
        return res.status(400).json({ message: "This advance is already fully paid" });
      }

      const amount = parseFloat(req.body.amount);
      if (!amount || amount <= 0) return res.status(400).json({ message: "Amount must be positive" });

      const bal = parseFloat(advance.remainingBalance || "0");
      if (amount > bal + 0.01) {
        return res.status(400).json({ message: `Repayment ($${amount.toFixed(2)}) exceeds remaining balance ($${bal.toFixed(2)})` });
      }
      const effectiveAmount = Math.min(amount, bal);

      const repaymentDate = req.body.repaymentDate || new Date().toISOString().split("T")[0];
      const cashAccountId = req.body.cashAccountId ? parseInt(req.body.cashAccountId) : null;

      if (cashAccountId) {
        const [acct] = await db.select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.id, cashAccountId), eq(ledgerAccounts.companyId, companyId)));
        if (!acct) return res.status(400).json({ message: "Cash account not found" });
      }

      const [worker] = await db.select({ fullName: factoryWorkers.fullName })
        .from(factoryWorkers).where(eq(factoryWorkers.id, advance.workerId));

      const result = await db.transaction(async (tx: any) => {
        const [repayment] = await tx.insert(factoryAdvanceRepayments).values({
          companyId,
          advanceId,
          workerId: advance.workerId,
          repaymentDate,
          amount: effectiveAmount.toFixed(2),
          cashAccountId,
          notes: req.body.notes || null,
        }).returning();

        const newBalance = bal - effectiveAmount;
        const isFullyPaid = newBalance <= 0.005;

        await tx.update(factoryWorkerAdvances).set({
          remainingBalance: Math.max(0, newBalance).toFixed(2),
          fullyPaid: isFullyPaid,
        }).where(eq(factoryWorkerAdvances.id, advanceId));

        if (cashAccountId) {
          let [advancesAccount] = await tx.select({ id: ledgerAccounts.id })
            .from(ledgerAccounts)
            .where(and(
              eq(ledgerAccounts.companyId, companyId),
              eq(ledgerAccounts.name, "Factory Worker Advances"),
            ));

          if (!advancesAccount) {
            const maxCodeResult = await tx.select({ maxCode: sql`MAX(CAST(code AS INTEGER))` })
              .from(ledgerAccounts)
              .where(and(eq(ledgerAccounts.companyId, companyId), sql`code ~ '^\\d+$'`));
            const nextCode = String((parseInt(maxCodeResult[0]?.maxCode || "0") || 0) + 1);
            [advancesAccount] = await tx.insert(ledgerAccounts).values({
              companyId, code: nextCode, name: "Factory Worker Advances",
              accountType: "Asset", active: true, isHidden: false,
            }).returning();
          }

          const voucherNumber = `RECEIPT-REPAY-${repayment.id}-${Date.now()}`;
          const narration = `Advance repayment from ${worker?.fullName || "Worker"}: $${effectiveAmount.toFixed(2)}`;

          const [createdVoucher] = await tx.insert(vouchers).values({
            companyId, voucherNumber, voucherType: "Receipt",
            voucherDate: repaymentDate, description: narration,
            totalAmount: effectiveAmount.toFixed(2), currency: "USD",
            sourceModule: "FACTORY",
          }).returning();

          const repayNarration = `Advance repayment from ${worker?.fullName || "Worker"}: $${effectiveAmount.toFixed(2)}`;
          await tx.insert(voucherEntries).values([
            {
              voucherId: createdVoucher.id,
              ledgerAccountId: cashAccountId,
              debitAmount: effectiveAmount.toFixed(2),
              creditAmount: "0",
              narration: repayNarration,
            },
            {
              voucherId: createdVoucher.id,
              ledgerAccountId: advancesAccount.id,
              debitAmount: "0",
              creditAmount: effectiveAmount.toFixed(2),
              narration: repayNarration,
            },
          ]);
        }

        await writeDaybookEntry(tx, {
          companyId, txDate: repaymentDate,
          txType: "ADVANCE_REPAYMENT",
          referenceId: repayment.id,
          referenceTable: "factory_advance_repayments",
          description: `Advance repayment from ${worker?.fullName || "Worker"}: $${effectiveAmount.toFixed(2)} (advance #${advanceId})`,
          amountCurrency: effectiveAmount,
          currencyCode: "USD",
          amountUsd: effectiveAmount,
          createdBy: (req.session as any).userId ? parseInt((req.session as any).userId) : undefined,
        });

        const [updatedAdvance] = await tx.select().from(factoryWorkerAdvances)
          .where(eq(factoryWorkerAdvances.id, advanceId));

        return { repayment, advance: updatedAdvance };
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error recording advance repayment:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/factory/advance-repayments/:id", requireAuth, async (req: any, res: any) => {
    try {
      const currentRole = (req.session as any).currentRole;
      if (currentRole !== "Admin" && currentRole !== "Owner") {
        return res.status(403).json({ message: "Only Admin or Owner can delete repayments" });
      }
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const repaymentId = parseInt(req.params.id);

      const [repayment] = await db.select().from(factoryAdvanceRepayments)
        .where(and(eq(factoryAdvanceRepayments.id, repaymentId), eq(factoryAdvanceRepayments.companyId, companyId)));
      if (!repayment) return res.status(404).json({ message: "Repayment not found" });

      const [advance] = await db.select().from(factoryWorkerAdvances)
        .where(eq(factoryWorkerAdvances.id, repayment.advanceId));

      const repayAmt = parseFloat(repayment.amount || "0");
      const currentBal = parseFloat(advance?.remainingBalance || "0");
      const restoredBal = currentBal + repayAmt;

      await db.transaction(async (tx: any) => {
        await tx.delete(factoryAdvanceRepayments)
          .where(eq(factoryAdvanceRepayments.id, repaymentId));

        if (advance) {
          await tx.update(factoryWorkerAdvances).set({
            remainingBalance: restoredBal.toFixed(2),
            fullyPaid: false,
          }).where(eq(factoryWorkerAdvances.id, advance.id));
        }
      });

      const [worker] = await db.select({ fullName: factoryWorkers.fullName })
        .from(factoryWorkers).where(eq(factoryWorkers.id, repayment.workerId));

      await writeDaybookEntry(db, {
        companyId, txDate: new Date().toISOString().split("T")[0],
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
      if (currentRole !== "Admin" && currentRole !== "Owner") {
        return res.status(403).json({ message: "Only Admin or Owner can run backfill" });
      }

      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const paidPayrolls = await db.select({
        id: factoryPayrolls.id,
        companyId: factoryPayrolls.companyId,
        workerId: factoryPayrolls.workerId,
        netSalary: factoryPayrolls.netSalary,
        cashAccountId: factoryPayrolls.cashAccountId,
        periodStart: factoryPayrolls.periodStart,
        periodEnd: factoryPayrolls.periodEnd,
        paidAt: factoryPayrolls.paidAt,
      }).from(factoryPayrolls)
        .where(and(
          eq(factoryPayrolls.companyId, companyId),
          eq(factoryPayrolls.status, "PAID"),
          isNotNull(factoryPayrolls.cashAccountId),
        ));

      const existingVouchers = await db.select({
        voucherNumber: vouchers.voucherNumber,
      }).from(vouchers)
        .where(and(
          eq(vouchers.sourceModule, "FACTORY"),
          eq(vouchers.voucherType, "Payment"),
          sql`${vouchers.voucherNumber} LIKE 'PAYMENT-PAY-%'`,
        ));

      const existingPayrollIds = new Set(
        existingVouchers.map((v: any) => {
          const parts = v.voucherNumber.split("-");
          return parseInt(parts[2]);
        }).filter((id: number) => !isNaN(id))
      );

      const toBackfill = paidPayrolls.filter((p: any) => {
        const net = parseFloat(p.netSalary || "0");
        return net > 0 && !existingPayrollIds.has(p.id);
      });

      const skipped = paidPayrolls.filter((p: any) => {
        const net = parseFloat(p.netSalary || "0");
        return net <= 0 || existingPayrollIds.has(p.id);
      }).map((p: any) => p.id);

      if (toBackfill.length === 0) {
        return res.json({ message: "No payrolls need backfill", found: paidPayrolls.length, backfilled: 0, skipped });
      }

      const companyIds = [...new Set(toBackfill.map((p: any) => p.companyId))];
      const workerIds = [...new Set(toBackfill.map((p: any) => p.workerId))];

      const workerRows = await db.select({ id: factoryWorkers.id, fullName: factoryWorkers.fullName })
        .from(factoryWorkers)
        .where(inArray(factoryWorkers.id, workerIds));
      const workerMap = new Map(workerRows.map((w: any) => [w.id, w.fullName]));

      const backfilledIds: number[] = [];

      await db.transaction(async (tx: any) => {
        const payrollAccountCache = new Map<number, number>();

        for (const cid of companyIds) {
          let [found] = await tx.select({ id: ledgerAccounts.id })
            .from(ledgerAccounts)
            .where(and(eq(ledgerAccounts.companyId, cid), eq(ledgerAccounts.name, "Factory Worker Payroll")));

          if (!found) {
            const [maxCode] = await tx.select({ maxCode: sql`MAX(CAST(code AS INTEGER))` })
              .from(ledgerAccounts)
              .where(and(eq(ledgerAccounts.companyId, cid), sql`code ~ '^\d+$'`));
            const nextCode = String((parseInt(maxCode?.maxCode || "0") || 0) + 1);
            [found] = await tx.insert(ledgerAccounts).values({
              companyId: cid, code: nextCode,
              name: "Factory Worker Payroll",
              accountType: "Expense",
              active: true, isHidden: false,
            }).returning();
          }
          payrollAccountCache.set(cid, found.id);
        }

        for (const pr of toBackfill) {
          const netAmt = parseFloat(pr.netSalary || "0");
          const cashAcctId = pr.cashAccountId!;
          const payrollAcctId = payrollAccountCache.get(pr.companyId)!;
          const workerName = ((workerMap.get(pr.workerId) as string) || "").trim() || `Worker #${pr.workerId}`;
          const narration = `Payroll backfill: ${workerName} (${pr.periodStart} – ${pr.periodEnd})`;
          const voucherDate = pr.paidAt ? new Date(pr.paidAt).toISOString().split("T")[0] : new Date().toISOString().split("T")[0];

          const [pVoucher] = await tx.insert(vouchers).values({
            companyId: pr.companyId,
            voucherNumber: `PAYMENT-PAY-${pr.id}-${Date.now()}`,
            voucherType: "Payment",
            voucherDate,
            description: narration,
            totalAmount: netAmt.toFixed(2),
            currency: "USD",
            sourceModule: "FACTORY",
          }).returning();

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
      const workerId = parseInt(req.params.id);
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
      const workerId = parseInt(req.params.id);
      if (isNaN(workerId)) return res.status(400).json({ message: "Invalid worker ID" });
      const companyId = getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };

      // Worker info
      const [worker] = await db.select().from(factoryWorkers)
        .where(and(eq(factoryWorkers.id, workerId), eq(factoryWorkers.companyId, companyId)));
      if (!worker) return res.status(404).json({ message: "Worker not found" });
      const workerName = worker.fullName || `Worker #${workerId}`;

      // Advances
      const advConds: any[] = [eq(factoryWorkerAdvances.workerId, workerId), eq(factoryWorkerAdvances.companyId, companyId)];
      if (startDate) advConds.push(sql`${factoryWorkerAdvances.advanceDate} >= ${startDate}`);
      if (endDate) advConds.push(sql`${factoryWorkerAdvances.advanceDate} <= ${endDate}`);
      const advances = await db.select().from(factoryWorkerAdvances).where(and(...advConds)).orderBy(factoryWorkerAdvances.advanceDate);

      // Payrolls
      const payConds: any[] = [eq(factoryPayrolls.workerId, workerId), eq(factoryPayrolls.companyId, companyId), eq(factoryPayrolls.status, "PAID")];
      if (startDate) payConds.push(sql`${factoryPayrolls.paidAt}::date >= ${startDate}`);
      if (endDate) payConds.push(sql`${factoryPayrolls.paidAt}::date <= ${endDate}`);
      const payrolls = await db.select().from(factoryPayrolls).where(and(...payConds)).orderBy(factoryPayrolls.paidAt);

      // Build entries
      const entries: any[] = [];
      for (const adv of advances) {
        entries.push({ date: adv.advanceDate, type: "Advance", description: adv.notes || "Advance payment", debit: parseFloat(adv.amount || "0"), credit: 0 });
      }
      for (const pr of payrolls) {
        const paidDate = pr.paidAt ? new Date(pr.paidAt).toISOString().split("T")[0] : pr.periodEnd;
        entries.push({ date: paidDate, type: "Payroll", description: `Payroll ${pr.periodStart} to ${pr.periodEnd}`, debit: 0, credit: parseFloat(pr.netSalary || "0") });
      }
      entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      let running = 0;
      const rowsWithBalance = entries.map((e) => {
        running += e.debit - e.credit;
        return { ...e, runningBalance: running };
      });

      // Company info
      const [co] = await db.select().from(companies).where(eq(companies.id, companyId));
      const [sett] = await db.select().from(companySettings).where(eq(companySettings.companyId, companyId)).catch(() => [null]);
      const companyName = (co as any)?.name ?? "Company";
      const logoUrl: string | null = (sett as any)?.logoUrl ?? null;
      const baseCurrency = (co as any)?.baseCurrency ?? "USD";
      const currMap: Record<string, string> = { USD: "$ ", GBP: "£", EUR: "€", CFA: "CFA ", AED: "AED " };
      const sym = currMap[baseCurrency.toUpperCase()] ?? (baseCurrency + " ");
      const fmtAmt = (n: number) => sym + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      const fmtDate = (s: string) => new Date(s.split("T")[0] + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
      const periodStr = startDate && endDate ? `${fmtDate(startDate)} — ${fmtDate(endDate)}` : startDate ? `From ${fmtDate(startDate)}` : endDate ? `Up to ${fmtDate(endDate)}` : "All Time";
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
      let wBidiInst: { getEmbeddingLevels: (t: string, d: string) => any; getReorderedString: (t: string, l: any) => string } | null = null;
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
        } catch { return text; }
      };

      // Render text with automatic Arabic font switching per cell
      const wRenderText = (text: string, x: number, yPos: number, w: number, align: "left"|"right") => {
        const hasAr = hasArabicFont && wContainsArabic(text);
        doc.font(hasAr ? "Arabic" : "Helvetica").fontSize(7.5)
          .text(hasAr ? wShapeText(text) : text, x, yPos, { width: w, align: hasAr ? "right" : align });
      };

      // Header
      let headerY = 40;
      let logoWidth = 0;
      if (logoUrl && logoUrl.startsWith("/") && fs.existsSync(`.${logoUrl}`)) {
        try { doc.image(`.${logoUrl}`, 40, headerY, { height: 48, fit: [80, 48] }); logoWidth = 90; } catch {}
      }
      // Company name — may contain Arabic
      const cNameHasAr = hasArabicFont && wContainsArabic(companyName);
      doc.fontSize(18).font(cNameHasAr ? "Arabic" : "Helvetica-Bold").fillColor("#000000")
        .text(cNameHasAr ? wShapeText(companyName) : companyName, 40 + logoWidth, headerY, { width: 515 - logoWidth, align: cNameHasAr ? "right" : "left" });
      const wNameHasAr = hasArabicFont && wContainsArabic(workerName);
      doc.fontSize(10).font(wNameHasAr ? "Arabic" : "Helvetica").fillColor("#555555")
        .text(wNameHasAr ? `كشف حساب: ${wShapeText(workerName)}` : `Account Statement: ${workerName}`, 40 + logoWidth, headerY + 22, { width: 515 - logoWidth, align: wNameHasAr ? "right" : "left" });

      const headerBottom = Math.max(doc.y, headerY + 52);
      doc.moveTo(40, headerBottom + 4).lineTo(555, headerBottom + 4).lineWidth(0.5).strokeColor("#cccccc").stroke();
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

      let tableY = doc.y + 4;
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
        if (y + ROW_H > PAGE_H - MARGIN_BOTTOM) { doc.addPage(); y = 40; drawHdr(y); y += HDR_H; }
        if (idx % 2 === 1) { doc.rect(40, y, 515, ROW_H).fill("#F8F8F8"); doc.fillColor("#000000"); }
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

      if (y + 52 > PAGE_H - 20) { doc.addPage(); y = 40; }
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
}
