import { getClientDate } from "../lib/dateUtils";
import type { Express } from "express";
import { eq, and, desc, sql, between, gte, lte, sum, count, avg } from "drizzle-orm";
import multer from "multer";
import path from "path";
import fs from "fs";
import {
  factorySettings,
  factoryAlerts,
  factoryWasteEntries,
  factoryBalePhotos,
  factoryDailyKpiSnapshots,
  factorySupplierScoreSnapshots,
  factoryBaleCostSnapshots,
  factoryContainerProfitSnapshots,
  factoryBales,
  factoryContainers,
  factoryRawStock,
  factoryMixBatches,
  factoryMixBatchSources,
  factoryWorkers,
  factoryPayrolls,
  factoryDaybookEntries,
  containerFreight,
  containerFreightPayments,
  containerDocuments,
  containerDocumentTypes,
  factorySuppliers,
  factoryBaleProducts,
  factoryPressingBatches,
  customerOrders,
  customerOrderBales,
} from "@shared/schema";

const balePhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(process.cwd(), "uploads", "bale-photos");
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `bale-${Date.now()}${ext}`);
  },
});
const balePhotoUpload = multer({ storage: balePhotoStorage });

export function registerFactoryIntelligenceRoutes(app: Express, requireAuth: any, db: any) {

  // ───────────────────────────────────────────────
  // 1. Settings CRUD
  // ───────────────────────────────────────────────

  app.get("/api/factory/settings", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      let [settings] = await db
        .select()
        .from(factorySettings)
        .where(eq(factorySettings.companyId, companyId));

      if (!settings) {
        [settings] = await db
          .insert(factorySettings)
          .values({
            companyId,
            dashboardEnabled: true,
            kpisEnabled: true,
            profitabilityEnabled: true,
            alertsEnabled: true,
            supplierScoringEnabled: true,
            mixOptimizerEnabled: true,
            traceabilityEnabled: true,
            balePhotosEnabled: true,
            wasteTrackingEnabled: true,
            cashflowEnabled: true,
            rolesEnabled: true,
            netProfitEnabled: true,
            productionSummaryEnabled: true,
            supplierReportEnabled: true,
            supplierStatementEnabled: true,
          })
          .returning();
      }

      // Spread extraSettings so clients see all flags as top-level fields
      const extra = (settings as any).extraSettings ?? {};
      res.json({ ...settings, ...extra });
    } catch (error: any) {
      console.error("Error fetching factory settings:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Known DB columns — everything else goes into extraSettings JSONB
  const KNOWN_SETTINGS_COLUMNS = new Set([
    "companyId", "dashboardEnabled", "kpisEnabled", "profitabilityEnabled", "alertsEnabled",
    "supplierScoringEnabled", "mixOptimizerEnabled", "traceabilityEnabled", "balePhotosEnabled",
    "wasteTrackingEnabled", "cashflowEnabled", "rolesEnabled", "netProfitEnabled",
    "productionSummaryEnabled", "supplierReportEnabled", "supplierStatementEnabled",
    "laborCostPerKg", "overheadPerKg", "hideSellingPrice", "hideAvgCost",
  ]);

  app.put("/api/factory/settings", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.body.companyId || (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const {
        dashboardEnabled, kpisEnabled, profitabilityEnabled, alertsEnabled,
        supplierScoringEnabled, mixOptimizerEnabled, traceabilityEnabled,
        balePhotosEnabled, wasteTrackingEnabled, cashflowEnabled, rolesEnabled,
        netProfitEnabled, productionSummaryEnabled, supplierReportEnabled, supplierStatementEnabled,
        laborCostPerKg, overheadPerKg, hideSellingPrice, hideAvgCost,
      } = req.body;

      const updateData: any = { updatedAt: new Date() };
      if (dashboardEnabled !== undefined) updateData.dashboardEnabled = dashboardEnabled;
      if (kpisEnabled !== undefined) updateData.kpisEnabled = kpisEnabled;
      if (profitabilityEnabled !== undefined) updateData.profitabilityEnabled = profitabilityEnabled;
      if (alertsEnabled !== undefined) updateData.alertsEnabled = alertsEnabled;
      if (supplierScoringEnabled !== undefined) updateData.supplierScoringEnabled = supplierScoringEnabled;
      if (mixOptimizerEnabled !== undefined) updateData.mixOptimizerEnabled = mixOptimizerEnabled;
      if (traceabilityEnabled !== undefined) updateData.traceabilityEnabled = traceabilityEnabled;
      if (balePhotosEnabled !== undefined) updateData.balePhotosEnabled = balePhotosEnabled;
      if (wasteTrackingEnabled !== undefined) updateData.wasteTrackingEnabled = wasteTrackingEnabled;
      if (cashflowEnabled !== undefined) updateData.cashflowEnabled = cashflowEnabled;
      if (rolesEnabled !== undefined) updateData.rolesEnabled = rolesEnabled;
      if (netProfitEnabled !== undefined) updateData.netProfitEnabled = netProfitEnabled;
      if (productionSummaryEnabled !== undefined) updateData.productionSummaryEnabled = productionSummaryEnabled;
      if (supplierReportEnabled !== undefined) updateData.supplierReportEnabled = supplierReportEnabled;
      if (supplierStatementEnabled !== undefined) updateData.supplierStatementEnabled = supplierStatementEnabled;
      if (laborCostPerKg !== undefined) updateData.laborCostPerKg = String(laborCostPerKg);
      if (overheadPerKg !== undefined) updateData.overheadPerKg = String(overheadPerKg);
      if (hideSellingPrice !== undefined) updateData.hideSellingPrice = hideSellingPrice;
      if (hideAvgCost !== undefined) updateData.hideAvgCost = hideAvgCost;

      // Collect any extra boolean/string settings into extraSettings JSONB
      const extraKeys = Object.keys(req.body).filter(k => !KNOWN_SETTINGS_COLUMNS.has(k) && k !== "id" && k !== "updatedAt" && k !== "extraSettings");
      if (extraKeys.length > 0) {
        // Fetch current extraSettings to merge
        const [current] = await db.select({ extraSettings: factorySettings.extraSettings }).from(factorySettings).where(eq(factorySettings.companyId, companyId));
        const currentExtra: any = (current?.extraSettings as any) ?? {};
        const newExtra: any = { ...currentExtra };
        for (const key of extraKeys) {
          if (req.body[key] !== undefined) newExtra[key] = req.body[key];
        }
        updateData.extraSettings = newExtra;
      }

      const [result] = await db
        .insert(factorySettings)
        .values({ companyId, ...updateData })
        .onConflictDoUpdate({
          target: factorySettings.companyId,
          set: updateData,
        })
        .returning();

      const resultExtra = (result as any).extraSettings ?? {};
      res.json({ ...result, ...resultExtra });
    } catch (error: any) {
      console.error("Error updating factory settings:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 2. Dashboard
  // ───────────────────────────────────────────────

  app.get("/api/factory/dashboard", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const dateStr = (req.query.date as string) || getClientDate(req);

      // Waste entries for the selected date
      const wasteOnDate = await db
        .select()
        .from(factoryWasteEntries)
        .where(and(
          eq(factoryWasteEntries.companyId, companyId),
          eq(factoryWasteEntries.date, dateStr)
        ));

      const wasteBreakdownMap: Record<string, number> = {};
      let wasteTotalKg = 0;
      for (const w of wasteOnDate) {
        const kg = parseFloat(w.kgWaste || "0");
        wasteTotalKg += kg;
        const wType = (w as any).wasteType ? (w as any).wasteType.toUpperCase() : "OTHER";
        wasteBreakdownMap[wType] = (wasteBreakdownMap[wType] || 0) + kg;
      }
      const wasteBreakdown = Object.entries(wasteBreakdownMap).map(([wasteType, kg]) => ({
        wasteType,
        kg: Math.round(kg * 1000) / 1000,
      }));

      // Active workers count
      const activeWorkers = await db
        .select()
        .from(factoryWorkers)
        .where(and(eq(factoryWorkers.companyId, companyId), eq(factoryWorkers.active, true)));

      // Attendance today — query employee_attendance (the table managed by the attendance page)
      const attendanceTodayResult = await db.execute(sql`
        SELECT COUNT(*)::int AS count
        FROM employee_attendance
        WHERE company_id = ${companyId}
          AND attendance_date = ${dateStr}::date
          AND LOWER(status) != 'absent'
      `);
      const attendanceTodayCount = parseInt(String((attendanceTodayResult.rows[0] as any)?.count ?? "0"), 10);

      // Loaded customer containers: finalized orders with containerNumber
      const loadedOrders = await db
        .select({ id: customerOrders.id })
        .from(customerOrders)
        .where(and(
          eq(customerOrders.companyId, companyId),
          sql`(${customerOrders.loadingFinalizedAt} IS NOT NULL OR (${customerOrders.status} = 'FINALIZED' AND ${customerOrders.containerNumber} IS NOT NULL))`
        ));

      res.json({
        waste: { totalKg: Math.round(wasteTotalKg * 1000) / 1000, breakdown: wasteBreakdown },
        workers: { active: activeWorkers.length, attendanceToday: attendanceTodayCount },
        containers: { loaded: loadedOrders.length },
      });
    } catch (error: any) {
      console.error("Error fetching factory dashboard:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 3. Waste Tracking
  // ───────────────────────────────────────────────

  app.get("/api/factory/waste", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const from = req.query.from as string;
      const to = req.query.to as string;

      const conditions: any[] = [eq(factoryWasteEntries.companyId, companyId)];
      if (from) conditions.push(gte(factoryWasteEntries.date, from));
      if (to) conditions.push(lte(factoryWasteEntries.date, to));

      const results = await db
        .select()
        .from(factoryWasteEntries)
        .where(and(...conditions))
        .orderBy(desc(factoryWasteEntries.date));

      res.json(results);
    } catch (error: any) {
      console.error("Error fetching waste entries:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/waste", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.body.companyId || (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { date, mixBatchId, supplierId, containerId, wasteType, kgWaste, reason } = req.body;

      const [entry] = await db
        .insert(factoryWasteEntries)
        .values({
          companyId,
          date,
          mixBatchId: mixBatchId || null,
          supplierId: supplierId || null,
          containerId: containerId || null,
          wasteType: wasteType || null,
          kgWaste: String(kgWaste),
          reason: reason || null,
          createdBy: (req.session as any).userId ? parseInt((req.session as any).userId) : null,
        })
        .returning();

      res.json(entry);
    } catch (error: any) {
      console.error("Error creating waste entry:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/factory/waste/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [deleted] = await db
        .delete(factoryWasteEntries)
        .where(and(eq(factoryWasteEntries.id, id), eq(factoryWasteEntries.companyId, companyId)))
        .returning();

      if (!deleted) return res.status(404).json({ message: "Waste entry not found" });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting waste entry:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 4. KPIs
  // ───────────────────────────────────────────────

  app.get("/api/factory/kpis/daily", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const from = req.query.from as string;
      const to = req.query.to as string;
      if (!from || !to) return res.status(400).json({ message: "from and to dates are required" });

      const bales = await db
        .select()
        .from(factoryBales)
        .where(and(
          eq(factoryBales.companyId, companyId),
          sql`DATE(${factoryBales.finalizedAt}) >= ${from}`,
          sql`DATE(${factoryBales.finalizedAt}) <= ${to}`
        ));

      const wasteEntries = await db
        .select()
        .from(factoryWasteEntries)
        .where(and(
          eq(factoryWasteEntries.companyId, companyId),
          gte(factoryWasteEntries.date, from),
          lte(factoryWasteEntries.date, to)
        ));

      const dailyMap: Record<string, { balesProduced: number; kgPressed: number; wasteKg: number }> = {};

      for (const bale of bales) {
        const d = bale.finalizedAt ? new Date(bale.finalizedAt).toISOString().split("T")[0] : null;
        if (!d) continue;
        if (!dailyMap[d]) dailyMap[d] = { balesProduced: 0, kgPressed: 0, wasteKg: 0 };
        dailyMap[d].balesProduced++;
        dailyMap[d].kgPressed += parseFloat(bale.weightKg || "0");
      }

      for (const w of wasteEntries) {
        const d = w.date;
        if (!d) continue;
        if (!dailyMap[d]) dailyMap[d] = { balesProduced: 0, kgPressed: 0, wasteKg: 0 };
        dailyMap[d].wasteKg += parseFloat(w.kgWaste || "0");
      }

      const result = Object.entries(dailyMap)
        .map(([date, data]) => ({ date, ...data }))
        .sort((a, b) => a.date.localeCompare(b.date));

      res.json(result);
    } catch (error: any) {
      console.error("Error fetching daily KPIs:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/kpis/workers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const from = req.query.from as string;
      const to = req.query.to as string;
      if (!from || !to) return res.status(400).json({ message: "from and to dates are required" });

      const bales = await db
        .select()
        .from(factoryBales)
        .where(and(
          eq(factoryBales.companyId, companyId),
          sql`DATE(${factoryBales.finalizedAt}) >= ${from}`,
          sql`DATE(${factoryBales.finalizedAt}) <= ${to}`
        ));

      const workers = await db
        .select()
        .from(factoryWorkers)
        .where(eq(factoryWorkers.companyId, companyId));

      const workerMap = new Map<number, any>(workers.map((w: any) => [w.id, w]));

      const workerStats: Record<number, { workerId: number; workerName: string; balesCount: number; totalKg: number }> = {};

      for (const bale of bales) {
        const wId = bale.finalizedBy;
        if (!wId) continue;
        if (!workerStats[wId]) {
          const worker = workerMap.get(wId);
          workerStats[wId] = {
            workerId: wId,
            workerName: worker?.fullName || "Unknown",
            balesCount: 0,
            totalKg: 0,
          };
        }
        workerStats[wId].balesCount++;
        workerStats[wId].totalKg += parseFloat(bale.weightKg || "0");
      }

      const result = Object.values(workerStats).sort((a, b) => b.balesCount - a.balesCount);
      res.json(result);
    } catch (error: any) {
      console.error("Error fetching worker KPIs:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/kpis/mixes", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const from = req.query.from as string;
      const to = req.query.to as string;
      if (!from || !to) return res.status(400).json({ message: "from and to dates are required" });

      const mixes = await db
        .select()
        .from(factoryMixBatches)
        .where(and(
          eq(factoryMixBatches.companyId, companyId),
          sql`DATE(${factoryMixBatches.createdAt}) >= ${from}`,
          sql`DATE(${factoryMixBatches.createdAt}) <= ${to}`
        ));

      const mixIds = mixes.map((m: any) => m.id);
      if (mixIds.length === 0) return res.json([]);

      const sources = await db
        .select()
        .from(factoryMixBatchSources)
        .where(sql`${factoryMixBatchSources.mixBatchId} IN (${sql.join(mixIds.map((id: number) => sql`${id}`), sql`, `)})`);

      const bales = await db
        .select()
        .from(factoryBales)
        .where(and(
          eq(factoryBales.companyId, companyId),
          sql`${factoryBales.mixBatchId} IN (${sql.join(mixIds.map((id: number) => sql`${id}`), sql`, `)})`
        ));

      const result = mixes.map((mix: any) => {
        const mixSources = sources.filter((s: any) => s.mixBatchId === mix.id);
        const totalInputKg = mixSources.reduce((s: number, src: any) => s + parseFloat(src.weightKg || "0"), 0);

        const mixBales = bales.filter((b: any) => b.mixBatchId === mix.id);
        const outputBalesCount = mixBales.length;
        const totalOutputKg = mixBales.reduce((s: number, b: any) => s + parseFloat(b.weightKg || "0"), 0);

        const wasteKg = totalInputKg - totalOutputKg;
        const wastePct = totalInputKg > 0 ? (wasteKg / totalInputKg) * 100 : 0;

        return {
          mixBatchId: mix.id,
          batchCode: mix.batchCode,
          name: mix.name,
          totalInputKg,
          outputBalesCount,
          totalOutputKg,
          wasteKg,
          wastePct: Math.round(wastePct * 100) / 100,
        };
      });

      result.sort((a: any, b: any) => a.wastePct - b.wastePct);
      res.json(result);
    } catch (error: any) {
      console.error("Error fetching mix KPIs:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 5. Profitability
  // ───────────────────────────────────────────────

  app.get("/api/factory/profitability/bales", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const from = req.query.from as string;
      const to = req.query.to as string;
      if (!from || !to) return res.status(400).json({ message: "from and to dates are required" });

      const [settings] = await db
        .select()
        .from(factorySettings)
        .where(eq(factorySettings.companyId, companyId));

      const laborCostPerKg = parseFloat(settings?.laborCostPerKg || "0");
      const overheadPerKg = parseFloat(settings?.overheadPerKg || "0");

      const bales = await db
        .select()
        .from(factoryBales)
        .where(and(
          eq(factoryBales.companyId, companyId),
          sql`DATE(${factoryBales.finalizedAt}) >= ${from}`,
          sql`DATE(${factoryBales.finalizedAt}) <= ${to}`
        ));

      if (bales.length === 0) return res.json([]);

      const mixBatchIds = Array.from(new Set(bales.map((b: any) => b.mixBatchId).filter(Boolean))) as number[];
      const sources = mixBatchIds.length > 0
        ? await db.select().from(factoryMixBatchSources)
            .where(sql`${factoryMixBatchSources.mixBatchId} IN (${sql.join(mixBatchIds.map((id: number) => sql`${id}`), sql`, `)})`)
        : [];

      const orderBales = await db
        .select()
        .from(customerOrderBales)
        .where(sql`${customerOrderBales.baleId} IN (${sql.join(bales.map((b: any) => sql`${b.id}`), sql`, `)})`);

      const orderBaleMap = new Map<number, any>(orderBales.map((ob: any) => [ob.baleId, ob]));

      const freightEntries = await db
        .select()
        .from(containerFreight)
        .where(eq(containerFreight.companyId, companyId));

      const result = bales.map((bale: any) => {
        const weightKg = parseFloat(bale.weightKg || "0");
        const materialCost = parseFloat(bale.totalCost || "0");
        const laborCost = weightKg * laborCostPerKg;
        const overheadCost = weightKg * overheadPerKg;

        let freightAllocated = 0;
        const totalCost = materialCost + laborCost + overheadCost + freightAllocated;

        const ob = orderBaleMap.get(bale.id);
        const salePrice = ob ? parseFloat(ob.priceUsed || "0") : null;
        const profit = salePrice !== null ? salePrice - totalCost : null;

        return {
          baleId: bale.id,
          referenceNumber: bale.referenceNumber,
          productName: bale.productName,
          weightKg,
          materialCost: Math.round(materialCost * 100) / 100,
          laborCost: Math.round(laborCost * 100) / 100,
          overheadCost: Math.round(overheadCost * 100) / 100,
          freightAllocated: Math.round(freightAllocated * 100) / 100,
          totalCost: Math.round(totalCost * 100) / 100,
          salePrice,
          profit: profit !== null ? Math.round(profit * 100) / 100 : null,
        };
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error fetching bale profitability:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/profitability/containers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const from = req.query.from as string;
      const to = req.query.to as string;
      if (!from || !to) return res.status(400).json({ message: "from and to dates are required" });

      const containers = await db
        .select()
        .from(factoryContainers)
        .where(and(
          eq(factoryContainers.companyId, companyId),
          sql`DATE(${factoryContainers.createdAt}) >= ${from}`,
          sql`DATE(${factoryContainers.createdAt}) <= ${to}`
        ));

      if (containers.length === 0) return res.json([]);

      const containerIds = containers.map((c: any) => c.id);

      const rawStockEntries = await db
        .select()
        .from(factoryRawStock)
        .where(and(
          eq(factoryRawStock.companyId, companyId),
          sql`${factoryRawStock.containerId} IN (${sql.join(containerIds.map((id: number) => sql`${id}`), sql`, `)})`
        ));

      const freightEntries = await db
        .select()
        .from(containerFreight)
        .where(and(
          eq(containerFreight.companyId, companyId),
          sql`${containerFreight.containerId} IN (${sql.join(containerIds.map((id: number) => sql`${id}`), sql`, `)})`
        ));

      const allBales = await db
        .select()
        .from(factoryBales)
        .where(eq(factoryBales.companyId, companyId));

      const allOrderBales = await db
        .select()
        .from(customerOrderBales);

      const orderBaleMap = new Map<number, any>(allOrderBales.map((ob: any) => [ob.baleId, ob]));

      const [settings] = await db
        .select()
        .from(factorySettings)
        .where(eq(factorySettings.companyId, companyId));

      const laborCostPerKg = parseFloat(settings?.laborCostPerKg || "0");
      const overheadPerKg = parseFloat(settings?.overheadPerKg || "0");

      const mixSources = await db
        .select()
        .from(factoryMixBatchSources)
        .where(sql`${factoryMixBatchSources.containerId} IN (${sql.join(containerIds.map((id: number) => sql`${id}`), sql`, `)})`);

      const result = containers.map((container: any) => {
        const containerRawStock = rawStockEntries.filter((r: any) => r.containerId === container.id);
        const rawStockCost = containerRawStock.reduce((s: number, r: any) =>
          s + parseFloat(r.receivedKg || "0") * parseFloat(r.costPerKg || "0"), 0);

        const containerFreightTotal = freightEntries
          .filter((f: any) => f.containerId === container.id)
          .reduce((s: number, f: any) => s + parseFloat(f.freightAmount || "0"), 0);

        const containerMixSources = mixSources.filter((s: any) => s.containerId === container.id);
        const mixBatchIds = Array.from(new Set(containerMixSources.map((s: any) => s.mixBatchId))) as number[];

        const containerBales = allBales.filter((b: any) => mixBatchIds.includes(b.mixBatchId));
        const baleTotalKg = containerBales.reduce((s: number, b: any) => s + parseFloat(b.weightKg || "0"), 0);
        const baleLaborCost = baleTotalKg * laborCostPerKg;
        const baleOverheadCost = baleTotalKg * overheadPerKg;

        const totalCost = rawStockCost + containerFreightTotal + baleLaborCost + baleOverheadCost;

        let totalRevenue = 0;
        for (const bale of containerBales) {
          const ob = orderBaleMap.get(bale.id);
          if (ob) totalRevenue += parseFloat(ob.priceUsed || "0");
        }

        const profit = totalRevenue - totalCost;
        const marginPct = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0;

        return {
          containerId: container.id,
          containerNumber: container.containerNumber,
          totalCost: Math.round(totalCost * 100) / 100,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          profit: Math.round(profit * 100) / 100,
          marginPct: Math.round(marginPct * 100) / 100,
        };
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error fetching container profitability:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 6. Alerts
  // ───────────────────────────────────────────────

  app.get("/api/factory/alerts", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const results = await db
        .select()
        .from(factoryAlerts)
        .where(and(eq(factoryAlerts.companyId, companyId), eq(factoryAlerts.isRead, false)))
        .orderBy(desc(factoryAlerts.createdAt))
        .limit(50);

      res.json(results);
    } catch (error: any) {
      console.error("Error fetching factory alerts:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/alerts/:id/read", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.body.companyId || (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [updated] = await db
        .update(factoryAlerts)
        .set({ isRead: true })
        .where(and(eq(factoryAlerts.id, id), eq(factoryAlerts.companyId, companyId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Alert not found" });
      res.json(updated);
    } catch (error: any) {
      console.error("Error marking alert as read:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/alerts/generate", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.body.companyId || (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      let newAlertCount = 0;
      const today = getClientDate(req);

      const existingAlerts = await db
        .select()
        .from(factoryAlerts)
        .where(and(eq(factoryAlerts.companyId, companyId), eq(factoryAlerts.isRead, false)));

      const alertExists = (type: string, entityType: string, entityId: number) => {
        return existingAlerts.some((a: any) => a.type === type && a.entityType === entityType && a.entityId === entityId);
      };

      const requiredDocTypes = await db
        .select()
        .from(containerDocumentTypes)
        .where(and(
          eq(containerDocumentTypes.isRequired, true),
          sql`(${containerDocumentTypes.companyId} = ${companyId} OR ${containerDocumentTypes.companyId} IS NULL)`
        ));
      const requiredDocTypeCount = requiredDocTypes.length;
      const requiredDocTypeIds = requiredDocTypes.map((d: any) => d.id);

      if (requiredDocTypeCount > 0) {
        const allContainers = await db
          .select()
          .from(factoryContainers)
          .where(eq(factoryContainers.companyId, companyId));

        const docs = await db
          .select()
          .from(containerDocuments)
          .where(eq(containerDocuments.companyId, companyId));

        for (const container of allContainers) {
          const containerDocs = docs.filter((d: any) => d.containerId === container.id);
          const uploadedRequiredIds = new Set(
            containerDocs
              .filter((d: any) => requiredDocTypeIds.includes(d.docTypeId))
              .map((d: any) => d.docTypeId)
          );
          if (uploadedRequiredIds.size < requiredDocTypeCount) {
            if (!alertExists("MISSING_DOCS", "container", container.id)) {
              await db.insert(factoryAlerts).values({
                companyId,
                type: "MISSING_DOCS",
                severity: "warning",
                title: `Container ${container.containerNumber} missing documents`,
                message: `Container is missing ${requiredDocTypeCount - uploadedRequiredIds.size} required document(s).`,
                entityType: "container",
                entityId: container.id,
              });
              newAlertCount++;
            }
          }
        }
      }

      const freightEntries = await db
        .select()
        .from(containerFreight)
        .where(eq(containerFreight.companyId, companyId));

      const freightPayments = await db
        .select()
        .from(containerFreightPayments)
        .where(eq(containerFreightPayments.companyId, companyId));

      for (const f of freightEntries) {
        if (!f.dueDate) continue;
        if (f.dueDate >= today) continue;

        const amount = parseFloat(f.freightAmount || "0");
        const paid = freightPayments
          .filter((p: any) => p.containerFreightId === f.id)
          .reduce((s: number, p: any) => s + parseFloat(p.amount || "0"), 0);

        if (amount - paid > 0.01) {
          if (!alertExists("FREIGHT_OVERDUE", "freight", f.id)) {
            await db.insert(factoryAlerts).values({
              companyId,
              type: "FREIGHT_OVERDUE",
              severity: "error",
              title: `Freight overdue: ${f.vendorName || "Unknown vendor"}`,
              message: `Freight of ${amount.toFixed(2)} was due on ${f.dueDate}. Remaining: ${(amount - paid).toFixed(2)}.`,
              entityType: "freight",
              entityId: f.id,
            });
            newAlertCount++;
          }
        }
      }

      const workers = await db
        .select()
        .from(factoryWorkers)
        .where(and(eq(factoryWorkers.companyId, companyId), eq(factoryWorkers.active, true)));

      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
      const thirtyDaysStr = thirtyDaysFromNow.toISOString().split("T")[0];

      for (const worker of workers) {
        if (!worker.contractEndDate) continue;
        if (worker.contractEndDate <= thirtyDaysStr && worker.contractEndDate >= today) {
          if (!alertExists("CONTRACT_EXPIRING", "worker", worker.id)) {
            await db.insert(factoryAlerts).values({
              companyId,
              type: "CONTRACT_EXPIRING",
              severity: "warning",
              title: `Contract expiring: ${worker.fullName}`,
              message: `Worker ${worker.fullName}'s contract expires on ${worker.contractEndDate}.`,
              entityType: "worker",
              entityId: worker.id,
            });
            newAlertCount++;
          }
        }
      }

      res.json({ newAlerts: newAlertCount });
    } catch (error: any) {
      console.error("Error generating alerts:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 7. Supplier Scoring
  // ───────────────────────────────────────────────

  app.get("/api/factory/suppliers/score", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const from = req.query.from as string;
      const to = req.query.to as string;
      if (!from || !to) return res.status(400).json({ message: "from and to dates are required" });

      const rawStockEntries = await db
        .select()
        .from(factoryRawStock)
        .where(and(
          eq(factoryRawStock.companyId, companyId),
          sql`DATE(${factoryRawStock.offloadedAt}) >= ${from}`,
          sql`DATE(${factoryRawStock.offloadedAt}) <= ${to}`
        ));

      const containers = await db
        .select()
        .from(factoryContainers)
        .where(eq(factoryContainers.companyId, companyId));

      const containerMap = new Map<number, any>(containers.map((c: any) => [c.id, c]));

      const wasteEntries = await db
        .select()
        .from(factoryWasteEntries)
        .where(and(
          eq(factoryWasteEntries.companyId, companyId),
          gte(factoryWasteEntries.date, from),
          lte(factoryWasteEntries.date, to)
        ));

      const suppliers = await db
        .select()
        .from(factorySuppliers)
        .where(eq(factorySuppliers.companyId, companyId));

      const supplierMap = new Map<number, any>(suppliers.map((s: any) => [s.id, s]));

      const mixSources = await db
        .select()
        .from(factoryMixBatchSources);

      const allBales = await db
        .select()
        .from(factoryBales)
        .where(eq(factoryBales.companyId, companyId));

      const supplierStats: Record<number, {
        supplierId: number; supplierName: string;
        totalKg: number; totalCost: number; wasteKg: number; outputBales: number;
      }> = {};

      for (const rs of rawStockEntries) {
        const container = containerMap.get(rs.containerId);
        const supplierId = container?.supplierId;
        if (!supplierId) continue;

        if (!supplierStats[supplierId]) {
          const supplier = supplierMap.get(supplierId);
          supplierStats[supplierId] = {
            supplierId,
            supplierName: supplier?.name || "Unknown",
            totalKg: 0,
            totalCost: 0,
            wasteKg: 0,
            outputBales: 0,
          };
        }

        const kg = parseFloat(rs.receivedKg || "0");
        const cost = kg * parseFloat(rs.costPerKg || "0");
        supplierStats[supplierId].totalKg += kg;
        supplierStats[supplierId].totalCost += cost;
      }

      for (const w of wasteEntries) {
        if (w.supplierId && supplierStats[w.supplierId]) {
          supplierStats[w.supplierId].wasteKg += parseFloat(w.kgWaste || "0");
        }
      }

      for (const suppId of Object.keys(supplierStats).map(Number)) {
        const supplierContainerIds = containers
          .filter((c: any) => c.supplierId === suppId)
          .map((c: any) => c.id);

        const supplierMixSources = mixSources.filter((s: any) => supplierContainerIds.includes(s.containerId));
        const mixBatchIds = Array.from(new Set(supplierMixSources.map((s: any) => s.mixBatchId))) as number[];
        const balesFromSupplier = allBales.filter((b: any) => mixBatchIds.includes(b.mixBatchId));
        supplierStats[suppId].outputBales = balesFromSupplier.length;
      }

      const result = Object.values(supplierStats).map((s) => {
        const wastePct = s.totalKg > 0 ? (s.wasteKg / s.totalKg) * 100 : 0;
        const avgCostPerKg = s.totalKg > 0 ? s.totalCost / s.totalKg : 0;
        let score = 100 - (wastePct * 2) - (avgCostPerKg * 5) + (s.outputBales * 0.5);
        score = Math.max(0, Math.min(100, score));

        return {
          supplierId: s.supplierId,
          supplierName: s.supplierName,
          totalKg: Math.round(s.totalKg * 1000) / 1000,
          wasteKg: Math.round(s.wasteKg * 1000) / 1000,
          wastePct: Math.round(wastePct * 100) / 100,
          avgCostPerKg: Math.round(avgCostPerKg * 10000) / 10000,
          outputBales: s.outputBales,
          score: Math.round(score * 100) / 100,
        };
      });

      result.sort((a, b) => b.score - a.score);
      res.json(result);
    } catch (error: any) {
      console.error("Error fetching supplier scores:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 8. Mix Optimizer
  // ───────────────────────────────────────────────

  app.post("/api/factory/mix/optimize", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.body.companyId || (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { targetProductId, desiredMarginPct, availableMaterials } = req.body;

      const [settings] = await db
        .select()
        .from(factorySettings)
        .where(eq(factorySettings.companyId, companyId));

      const laborCostPerKg = parseFloat(settings?.laborCostPerKg || "0");
      const overheadPerKg = parseFloat(settings?.overheadPerKg || "0");

      const balesForProduct = await db
        .select()
        .from(factoryBales)
        .where(and(
          eq(factoryBales.companyId, companyId),
          eq(factoryBales.productId, targetProductId)
        ));

      const mixBatchIds = Array.from(new Set(balesForProduct.map((b: any) => b.mixBatchId).filter(Boolean))) as number[];

      let suggestions: any[] = [];

      if (mixBatchIds.length > 0) {
        const mixes = await db
          .select()
          .from(factoryMixBatches)
          .where(sql`${factoryMixBatches.id} IN (${sql.join(mixBatchIds.map((id: number) => sql`${id}`), sql`, `)})`);

        const sources = await db
          .select()
          .from(factoryMixBatchSources)
          .where(sql`${factoryMixBatchSources.mixBatchId} IN (${sql.join(mixBatchIds.map((id: number) => sql`${id}`), sql`, `)})`);

        const mixPerformance = mixes.map((mix: any) => {
          const mixSources = sources.filter((s: any) => s.mixBatchId === mix.id);
          const totalInputKg = mixSources.reduce((s: number, src: any) => s + parseFloat(src.weightKg || "0"), 0);
          const mixBales = balesForProduct.filter((b: any) => b.mixBatchId === mix.id);
          const totalOutputKg = mixBales.reduce((s: number, b: any) => s + parseFloat(b.weightKg || "0"), 0);
          const wastePct = totalInputKg > 0 ? ((totalInputKg - totalOutputKg) / totalInputKg) * 100 : 100;

          const sourceRatios = mixSources.map((src: any) => ({
            containerId: src.containerId,
            kgRatio: totalInputKg > 0 ? parseFloat(src.weightKg || "0") / totalInputKg : 0,
            costPerKg: parseFloat(src.costPerKg || "0"),
          }));

          return { mix, sourceRatios, wastePct, totalInputKg };
        });

        mixPerformance.sort((a: any, b: any) => a.wastePct - b.wastePct);
        const top3 = mixPerformance.slice(0, 3);

        suggestions = top3.map((perf: any) => {
          const avgMaterialCost = perf.sourceRatios.reduce(
            (s: number, r: any) => s + r.costPerKg * r.kgRatio, 0
          );
          const avgBaleWeight = 25;
          const expectedCostPerBale = (avgMaterialCost + laborCostPerKg + overheadPerKg) * avgBaleWeight;
          const expectedSalePrice = expectedCostPerBale / (1 - (desiredMarginPct || 20) / 100);
          const expectedProfit = expectedSalePrice - expectedCostPerBale;

          return {
            sources: perf.sourceRatios.map((r: any) => ({
              containerId: r.containerId,
              kgRatio: Math.round(r.kgRatio * 10000) / 10000,
            })),
            expectedCostPerBale: Math.round(expectedCostPerBale * 100) / 100,
            expectedProfit: Math.round(expectedProfit * 100) / 100,
            historicalWastePct: Math.round(perf.wastePct * 100) / 100,
          };
        });
      }

      if (suggestions.length === 0 && availableMaterials && availableMaterials.length > 0) {
        const equalRatio = 1 / availableMaterials.length;
        const avgCost = availableMaterials.reduce((s: number, m: any) => s + parseFloat(m.costPerKg || "0"), 0) / availableMaterials.length;
        const avgBaleWeight = 25;
        const expectedCostPerBale = (avgCost + laborCostPerKg + overheadPerKg) * avgBaleWeight;
        const expectedSalePrice = expectedCostPerBale / (1 - (desiredMarginPct || 20) / 100);
        const expectedProfit = expectedSalePrice - expectedCostPerBale;

        suggestions = [{
          sources: availableMaterials.map((m: any) => ({
            supplierId: m.supplierId,
            kgRatio: Math.round(equalRatio * 10000) / 10000,
          })),
          expectedCostPerBale: Math.round(expectedCostPerBale * 100) / 100,
          expectedProfit: Math.round(expectedProfit * 100) / 100,
          historicalWastePct: null,
        }];
      }

      res.json({ suggestions });
    } catch (error: any) {
      console.error("Error optimizing mix:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 9. Traceability
  // ───────────────────────────────────────────────

  app.get("/api/factory/bales/:id/trace", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const baleId = parseInt(req.params.id);

      const [bale] = await db
        .select()
        .from(factoryBales)
        .where(and(eq(factoryBales.id, baleId), eq(factoryBales.companyId, companyId)));

      if (!bale) return res.status(404).json({ message: "Bale not found" });

      let mixBatch = null;
      let sourcesData: any[] = [];

      if (bale.mixBatchId) {
        const [mb] = await db
          .select()
          .from(factoryMixBatches)
          .where(eq(factoryMixBatches.id, bale.mixBatchId));
        mixBatch = mb || null;

        if (mixBatch) {
          const mixSources = await db
            .select()
            .from(factoryMixBatchSources)
            .where(eq(factoryMixBatchSources.mixBatchId, mixBatch.id));

          const containerIds = mixSources.map((s: any) => s.containerId).filter(Boolean);
          const containers = containerIds.length > 0
            ? await db.select().from(factoryContainers)
                .where(sql`${factoryContainers.id} IN (${sql.join(containerIds.map((id: number) => sql`${id}`), sql`, `)})`)
            : [];

          const containerMap = new Map<number, any>(containers.map((c: any) => [c.id, c]));

          const supplierIds = Array.from(new Set(containers.map((c: any) => c.supplierId).filter(Boolean))) as number[];
          const suppliers = supplierIds.length > 0
            ? await db.select().from(factorySuppliers)
                .where(sql`${factorySuppliers.id} IN (${sql.join(supplierIds.map((id: number) => sql`${id}`), sql`, `)})`)
            : [];
          const supplierMap = new Map<number, any>(suppliers.map((s: any) => [s.id, s]));

          sourcesData = mixSources.map((s: any) => {
            const container = s.containerId ? containerMap.get(s.containerId) : null;
            const supplier = container?.supplierId ? supplierMap.get(container.supplierId) : null;
            return {
              supplier: supplier ? { id: supplier.id, name: supplier.name } : null,
              container: container ? { id: container.id, containerNumber: container.containerNumber } : null,
              kgUsed: parseFloat(s.weightKg || "0"),
            };
          });
        }
      }

      let shippingContainer = null;

      const [orderBale] = await db
        .select()
        .from(customerOrderBales)
        .where(eq(customerOrderBales.baleId, baleId));

      let order = null;
      if (orderBale) {
        const [o] = await db
          .select()
          .from(customerOrders)
          .where(eq(customerOrders.id, orderBale.orderId));
        order = o || null;
      }

      res.json({
        bale,
        mixBatch,
        sources: sourcesData,
        shippingContainer,
        order,
      });
    } catch (error: any) {
      console.error("Error tracing bale:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 10. Bale Photos
  // ───────────────────────────────────────────────

  app.get("/api/factory/bales/:id/photos", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const baleId = parseInt(req.params.id);

      const photos = await db
        .select()
        .from(factoryBalePhotos)
        .where(and(eq(factoryBalePhotos.baleId, baleId), eq(factoryBalePhotos.companyId, companyId)))
        .orderBy(desc(factoryBalePhotos.uploadedAt));

      res.json(photos);
    } catch (error: any) {
      console.error("Error fetching bale photos:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/bales/:id/photos", requireAuth, balePhotoUpload.single("photo"), async (req: any, res: any) => {
    try {
      const companyId = req.body.companyId || (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      if (!req.file) return res.status(400).json({ message: "No photo uploaded" });

      const baleId = parseInt(req.params.id);
      const url = `/api/factory/uploads/bale-photos/${req.file.filename}`;

      const [photo] = await db
        .insert(factoryBalePhotos)
        .values({
          companyId,
          baleId,
          url,
          fileName: req.file.originalname,
          uploadedBy: (req.session as any).userId ? parseInt((req.session as any).userId) : null,
        })
        .returning();

      res.json(photo);
    } catch (error: any) {
      console.error("Error uploading bale photo:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/factory/bale-photos/:photoId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const photoId = parseInt(req.params.photoId);

      const [photo] = await db
        .select()
        .from(factoryBalePhotos)
        .where(and(eq(factoryBalePhotos.id, photoId), eq(factoryBalePhotos.companyId, companyId)));

      if (!photo) return res.status(404).json({ message: "Photo not found" });

      const filename = photo.url?.split("/").pop();
      if (filename) {
        const filePath = path.join(process.cwd(), "uploads", "bale-photos", filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }

      await db
        .delete(factoryBalePhotos)
        .where(eq(factoryBalePhotos.id, photoId));

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting bale photo:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/uploads/bale-photos/:filename", requireAuth, (req: any, res: any) => {
    try {
      // Strip any directory component from the supplied filename so a caller
      // cannot escape the uploads/bale-photos directory with "../" segments.
      const safeName = path.basename(req.params.filename || "");
      if (!safeName || safeName.startsWith(".")) {
        return res.status(400).json({ message: "Invalid filename" });
      }
      const baseDir = path.resolve(process.cwd(), "uploads", "bale-photos");
      const filePath = path.resolve(baseDir, safeName);
      if (!filePath.startsWith(baseDir + path.sep)) {
        return res.status(400).json({ message: "Invalid filename" });
      }
      if (!fs.existsSync(filePath)) return res.status(404).json({ message: "File not found" });
      res.sendFile(filePath);
    } catch (error: any) {
      console.error("Error serving bale photo:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 11. Cash Flow Forecast
  // ───────────────────────────────────────────────

  app.get("/api/factory/cashflow", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const days = parseInt(req.query.days as string) || 30;
      const today = new Date();
      const futureDate = new Date();
      futureDate.setDate(today.getDate() + days);
      const todayStr = today.toISOString().split("T")[0];
      const futureDateStr = futureDate.toISOString().split("T")[0];

      const freightEntries = await db
        .select()
        .from(containerFreight)
        .where(and(
          eq(containerFreight.companyId, companyId),
          gte(containerFreight.dueDate, todayStr),
          lte(containerFreight.dueDate, futureDateStr)
        ));

      const freightPayments = await db
        .select()
        .from(containerFreightPayments)
        .where(eq(containerFreightPayments.companyId, companyId));

      const upcomingFreight: any[] = [];
      let totalFreightOutgoing = 0;

      for (const f of freightEntries) {
        const amount = parseFloat(f.freightAmount || "0");
        const paid = freightPayments
          .filter((p: any) => p.containerFreightId === f.id)
          .reduce((s: number, p: any) => s + parseFloat(p.amount || "0"), 0);
        const remaining = amount - paid;
        if (remaining > 0.01) {
          upcomingFreight.push({
            vendorName: f.vendorName || "Unknown",
            amount: Math.round(amount * 100) / 100,
            dueDate: f.dueDate,
            remaining: Math.round(remaining * 100) / 100,
          });
          totalFreightOutgoing += remaining;
        }
      }

      const activeWorkers = await db
        .select()
        .from(factoryWorkers)
        .where(and(eq(factoryWorkers.companyId, companyId), eq(factoryWorkers.active, true)));

      const totalMonthlyPayroll = activeWorkers.reduce((s: number, w: any) => {
        return s + parseFloat(w.baseSalary || "0");
      }, 0);

      const payPeriods = Math.ceil(days / 30);
      const payrollEstimate = totalMonthlyPayroll * payPeriods;

      const totalOutgoing = totalFreightOutgoing + payrollEstimate;

      const pendingOrders = await db
        .select()
        .from(customerOrders)
        .where(and(
          eq(customerOrders.companyId, companyId),
          eq(customerOrders.status, "FINALIZED")
        ));

      const expectedIncome = pendingOrders.reduce((s: number, o: any) =>
        s + parseFloat(o.grandTotal || "0"), 0);

      res.json({
        upcomingFreight,
        payrollEstimate: Math.round(payrollEstimate * 100) / 100,
        totalOutgoing: Math.round(totalOutgoing * 100) / 100,
        expectedIncome: Math.round(expectedIncome * 100) / 100,
      });
    } catch (error: any) {
      console.error("Error fetching cash flow forecast:", error);
      res.status(500).json({ message: error.message });
    }
  });
}
