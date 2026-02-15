import type { Express } from "express";
import { eq, and, desc, sql, ilike } from "drizzle-orm";
import multer from "multer";
import path from "path";
import fs from "fs";
import {
  factoryWorkers,
  insertFactoryWorkerSchema,
  factoryDaybookEntries,
  factoryBales,
  factoryPayrolls,
} from "@shared/schema";

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
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : (req.session as any).currentCompanyId;
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

  // GET /api/factory/workers/:id - Get single worker with computed stats
  app.get("/api/factory/workers/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : (req.session as any).currentCompanyId;
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
      const companyId = req.body.companyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const parsed = insertFactoryWorkerSchema.parse({ ...req.body, companyId });
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
      const companyId = req.body.companyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [updated] = await db
        .update(factoryWorkers)
        .set({ ...req.body, updatedAt: new Date() })
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
      const companyId = req.body.companyId || (req.session as any).currentCompanyId;
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
      const companyId = req.body.companyId || (req.session as any).currentCompanyId;
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

  // GET /api/factory/workers/:id/bales - Get bales associated with worker
  app.get("/api/factory/workers/:id/bales", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : (req.session as any).currentCompanyId;
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

  // GET /api/factory/workers/:id/stats - Get worker productivity stats
  app.get("/api/factory/workers/:id/stats", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : (req.session as any).currentCompanyId;
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
}
