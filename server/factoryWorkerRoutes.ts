import type { Express } from "express";
import { eq, and, desc, sql, ilike, gte, lte, inArray } from "drizzle-orm";
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
  ledgerAccounts,
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

      // Helper functions
      const daysInPeriod = (s: string, e: string) => Math.floor((new Date(e).getTime() - new Date(s).getTime()) / (1000 * 60 * 60 * 24)) + 1;
      const countWeekdays = (s: string, e: string) => {
        let count = 0; const cur = new Date(s); const end = new Date(e);
        while (cur <= end) { const d = cur.getDay(); if (d !== 0 && d !== 6) count++; cur.setDate(cur.getDate() + 1); }
        return count;
      };
      const daysInMonth = (dateStr: string) => { const d = new Date(dateStr); return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); };

      const days = daysInPeriod(startDate, endDate);
      const weekdays = countWeekdays(startDate, endDate);
      const baseSal = parseFloat(worker.baseSalary || "0");
      const payFreq = worker.payFrequency || "Monthly";
      const salType = worker.salaryType || "Monthly";

      let earned = 0;

      // Time-based frequencies use payFrequency field; production-based fall back to salaryType
      if (payFreq === "Hourly") {
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
          gte(factoryBales.finalizedAt, new Date(startDate)),
          lte(factoryBales.finalizedAt, new Date(endDate + "T23:59:59.999Z")),
        ));
        if (salType === "Per Bale") {
          earned = bales.length * parseFloat(worker.perBaleRate || "0");
        } else {
          const totalKg = bales.reduce((s: number, b: any) => s + parseFloat(b.weightKg || "0"), 0);
          earned = totalKg * parseFloat(worker.perKgRate || "0");
        }
      } else {
        // Monthly (default)
        earned = baseSal * (days / daysInMonth(startDate));
      }

      // Compute already paid in period (APPROVED or PAID payrolls)
      const paidPayrolls = await db.select().from(factoryPayrolls).where(and(
        eq(factoryPayrolls.workerId, id),
        eq(factoryPayrolls.companyId, companyId),
        gte(factoryPayrolls.periodStart, startDate),
        lte(factoryPayrolls.periodEnd, endDate),
        inArray(factoryPayrolls.status, ["APPROVED", "PAID"]),
      ));
      const totalPaid = paidPayrolls.reduce((s: number, p: any) => s + parseFloat(p.netSalary || "0"), 0);
      const balance = earned - totalPaid;

      // dryRun: just return calculation, no DB changes
      if (dryRun) {
        return res.json({ earned: earned.toFixed(2), paid: totalPaid.toFixed(2), balance: balance.toFixed(2), dryRun: true });
      }

      const settlementStatus = payNow ? "PAID" : "APPROVED";
      const settlementPaidAt = payNow ? new Date() : null;

      // Insert settlement payroll record
      const [settlement] = await db.insert(factoryPayrolls).values({
        companyId,
        workerId: id,
        periodStart: startDate,
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

      res.json({ earned: earned.toFixed(2), paid: totalPaid.toFixed(2), balance: balance.toFixed(2), settlementPayrollId: settlement.id, workerUpdated: true });
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

  // POST /api/factory/payrolls/generate-bulk - Generate draft payrolls for multiple workers
  app.post("/api/factory/payrolls/generate-bulk", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { workerIds, periodStart, periodEnd, daysCount, bonusPerWorker, cashAccountId, notes } = req.body;
      if (!periodStart || !periodEnd) return res.status(400).json({ message: "Period dates required" });

      const days = daysCount ? parseInt(daysCount) : Math.floor((new Date(periodEnd).getTime() - new Date(periodStart).getTime()) / (1000 * 60 * 60 * 24)) + 1;
      const bonus = parseFloat(bonusPerWorker || "0");

      let targetWorkers;
      if (workerIds && workerIds.length > 0) {
        targetWorkers = await db.select().from(factoryWorkers).where(and(eq(factoryWorkers.companyId, companyId), inArray(factoryWorkers.id, workerIds)));
      } else {
        targetWorkers = await db.select().from(factoryWorkers).where(and(eq(factoryWorkers.companyId, companyId), eq(factoryWorkers.active, true)));
      }

      const daysInMonth = (d: string) => { const dt = new Date(d); return new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate(); };

      const allOutstandingAdvances = await db.select().from(factoryWorkerAdvances)
        .where(and(eq(factoryWorkerAdvances.companyId, companyId), eq(factoryWorkerAdvances.fullyPaid, false)));
      const advanceByWorker: Record<number, number> = {};
      for (const adv of allOutstandingAdvances) {
        advanceByWorker[adv.workerId] = (advanceByWorker[adv.workerId] || 0) + parseFloat(adv.remainingBalance || "0");
      }

      let created = 0;
      for (const worker of targetWorkers) {
        const baseSal = parseFloat(worker.baseSalary || "0");
        const freq = (worker as any).payFrequency || worker.salaryType || "Monthly";
        let base = 0;
        if (freq === "Weekly") base = (days / 7) * parseFloat((worker as any).weeklySalary || baseSal.toString());
        else if (freq === "Bi-Weekly") base = (days / 14) * parseFloat((worker as any).biWeeklySalary || baseSal.toString());
        else if (freq === "Daily" || worker.salaryType === "Daily") base = days * baseSal;
        else base = baseSal * (days / daysInMonth(periodStart));
        const workerAdvanceBalance = advanceByWorker[worker.id] || 0;
        const advanceDeduction = Math.min(workerAdvanceBalance, base + bonus);
        const net = base + bonus - advanceDeduction;
        await db.insert(factoryPayrolls).values({
          companyId, workerId: worker.id, periodStart, periodEnd,
          baseSalary: base.toFixed(2), bonuses: bonus.toFixed(2),
          baleEarnings: "0", kgEarnings: "0", overtimePay: "0", deductions: "0",
          advances: advanceDeduction.toFixed(2),
          netSalary: net.toFixed(2), balesCount: 0, kgProcessed: "0", overtimeHours: "0",
          status: "DRAFT", notes: notes || null,
          cashAccountId: cashAccountId ? parseInt(cashAccountId) : null,
        } as any);
        created++;
      }
      const payrollToday = new Date().toISOString().split("T")[0];
      await writeDaybookEntry(db, {
        companyId,
        txDate: periodStart,
        txType: "PAYROLL_GENERATED",
        description: `Payroll generated: ${created} worker${created !== 1 ? "s" : ""} for period ${periodStart} – ${periodEnd}`,
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

      const updated = await db.transaction(async (tx: any) => {
        const [payroll] = await tx.update(factoryPayrolls)
          .set({ status: "PAID", paidAt: new Date(), cashAccountId } as any)
          .where(and(eq(factoryPayrolls.id, id), eq(factoryPayrolls.companyId, companyId)))
          .returning();
        if (!payroll) throw new Error("Payroll record not found");

        await settleAdvancesForPayroll(tx, companyId, payroll.workerId, parseFloat(payroll.advances || "0"));

        const [prWorker] = await tx.select({ fullName: factoryWorkers.fullName })
          .from(factoryWorkers).where(eq(factoryWorkers.id, payroll.workerId));
        const workerName = prWorker?.fullName?.trim() || `Worker #${payroll.workerId}`;
        const prToday = new Date().toISOString().split("T")[0];
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

      await db.transaction(async (tx: any) => {
        const payrollsToMark = await tx.select().from(factoryPayrolls)
          .where(and(eq(factoryPayrolls.companyId, companyId), inArray(factoryPayrolls.id, payrollIds)));

        await tx.update(factoryPayrolls)
          .set({ status: "PAID", paidAt: new Date(), cashAccountId: cashId } as any)
          .where(and(eq(factoryPayrolls.companyId, companyId), inArray(factoryPayrolls.id, payrollIds)));

        for (const pr of payrollsToMark) {
          const advAmt = parseFloat(pr.advances || "0");
          await settleAdvancesForPayroll(tx, companyId, pr.workerId, advAmt);
        }

        const bulkPrToday = new Date().toISOString().split("T")[0];
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

      const [advance] = await db.insert(factoryWorkerAdvances).values({
        companyId, workerId, advanceDate,
        amount: amount.toFixed(2),
        remainingBalance: amount.toFixed(2),
        cashAccountId,
        notes: req.body.notes || null,
      }).returning();

      await writeDaybookEntry(db, {
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

      res.json({ ...advance, workerName: worker.fullName });
    } catch (error: any) {
      console.error("Error creating advance:", error);
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

      await db.delete(factoryWorkerAdvances)
        .where(and(eq(factoryWorkerAdvances.id, id), eq(factoryWorkerAdvances.companyId, companyId)));

      const today = new Date().toISOString().split("T")[0];
      await writeDaybookEntry(db, {
        companyId,
        txDate: today,
        txType: "ADVANCE_DELETED",
        referenceId: id,
        referenceTable: "factory_worker_advances",
        description: `Advance deleted for ${worker?.fullName || "Unknown"}: $${parseFloat(advance.amount).toFixed(2)}`,
        createdBy: (req.session as any).userId ? parseInt((req.session as any).userId) : undefined,
      });

      res.json({ message: "Advance deleted" });
    } catch (error: any) {
      console.error("Error deleting advance:", error);
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
}
