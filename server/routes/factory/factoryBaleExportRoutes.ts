import type { Express } from "express";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { classifyNetPositionAccounts } from "../../netPositionHelper";
import { adjustInventory } from "../../inventoryHelper";
import {
  writeDaybookEntry, getOrFetchFxRateToUsd, getOrCreateLedgerAccount,
  isLegacySHA256Hash, verifySupervisorPassword, getUserHideAllCosts,
} from "./_helpers";
import {
  factorySuppliers, factoryCategories, factoryBaleProducts,
  factoryContainers, factoryRawStock, factoryMixBatches,
  factoryMixBatchSources, factoryDailyUsages, factoryPressingBatches,
  factoryBales, factoryBaleSequences, factoryContainerCommissions,
  baleLabelPrints, stockItems, stockGroups, users,
  insertFactorySupplierSchema, insertFactoryCategorySchema,
  insertFactoryBaleProductSchema, insertFactoryContainerSchema,
  insertFactoryRawStockSchema, insertFactoryMixBatchSchema,
  insertFactoryMixBatchSourceSchema, insertFactoryPressingBatchSchema,
  insertFactoryBaleSchema, customerProformas, customerProformaLines,
  customerOrders, customerOrderLines, customerOrderBales,
  customerOrderCharges, customerInvoiceSequences, customerBalances,
  customers, insertCustomerSchema, ledgerAccounts, voucherEntries,
  companies, locations, userCompanyRoles, insertCustomerProformaSchema,
  insertCustomerProformaLineSchema, insertCustomerOrderSchema,
  factoryFxRates, insertFactoryFxRateSchema, factoryDaybookEntries,
  containerDocumentTypes, containerDocuments, containerFreight,
  containerFreightPayments, factoryDaybookEntryEdits,
  containers, factoryUserProfiles, factoryUserPageAccess,
  insertUserSchema, directMessages, insertDirectMessageSchema,
  userPresence, factoryDutyAuditLog, factoryOffloadAdditionalCharges,
  factoryContainerOtherCharges, companySettings, factorySettings,
  factoryWorkers, factoryWorkerCategories, insertFactoryWorkerCategorySchema,
  factoryRawMaterialAdjustments, factoryPayrolls, factoryWorkerDocuments,
  factoryAlerts, employees, factoryWasteEntries, factoryBalePhotos,
  factoryDailyKpiSnapshots, factorySupplierScoreSnapshots,
  factoryBaleCostSnapshots, factoryContainerProfitSnapshots,
  bankAccounts, inventory, exchangeRates, vouchers, suppliers,
  containerSales, factorySupplierPayments, insertFactorySupplierPaymentSchema,
  factorySupplierFxTransfers, insertFactorySupplierFxTransferSchema,
  factoryFxAllocations, baleRecodeSessions, baleRecodeItems,
  factoryWorkerAdvances, factoryAdvanceRepayments, factoryBaleWasteDispatches,
  factoryPosSales, factoryPosSaleItems, proformaStockReservations,
  factorySupplierCategories,
} from "@shared/schema";
import { eq, and, or, asc, desc, sql, inArray, ilike, ne, isNull, not, gte, lte, lt, gt, aliasedTable } from "drizzle-orm";
import bcrypt from "bcryptjs";
import CryptoJS from "crypto-js";
import multer from "multer";
import path from "path";
import fs from "fs";


export function registerFactoryBaleExportRoutes(app: Express) {
  app.get("/api/factory/daily-report", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const date = req.query.date as string | undefined;
      const allTime = !date || date === "all";

      const whereClause = allTime
        ? eq(factoryDailyUsages.companyId, companyId)
        : and(eq(factoryDailyUsages.companyId, companyId), sql`${factoryDailyUsages.usedDate} = ${date}`);

      const usages = await db
        .select({
          id: factoryDailyUsages.id,
          mixBatchId: factoryDailyUsages.mixBatchId,
          kgUsed: factoryDailyUsages.kgUsed,
          operatorUser: factoryDailyUsages.operatorUser,
          usedDate: factoryDailyUsages.usedDate,
          notes: factoryDailyUsages.notes,
          createdAt: factoryDailyUsages.createdAt,
          batchCode: factoryMixBatches.batchCode,
          batchName: factoryMixBatches.name,
          costPerKg: factoryMixBatches.costPerKg,
        })
        .from(factoryDailyUsages)
        .innerJoin(factoryMixBatches, eq(factoryDailyUsages.mixBatchId, factoryMixBatches.id))
        .where(whereClause)
        .orderBy(factoryDailyUsages.usedDate, factoryDailyUsages.createdAt);

      const totalKgUsed = usages.reduce((s: number, u: any) => s + (parseFloat(u.kgUsed) || 0), 0);
      res.json({ date: allTime ? "all" : date, allTime, usages, totalKgUsed: totalKgUsed.toFixed(3) });
    } catch (error: any) {
      console.error("Error fetching daily report:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/daily-report/export", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const dateParam = req.query.date as string | undefined;
      const format = (req.query.format as string) || "excel";
      const allTime = !dateParam || dateParam === "all";
      const filenameDate = allTime ? "all-time" : dateParam;

      const whereClause = allTime
        ? eq(factoryDailyUsages.companyId, companyId)
        : and(eq(factoryDailyUsages.companyId, companyId), sql`${factoryDailyUsages.usedDate} = ${dateParam}`);

      const usages = await db
        .select({
          id: factoryDailyUsages.id,
          mixBatchId: factoryDailyUsages.mixBatchId,
          kgUsed: factoryDailyUsages.kgUsed,
          operatorUser: factoryDailyUsages.operatorUser,
          usedDate: factoryDailyUsages.usedDate,
          notes: factoryDailyUsages.notes,
          createdAt: factoryDailyUsages.createdAt,
          batchCode: factoryMixBatches.batchCode,
          batchName: factoryMixBatches.name,
          costPerKg: factoryMixBatches.costPerKg,
        })
        .from(factoryDailyUsages)
        .innerJoin(factoryMixBatches, eq(factoryDailyUsages.mixBatchId, factoryMixBatches.id))
        .where(whereClause)
        .orderBy(factoryDailyUsages.usedDate, factoryDailyUsages.createdAt);

      const totalKgUsed = usages.reduce((s: number, u: any) => s + (parseFloat(u.kgUsed) || 0), 0);

      const [fCfgDR] = await db.select({ hideAvgCost: factorySettings.hideAvgCost }).from(factorySettings).where(eq(factorySettings.companyId, companyId)).limit(1);
      const userHideAllCostsDR = await getUserHideAllCosts(req);
      const showCostDR = !fCfgDR?.hideAvgCost && !userHideAllCostsDR;

      if (format === "excel") {
        const ExcelJS = (await import("exceljs")).default;
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Production Report");

        const drCols: any[] = [
          { header: "Date", key: "date", width: 14 },
          { header: "Batch Code", key: "batchCode", width: 18 },
          { header: "Batch Name", key: "batchName", width: 28 },
          { header: "Operator", key: "operatorUser", width: 20 },
          { header: "KG Used", key: "kgUsed", width: 14 },
        ];
        if (showCostDR) drCols.push({ header: "Cost / KG", key: "costPerKg", width: 14 });
        drCols.push({ header: "Notes", key: "notes", width: 32 });
        sheet.columns = drCols;

        const headerRow = sheet.getRow(1);
        headerRow.eachCell((cell) => {
          cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
        });

        for (const u of usages) {
          const rowData: any = {
            date: u.usedDate,
            batchCode: u.batchCode,
            batchName: u.batchName || "",
            operatorUser: u.operatorUser || "",
            kgUsed: parseFloat(u.kgUsed || "0"),
            notes: u.notes || "",
          };
          if (showCostDR) rowData.costPerKg = parseFloat(u.costPerKg || "0");
          sheet.addRow(rowData);
        }

        const totalRowData: any = { date: "TOTAL", batchCode: "", batchName: "", operatorUser: "", kgUsed: totalKgUsed, notes: "" };
        if (showCostDR) totalRowData.costPerKg = "";
        const totalRow = sheet.addRow(totalRowData);
        totalRow.eachCell((cell) => { cell.font = { bold: true }; });

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="raw-production-report-${filenameDate}.xlsx"`);
        await workbook.xlsx.write(res);
        return res.end();
      }

      if (format === "pdf") {
        const PDFDocument = (await import("pdfkit")).default;
        const doc = new PDFDocument({ margin: 40, size: "A4", layout: "landscape" });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="raw-production-report-${filenameDate}.pdf"`);
        doc.pipe(res);

        const rpLogoPath = path.join(process.cwd(), "server", "hmd-logo.png");
        if (fs.existsSync(rpLogoPath)) {
          try { doc.image(rpLogoPath, (doc.page.width - 220) / 2, doc.y, { width: 220 }); doc.moveDown(0.4); } catch {}
        }
        const title = allTime ? "Raw Production Report — All Time" : "Raw Production Report";
        doc.fontSize(16).font("Helvetica-Bold").text(title, { align: "center" });
        if (!allTime) doc.fontSize(11).font("Helvetica").text(`Date: ${dateParam}`, { align: "center" });
        doc.moveDown();

        // Landscape A4: usable width ~752px (margin 40 each side)
        const colX = [40, 120, 230, 380, 470, 545, 620];
        const colW = [75, 105, 145, 85, 70, 70, 120];
        const headers = ["Date", "Batch Code", "Batch Name", "Operator", "KG Used", "Cost/KG", "Notes"];

        doc.fontSize(9).font("Helvetica-Bold");
        headers.forEach((h, i) => doc.text(h, colX[i], doc.y, { continued: i < headers.length - 1, width: colW[i] }));
        doc.moveDown(0.3);
        doc.moveTo(40, doc.y).lineTo(752, doc.y).stroke();
        doc.moveDown(0.3);

        doc.font("Helvetica").fontSize(8);
        for (const u of usages) {
          const y = doc.y;
          const cols = [
            u.usedDate || "—",
            u.batchCode,
            u.batchName || "—",
            u.operatorUser || "—",
            `${parseFloat(u.kgUsed || "0").toFixed(3)} kg`,
            `$${parseFloat(u.costPerKg || "0").toFixed(4)}`,
            u.notes || "—",
          ];
          cols.forEach((c, i) => {
            doc.text(String(c), colX[i], y, { width: colW[i], lineBreak: false });
          });
          doc.moveDown(1);
          if (doc.y > doc.page.height - 80) {
            doc.addPage({ layout: "landscape" });
          }
        }

        doc.moveDown(0.5);
        doc.moveTo(40, doc.y).lineTo(752, doc.y).stroke();
        doc.moveDown(0.3);
        doc.font("Helvetica-Bold").fontSize(10).text(`Total KG Consumed: ${totalKgUsed.toFixed(3)} kg`, { align: "right" });

        doc.end();
        return;
      }

      return res.status(400).json({ message: "Invalid format. Use excel or pdf." });
    } catch (error: any) {
      console.error("Error exporting production report:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // Weekly pivot production report (by category × day)
  // ───────────────────────────────────────────────
  app.get("/api/factory/weekly-report/export", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const format = (req.query.format as string) || "excel";
      const period = (req.query.period as string) || "all"; // "all" | "year" | "month" | "week"

      // Helper: ISO week key "YYYY-Www"
      function isoWeekKey(dateStr: string): string {
        const d = new Date(dateStr + "T00:00:00");
        const day = d.getUTCDay();
        const diff = (day === 0 ? -6 : 1) - day;
        const mon = new Date(d);
        mon.setUTCDate(d.getUTCDate() + diff);
        const y = mon.getUTCFullYear();
        const jan4 = new Date(Date.UTC(y, 0, 4));
        const week = Math.ceil(((mon.getTime() - jan4.getTime()) / 86400000 + jan4.getUTCDay() + 1) / 7);
        return `${y}-W${String(week).padStart(2, "0")}`;
      }
      function mondayOfWeek(dateStr: string): string {
        const d = new Date(dateStr + "T00:00:00");
        const day = d.getUTCDay();
        const diff = (day === 0 ? -6 : 1) - day;
        d.setUTCDate(d.getUTCDate() + diff);
        return d.toISOString().slice(0, 10);
      }
      const DAY_NAMES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
      function dayName(dateStr: string): string {
        const d = new Date(dateStr + "T00:00:00");
        return DAY_NAMES[(d.getUTCDay() + 6) % 7];
      }
      function fmtDate(dateStr: string): string {
        const [, mm, dd] = dateStr.split("-");
        return `${dd}/${mm}`;
      }

      // Compute period filter boundary (inclusive start date, or null = no filter)
      const today = new Date();
      const todayStr = today.toISOString().slice(0, 10);
      let periodStart: string | null = null;
      if (period === "week") {
        periodStart = mondayOfWeek(todayStr);
      } else if (period === "month") {
        periodStart = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-01`;
      } else if (period === "year") {
        periodStart = `${today.getUTCFullYear()}-01-01`;
      }

      // 1. Fetch raw stock with supplier → category join (include containerId for scaling later)
      const rawStockRows = await db
        .select({
          containerId: factoryRawStock.containerId,
          supplierId: factoryContainers.supplierId,
          categoryId: factorySuppliers.supplierCategoryId,
          receivedKg: factoryRawStock.receivedKg,
          usedKg: factoryRawStock.usedKg,
          offloadedAt: factoryRawStock.offloadedAt,
        })
        .from(factoryRawStock)
        .innerJoin(factoryContainers, eq(factoryRawStock.containerId, factoryContainers.id))
        .leftJoin(factorySuppliers, eq(factoryContainers.supplierId, factorySuppliers.id))
        .where(and(eq(factoryRawStock.companyId, companyId), sql`${factoryContainers.status} != 'DELETED'`));

      // Fetch category names
      const catRows = await db
        .select({ id: factorySupplierCategories.id, name: factorySupplierCategories.name })
        .from(factorySupplierCategories)
        .where(eq(factorySupplierCategories.companyId, companyId));
      const catNameMap = new Map<number, string>(catRows.map((c: any) => [c.id, c.name]));

      // Map: categoryKey → { name, currentBalance }
      // categoryKey = categoryId (number) or "uncategorized"
      type CatKey = number | "uncategorized";
      const catBalMap = new Map<CatKey, { name: string; currentBalance: number }>();
      const getCatKey = (categoryId: number | null | undefined): CatKey =>
        (categoryId != null ? categoryId : "uncategorized") as CatKey;
      const getCatName = (categoryId: number | null | undefined): string =>
        categoryId != null ? (catNameMap.get(categoryId) || `Category ${categoryId}`) : "Uncategorized";

      // 2. Stock-in per category per date
      const stockInByDate = new Map<string, Map<CatKey, number>>();
      for (const r of rawStockRows) {
        const ck = getCatKey(r.categoryId as number | null);
        const catName = getCatName(r.categoryId as number | null);
        const remaining = (parseFloat(r.receivedKg as string) || 0) - (parseFloat(r.usedKg as string) || 0);
        if (catBalMap.has(ck)) {
          catBalMap.get(ck)!.currentBalance += remaining;
        } else {
          catBalMap.set(ck, { name: catName, currentBalance: remaining });
        }
        const dateStr = (r.offloadedAt as Date).toISOString().slice(0, 10);
        if (!stockInByDate.has(dateStr)) stockInByDate.set(dateStr, new Map());
        const dm = stockInByDate.get(dateStr)!;
        dm.set(ck, (dm.get(ck) || 0) + (parseFloat(r.receivedKg as string) || 0));
      }

      // 2b. Manual stock adjustments (ADD/REMOVE) — these live in factoryRawMaterialAdjustments,
      //     linked to a supplierId (not a container). Include them in stock-in, consumption, and
      //     the current-balance map so the opening-balance formula stays consistent.
      const manualAdjRows = await db
        .select({
          date: factoryRawMaterialAdjustments.date,
          type: factoryRawMaterialAdjustments.type,
          kg: factoryRawMaterialAdjustments.kg,
          catId: factorySuppliers.supplierCategoryId,
          supplierName: factorySuppliers.name,
        })
        .from(factoryRawMaterialAdjustments)
        .leftJoin(factorySuppliers, eq(factoryRawMaterialAdjustments.supplierId, factorySuppliers.id))
        .where(eq(factoryRawMaterialAdjustments.companyId, companyId));

      // REMOVE adjustments are collected here and merged into consumptionByDate after step 5 builds it
      const manualRemoveByDate = new Map<string, Map<CatKey, number>>();

      for (const adj of manualAdjRows) {
        const ck = getCatKey(adj.catId as number | null);
        const catName = getCatName(adj.catId as number | null);
        const kg = parseFloat(adj.kg as string) || 0;
        if (kg <= 0) continue;
        const isAdd = adj.type === "ADD";

        // Keep catBalMap in sync: ADD increases free stock, REMOVE decreases it
        if (catBalMap.has(ck)) {
          catBalMap.get(ck)!.currentBalance += isAdd ? kg : -kg;
        } else {
          catBalMap.set(ck, { name: catName, currentBalance: isAdd ? kg : -kg });
        }

        const dateStr = typeof adj.date === "string" ? adj.date.slice(0, 10) : (adj.date as any).toISOString().slice(0, 10);
        if (isAdd) {
          // Treat manual ADD the same as receiving container stock
          if (!stockInByDate.has(dateStr)) stockInByDate.set(dateStr, new Map());
          const dm = stockInByDate.get(dateStr)!;
          dm.set(ck, (dm.get(ck) || 0) + kg);
        } else {
          // Treat manual REMOVE as consumption on that date
          if (!manualRemoveByDate.has(dateStr)) manualRemoveByDate.set(dateStr, new Map());
          const dm = manualRemoveByDate.get(dateStr)!;
          dm.set(ck, (dm.get(ck) || 0) + kg);
        }
      }

      // Build a lookup: containerId → actual usedKg (from factoryRawStock)
      // This is the ground-truth for how much raw material was consumed from each container.
      const containerUsedKgMap = new Map<number, number>();
      for (const r of rawStockRows) {
        containerUsedKgMap.set(r.containerId as number, parseFloat(r.usedKg as string) || 0);
      }

      // 3. Fetch mix batch sources (container-type only) with their batch dates.
      //    We will scale their weights proportionally so that the total consumption per container
      //    exactly equals factoryRawStock.usedKg — eliminating any gap from edits, reversals, or
      //    legacy data that would otherwise produce spurious negative opening balances.
      const consumptionRows = await db
        .select({
          containerId: factoryMixBatchSources.containerId,
          batchDate: factoryMixBatches.batchDate,
          batchCreatedAt: factoryMixBatches.createdAt,
          catIdViaContainer: factorySuppliers.supplierCategoryId,
          weightKg: factoryMixBatchSources.weightKg,
        })
        .from(factoryMixBatchSources)
        .innerJoin(factoryMixBatches, eq(factoryMixBatchSources.mixBatchId, factoryMixBatches.id))
        .innerJoin(factoryContainers, eq(factoryMixBatchSources.containerId, factoryContainers.id))
        .leftJoin(factorySuppliers, eq(factoryContainers.supplierId, factorySuppliers.id))
        .where(and(
          eq(factoryMixBatches.companyId, companyId),
          not(isNull(factoryMixBatchSources.containerId)),
        ));

      // Pre-compute total tracked source weight per container (raw, unscaled)
      // Used in step 5b to find the gap between actual usedKg and tracked sources.
      const sourceSumByContainer = new Map<number, number>();
      for (const r of consumptionRows) {
        const cid = r.containerId as number;
        sourceSumByContainer.set(cid, (sourceSumByContainer.get(cid) || 0) + (parseFloat(r.weightKg as string) || 0));
      }

      // 5. Consumption map: date → categoryKey → kgConsumed
      //    Use raw source weights (unscaled). The gap between tracked sources and actual usedKg
      //    is filled in step 5b so the total per container exactly equals factoryRawStock.usedKg.
      const consumptionByDate = new Map<string, Map<CatKey, number>>();
      for (const r of consumptionRows) {
        const rawWeight = parseFloat(r.weightKg as string) || 0;
        if (rawWeight <= 0) continue;

        let dateStr: string;
        if (r.batchDate) {
          dateStr = typeof r.batchDate === "string" ? r.batchDate : (r.batchDate as Date).toISOString().slice(0, 10);
        } else {
          dateStr = (r.batchCreatedAt as Date).toISOString().slice(0, 10);
        }
        const effectiveCatId = r.catIdViaContainer as number | null;
        const ck = getCatKey(effectiveCatId);
        const catName = getCatName(effectiveCatId);
        if (!consumptionByDate.has(dateStr)) consumptionByDate.set(dateStr, new Map());
        consumptionByDate.get(dateStr)!.set(ck, (consumptionByDate.get(dateStr)!.get(ck) || 0) + rawWeight);
        if (!catBalMap.has(ck)) {
          catBalMap.set(ck, { name: catName, currentBalance: 0 });
        }
      }

      // 5b. Close the "no-source" gap: any container whose usedKg exceeds the sum of its tracked
      //     mix-batch sources has un-dated consumption. Attribute that gap to the container's
      //     offloadedAt date so the opening-balance formula always collapses to exactly zero.
      for (const r of rawStockRows) {
        const cid = r.containerId as number;
        const actualUsed = parseFloat(r.usedKg as string) || 0;
        if (actualUsed <= 0) continue;
        const sourceTotal = sourceSumByContainer.get(cid) || 0;
        const gap = actualUsed - sourceTotal;
        if (gap <= 0.001) continue; // no gap or fully covered by sources

        const dateStr = (r.offloadedAt as Date).toISOString().slice(0, 10);
        const ck = getCatKey(r.categoryId as number | null);
        const catName = getCatName(r.categoryId as number | null);
        if (!consumptionByDate.has(dateStr)) consumptionByDate.set(dateStr, new Map());
        consumptionByDate.get(dateStr)!.set(ck, (consumptionByDate.get(dateStr)!.get(ck) || 0) + gap);
        if (!catBalMap.has(ck)) catBalMap.set(ck, { name: catName, currentBalance: 0 });
      }

      // 5c. Merge manual REMOVE adjustments into consumptionByDate
      for (const [dateStr, catMap] of manualRemoveByDate) {
        if (!consumptionByDate.has(dateStr)) consumptionByDate.set(dateStr, new Map());
        const dm = consumptionByDate.get(dateStr)!;
        for (const [ck, kg] of catMap) {
          dm.set(ck, (dm.get(ck) || 0) + kg);
        }
      }

      // 6. Build week map from ALL dates (for correct opening balance computation)
      const allDates = new Set<string>([...consumptionByDate.keys(), ...stockInByDate.keys()]);
      const weekMap = new Map<string, string[]>();
      for (const d of allDates) {
        const wk = isoWeekKey(d);
        if (!weekMap.has(wk)) weekMap.set(wk, []);
        weekMap.get(wk)!.push(d);
      }
      const sortedWeekKeys = [...weekMap.keys()].sort();
      for (const wk of sortedWeekKeys) weekMap.get(wk)!.sort();

      if (sortedWeekKeys.length === 0) {
        if (format === "excel") {
          const ExcelJS = (await import("exceljs")).default;
          const wb = new ExcelJS.Workbook();
          const sh = wb.addWorksheet("Weekly Report");
          sh.addRow(["No data found"]);
          res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
          res.setHeader("Content-Disposition", `attachment; filename="weekly-production-report.xlsx"`);
          await wb.xlsx.write(res);
          return res.end();
        }
        return res.json({ message: "No data" });
      }

      // 7. Compute opening/closing balances forward from week 1 (all weeks, no filter yet)
      const allCatKeys = [...catBalMap.keys()];
      const weekConsumption = new Map<string, Map<CatKey, number>>();
      const weekStockIn = new Map<string, Map<CatKey, number>>();
      for (const wk of sortedWeekKeys) {
        const cMap = new Map<CatKey, number>();
        const sMap = new Map<CatKey, number>();
        for (const d of weekMap.get(wk)!) {
          for (const [ck, kg] of (consumptionByDate.get(d) || new Map())) cMap.set(ck, (cMap.get(ck) || 0) + kg);
          for (const [ck, kg] of (stockInByDate.get(d) || new Map())) sMap.set(ck, (sMap.get(ck) || 0) + kg);
        }
        weekConsumption.set(wk, cMap);
        weekStockIn.set(wk, sMap);
      }

      // Compute total stock-in and total consumption across ALL historical weeks so we can
      // back-calculate the true opening balance of the very first week.
      // Invariant: currentBalance = firstOpening + totalStockIn − totalConsumption
      // → firstOpening = currentBalance − totalStockIn + totalConsumption
      const totalStockInAll = new Map<CatKey, number>();
      const totalConsumptionAll = new Map<CatKey, number>();
      for (const wk of sortedWeekKeys) {
        for (const [ck, v] of weekStockIn.get(wk)!) totalStockInAll.set(ck, (totalStockInAll.get(ck) || 0) + v);
        for (const [ck, v] of weekConsumption.get(wk)!) totalConsumptionAll.set(ck, (totalConsumptionAll.get(ck) || 0) + v);
      }

      const openingBalances = new Map<string, Map<CatKey, number>>();
      const closingBalances = new Map<string, Map<CatKey, number>>();
      const firstOpening = new Map<CatKey, number>(
        allCatKeys.map(ck => [
          ck,
          (catBalMap.get(ck)?.currentBalance || 0) - (totalStockInAll.get(ck) || 0) + (totalConsumptionAll.get(ck) || 0),
        ])
      );
      openingBalances.set(sortedWeekKeys[0], firstOpening);
      for (let i = 0; i < sortedWeekKeys.length; i++) {
        const wk = sortedWeekKeys[i];
        const opening = openingBalances.get(wk)!;
        const closing = new Map<CatKey, number>();
        for (const ck of allCatKeys) {
          closing.set(ck, (opening.get(ck) || 0) + (weekStockIn.get(wk)!.get(ck) || 0) - (weekConsumption.get(wk)!.get(ck) || 0));
        }
        closingBalances.set(wk, closing);
        if (i < sortedWeekKeys.length - 1) openingBalances.set(sortedWeekKeys[i + 1], closing);
      }

      // Apply period filter — only display weeks within the selected range.
      // We include a week if ANY of its activity dates falls on or after the period start.
      const displayWeekKeys = periodStart
        ? sortedWeekKeys.filter(wk => {
            const dates = weekMap.get(wk)!;
            // Include the week if its LAST recorded date is >= period start,
            // OR if the week's Monday falls within the period (handles partially-started weeks)
            const lastDate = dates[dates.length - 1];
            const monDate = mondayOfWeek(dates[0]);
            return lastDate >= periodStart! || monDate >= periodStart!;
          })
        : sortedWeekKeys;

      const periodLabel = period === "week" ? "This Week"
        : period === "month" ? "This Month"
        : period === "year" ? "This Year"
        : "All Time";

      // 8. Excel generation
      if (format === "excel") {
        const ExcelJS = (await import("exceljs")).default;
        const wb = new ExcelJS.Workbook();
        const sh = wb.addWorksheet("Weekly Report");

        const BLUE = "FF1E40AF";
        const LIGHT_BLUE = "FFE0EAFF";
        const DARK_GRAY = "FF374151";
        const TOTAL_BG = "FFD1FAE5";
        const BORDER_STYLE: any = { style: "thin", color: { argb: "FFD1D5DB" } };
        const BORDER_ALL = { top: BORDER_STYLE, left: BORDER_STYLE, bottom: BORDER_STYLE, right: BORDER_STYLE };

        sh.getColumn(1).width = 24;
        sh.getColumn(2).width = 14;
        sh.getColumn(3).width = 12;

        let row = 1;

        if (displayWeekKeys.length === 0) {
          const msgRow = sh.getRow(row);
          const msgCell = msgRow.getCell(1);
          msgCell.value = `No production data found for period: ${periodLabel}`;
          msgCell.font = { italic: true, size: 11 };
          sh.mergeCells(row, 1, row, 12);
          row++;
        }

        for (const wk of displayWeekKeys) {
          const dates = weekMap.get(wk)!;
          const monDate = mondayOfWeek(dates[0]);
          const monD = new Date(monDate + "T00:00:00");
          const weekDaysMoSa: string[] = [];
          for (let di = 0; di < 7; di++) {
            const d = new Date(monD);
            d.setUTCDate(monD.getUTCDate() + di);
            weekDaysMoSa.push(d.toISOString().slice(0, 10));
          }

          const totalCols = 3 + weekDaysMoSa.length + 2; // CATEGORY + Balance + StockIn + days + TOTAL + REMAINS

          // ── Title row ──
          const titleRow = sh.getRow(row);
          const titleText = `Week of ${fmtDate(monDate)} – ${fmtDate(weekDaysMoSa[6])}  |  ${wk}`;
          const titleCell = titleRow.getCell(1);
          titleCell.value = titleText;
          titleCell.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
          titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
          titleCell.alignment = { horizontal: "center", vertical: "middle" };
          sh.mergeCells(row, 1, row, totalCols);
          titleRow.height = 22;
          row++;

          // ── Column header row ──
          const colHeaders = [
            "CATEGORY", "Balance", "Stock In",
            ...weekDaysMoSa.map(d => `${dayName(d)}\n${fmtDate(d)}`),
            "TOTAL", "REMAINS",
          ];
          const headerRow = sh.getRow(row);
          colHeaders.forEach((h, ci) => {
            const cell = headerRow.getCell(ci + 1);
            cell.value = h;
            cell.font = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DARK_GRAY } };
            cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
            cell.border = BORDER_ALL;
          });
          // Set day column widths
          for (let di = 0; di < weekDaysMoSa.length; di++) {
            sh.getColumn(4 + di).width = 10;
          }
          sh.getColumn(4 + weekDaysMoSa.length).width = 11;
          sh.getColumn(5 + weekDaysMoSa.length).width = 12;
          headerRow.height = 28;
          row++;

          const opening = openingBalances.get(wk)!;
          const sMap = weekStockIn.get(wk)!;

          // Active categories this week: include any category with non-zero consumption,
          // stock-in, or opening balance (including negative balances).
          const activeCats = allCatKeys.filter(ck => {
            return (weekConsumption.get(wk)!.get(ck) || 0) > 0.001
              || (sMap.get(ck) || 0) > 0.001
              || Math.abs(opening.get(ck) || 0) > 0.5;
          }).sort((a, b) => (catBalMap.get(a)?.name || "").localeCompare(catBalMap.get(b)?.name || ""));

          let weekTotalBalance = 0, weekTotalStockIn = 0, weekTotalTotal = 0, weekTotalRemains = 0;
          const weekTotalByDay = weekDaysMoSa.map(() => 0);

          for (const ck of activeCats) {
            const info = catBalMap.get(ck)!;
            const openBal = opening.get(ck) || 0;
            const stockIn = sMap.get(ck) || 0;
            const dayVals = weekDaysMoSa.map(d => consumptionByDate.get(d)?.get(ck) || 0);
            // Use authoritative weekConsumption (includes all 7 days) for TOTAL and REMAINS
            const total = weekConsumption.get(wk)!.get(ck) || 0;
            const remains = openBal + stockIn - total;

            weekTotalBalance += openBal;
            weekTotalStockIn += stockIn;
            weekTotalTotal += total;
            weekTotalRemains += remains;
            dayVals.forEach((v, i) => { weekTotalByDay[i] += v; });

            const dataRow = sh.getRow(row);
            const vals: (string | number | null)[] = [
              info.name,
              Math.round(openBal) || 0,
              stockIn > 0.5 ? Math.round(stockIn) : null,
              ...dayVals.map(v => v > 0.5 ? Math.round(v) : null),
              Math.round(total) > 0 ? Math.round(total) : null,
              Math.round(remains),
            ];
            vals.forEach((v, ci) => {
              const cell = dataRow.getCell(ci + 1);
              cell.value = v as any;
              cell.font = { size: 9 };
              cell.border = BORDER_ALL;
              if (ci === 0) {
                cell.font = { size: 9, bold: true };
                cell.alignment = { vertical: "middle" };
              } else {
                cell.alignment = { horizontal: "right", vertical: "middle" };
                cell.numFmt = "#,##0";
              }
              if (ci >= 3 && ci < 3 + weekDaysMoSa.length && typeof v === "number") {
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_BLUE } };
              }
            });
            dataRow.height = 16;
            row++;
          }

          // ── Totals row ──
          const totRow = sh.getRow(row);
          const totVals: (string | number | null)[] = [
            "TOTAL",
            Math.round(weekTotalBalance),
            weekTotalStockIn > 0.5 ? Math.round(weekTotalStockIn) : null,
            ...weekTotalByDay.map(v => Math.round(v) > 0 ? Math.round(v) : null),
            Math.round(weekTotalTotal) > 0 ? Math.round(weekTotalTotal) : null,
            Math.round(weekTotalRemains),
          ];
          totVals.forEach((v, ci) => {
            const cell = totRow.getCell(ci + 1);
            cell.value = v as any;
            cell.font = { bold: true, size: 9 };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_BG } };
            cell.border = BORDER_ALL;
            if (ci === 0) {
              cell.alignment = { vertical: "middle" };
            } else {
              cell.alignment = { horizontal: "right", vertical: "middle" };
              cell.numFmt = "#,##0";
            }
          });
          totRow.height = 18;
          row++;

          row++; // blank gap between weeks
        }

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="weekly-production-report.xlsx"`);
        await wb.xlsx.write(res);
        return res.end();
      }

      // PDF format
      if (format === "pdf") {
        const PDFDocument = (await import("pdfkit")).default;
        const doc = new PDFDocument({ margin: 30, size: "A4", layout: "landscape" });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="weekly-production-report.pdf"`);
        doc.pipe(res);

        const pageW = doc.page.width - 60;
        const rowH = 14;
        const wpLogoPath = path.join(process.cwd(), "server", "hmd-logo.png");

        // Show "no data" page when the selected period has no weeks
        if (displayWeekKeys.length === 0) {
          const hasLogo = fs.existsSync(wpLogoPath);
          if (hasLogo) {
            try { doc.image(wpLogoPath, (doc.page.width - 220) / 2, 10, { width: 220 }); } catch {}
            if (doc.y < 130) (doc as any).y = 130;
            doc.moveDown(0.5);
          }
          doc.fontSize(13).font("Helvetica-Bold")
            .text(`No production data found for period: ${periodLabel}`, 30, doc.y, { width: pageW, align: "center" });
          doc.end();
          return;
        }

        for (let wi = 0; wi < displayWeekKeys.length; wi++) {
          const wk = displayWeekKeys[wi];
          if (wi > 0) doc.addPage({ layout: "landscape" });

          // On the first page, place logo at top then continue below it.
          // On subsequent pages start from the top margin.
          let startY = 30; // default top margin
          if (wi === 0 && fs.existsSync(wpLogoPath)) {
            try {
              doc.image(wpLogoPath, (doc.page.width - 220) / 2, 10, { width: 220 });
              // Ensure we start below the logo — use whichever is lower: doc.y or a minimum clearance
              startY = Math.max(doc.y + 8, 130);
            } catch {
              startY = 30;
            }
          }

          const dates = weekMap.get(wk)!;
          const monDate = mondayOfWeek(dates[0]);
          const monD = new Date(monDate + "T00:00:00");
          const weekDaysMoSa: string[] = [];
          for (let di = 0; di < 7; di++) {
            const d = new Date(monD); d.setUTCDate(monD.getUTCDate() + di);
            weekDaysMoSa.push(d.toISOString().slice(0, 10));
          }

          const nDays = 7;
          const fixedW = 120 + 65 + 55 + 58 + 65;
          const dayW = Math.max(36, Math.floor((pageW - fixedW) / nDays));
          const colWidths = [120, 65, 55, ...Array(nDays).fill(dayW), 58, 65];
          const colX: number[] = [30];
          for (let i = 1; i < colWidths.length; i++) colX.push(colX[i - 1] + colWidths[i - 1]);

          const titleText = `Week ${wk}  |  ${fmtDate(monDate)} – ${fmtDate(weekDaysMoSa[6])}`;
          doc.fontSize(11).font("Helvetica-Bold").text(titleText, 30, startY, { width: pageW, align: "center" });
          doc.moveDown(0.3);

          const headers = ["CATEGORY", "Balance", "Stock In", ...weekDaysMoSa.map(d => `${dayName(d)}\n${fmtDate(d)}`), "TOTAL", "REMAINS"];
          const hy = doc.y;
          doc.fontSize(7).font("Helvetica-Bold");
          headers.forEach((h, i) => {
            const lines = h.split("\n");
            lines.forEach((line, li) => {
              doc.text(line, colX[i], hy + li * 8, { width: colWidths[i] - 2, align: i === 0 ? "left" : "right", lineBreak: false });
            });
          });
          const hh = rowH + (headers.some(h => h.includes("\n")) ? 8 : 0);
          const lineY = hy + hh;
          doc.moveTo(30, lineY).lineTo(30 + colWidths.reduce((a, b) => a + b, 0), lineY).stroke();

          const opening = openingBalances.get(wk)!;
          const sMap = weekStockIn.get(wk)!;
          const activeCats = allCatKeys.filter(ck =>
            (weekConsumption.get(wk)!.get(ck) || 0) > 0 || (sMap.get(ck) || 0) > 0 || (opening.get(ck) || 0) > 0
          ).sort((a, b) => (catBalMap.get(a)?.name || "").localeCompare(catBalMap.get(b)?.name || ""));

          let weekTotalBalance = 0, weekTotalStockIn = 0, weekTotalTotal = 0, weekTotalRemains = 0;
          const weekTotalByDay = Array(nDays).fill(0);
          let rowY = lineY + 3;
          doc.font("Helvetica").fontSize(7);

          for (const ck of activeCats) {
            const info = catBalMap.get(ck)!;
            const openBal = opening.get(ck) || 0;
            const stockIn = sMap.get(ck) || 0;
            const dayVals = weekDaysMoSa.map(d => consumptionByDate.get(d)?.get(ck) || 0);
            // Use authoritative weekConsumption (includes all 7 days) for TOTAL and REMAINS
            const total = weekConsumption.get(wk)!.get(ck) || 0;
            const remains = openBal + stockIn - total;
            weekTotalBalance += openBal; weekTotalStockIn += stockIn;
            weekTotalTotal += total; weekTotalRemains += remains;
            dayVals.forEach((v, i) => { weekTotalByDay[i] += v; });

            const rowVals = [
              info.name,
              Math.round(openBal).toLocaleString(),
              stockIn > 0.5 ? Math.round(stockIn).toLocaleString() : "-",
              ...dayVals.map(v => v > 0.5 ? Math.round(v).toLocaleString() : "-"),
              total > 0.5 ? Math.round(total).toLocaleString() : "-",
              Math.round(remains).toLocaleString(),
            ];
            rowVals.forEach((v, i) => {
              doc.text(String(v), colX[i], rowY, { width: colWidths[i] - 2, align: i === 0 ? "left" : "right", lineBreak: false });
            });
            rowY += rowH;
          }

          doc.moveTo(30, rowY).lineTo(30 + colWidths.reduce((a, b) => a + b, 0), rowY).strokeColor("#000000").stroke();
          rowY += 3;
          doc.font("Helvetica-Bold").fontSize(7);
          const totVals = [
            "TOTAL",
            Math.round(weekTotalBalance).toLocaleString(),
            weekTotalStockIn > 0.5 ? Math.round(weekTotalStockIn).toLocaleString() : "-",
            ...weekTotalByDay.map(v => v > 0.5 ? Math.round(v).toLocaleString() : "-"),
            weekTotalTotal > 0.5 ? Math.round(weekTotalTotal).toLocaleString() : "-",
            Math.round(weekTotalRemains).toLocaleString(),
          ];
          totVals.forEach((v, i) => {
            doc.text(String(v), colX[i], rowY, { width: colWidths[i] - 2, align: i === 0 ? "left" : "right", lineBreak: false });
          });
        }

        doc.end();
        return;
      }

      return res.status(400).json({ message: "Invalid format." });
    } catch (error: any) {
      console.error("Error generating weekly report:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 7. Factory Pressing (create-and-print)
  // ───────────────────────────────────────────────

  // ───────────────────────────────────────────────
  // 8. Daily Production Value Report
  // ───────────────────────────────────────────────
  app.get("/api/factory/production-value-report", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;

      // ── Build date range conditions ──
      // Use COALESCE(stock_entry_date, DATE(created_at)) so bales without a stock_entry_date
      // (e.g. wipers/garbage entered via stock import) are still included using their creation date.
      const baleConditions: any[] = [
        eq(factoryBales.companyId, companyId),
        // Exclude deleted/removed bales and REPACKED originals.
        // REPACKED: when a bale is repacked a new IN_STOCK bale is created with the same
        // weight; the original bale stays in the DB with status REPACKED.  Counting both
        // would double-count that weight in Productions.
        sql`${factoryBales.status} NOT IN ('DELETED', 'REMOVED', 'REPACKED')`,
      ];
      if (from) baleConditions.push(sql`COALESCE(DATE(${factoryBales.stockEntryDate}), DATE(${factoryBales.createdAt})) >= ${from}`);
      if (to)   baleConditions.push(sql`COALESCE(DATE(${factoryBales.stockEntryDate}), DATE(${factoryBales.createdAt})) <= ${to}`);

      // Exclude CARRY_FORWARD batches from the "Original Batches" total.
      // CARRY_FORWARD batches represent leftover material from a parent batch whose weight is
      // already counted in the parent's totalWeightKg.  Including them would double-count
      // that leftover and inflate the raw-material total.
      // Also exclude soft-deleted batches (deletedAt IS NOT NULL): their bales are deleted
      // and excluded from Productions, so counting them here would widen the gap unfairly.
      const mixBatchConditions: any[] = [
        eq(factoryMixBatches.companyId, companyId),
        sql`${factoryMixBatches.carryForwardFromId} IS NULL`,
        isNull(factoryMixBatches.deletedAt),
      ];
      if (from) mixBatchConditions.push(sql`COALESCE(${factoryMixBatches.batchDate}, DATE(${factoryMixBatches.createdAt})) >= ${from}`);
      if (to)   mixBatchConditions.push(sql`COALESCE(${factoryMixBatches.batchDate}, DATE(${factoryMixBatches.createdAt})) <= ${to}`);

      // ── Fetch bales with product cost price and category ──
      const baleRows = await db
        .select({
          id: factoryBales.id,
          articleCode: factoryBales.articleCode,
          productName: factoryBales.productName,
          weightKg: factoryBales.weightKg,
          stockEntryDate: factoryBales.stockEntryDate,
          productionPrice: factoryBaleProducts.productionPrice,
          productId: factoryBales.productId,
          categoryId: factoryBaleProducts.categoryId,
          categoryName: factoryCategories.name,
        })
        .from(factoryBales)
        .leftJoin(factoryBaleProducts, eq(factoryBales.productId, factoryBaleProducts.id))
        .leftJoin(factoryCategories, eq(factoryBaleProducts.categoryId, factoryCategories.id))
        .where(and(...baleConditions));

      // ── Helper: detect wipers/garbage by category name ──
      function isWiperOrGarbage(catName: string): boolean {
        const lower = (catName || "").toLowerCase();
        return lower.includes("wiper") || lower.includes("garbage") || lower.includes("rag");
      }

      // ── Aggregate by article code (regular bales only) ──
      const productMap = new Map<string, {
        articleCode: string;
        productName: string;
        categoryName: string;
        qty: number;
        totalWeightKg: number;
        costPricePerBale: number;
        totalValue: number;
      }>();

      // ── Aggregate by category (regular bales only) ──
      const categoryMap = new Map<string, {
        categoryName: string;
        qty: number;
        totalWeightKg: number;
        totalValue: number;
      }>();

      // ── Wipers & Garbage aggregation (separate) ──
      const wgMap = new Map<string, {
        subType: "wiper" | "garbage" | "other";
        qty: number;
        totalWeightKg: number;
        totalValue: number;
      }>();

      for (const bale of baleRows) {
        const code = bale.articleCode || "UNKNOWN";
        const name = bale.productName || code;
        const catName = bale.categoryName || "Uncategorized";
        const wt = parseFloat(bale.weightKg || "0");
        const price = parseFloat(bale.productionPrice || "0");
        const value = price; // price is per bale (not per kg)

        if (isWiperOrGarbage(catName)) {
          // Route to wipers/garbage bucket
          const lower = catName.toLowerCase();
          const subType: "wiper" | "garbage" | "other" = lower.includes("wiper") ? "wiper" : lower.includes("garbage") ? "garbage" : "other";
          const existing = wgMap.get(catName);
          if (existing) {
            existing.qty += 1;
            existing.totalWeightKg += wt;
            existing.totalValue += value;
          } else {
            wgMap.set(catName, { subType, qty: 1, totalWeightKg: wt, totalValue: value });
          }
        } else {
          // Regular bale
          const existing = productMap.get(code);
          if (existing) {
            existing.qty += 1;
            existing.totalWeightKg += wt;
            existing.totalValue += value;
          } else {
            productMap.set(code, { articleCode: code, productName: name, categoryName: catName, qty: 1, totalWeightKg: wt, costPricePerBale: price, totalValue: value });
          }

          const catExisting = categoryMap.get(catName);
          if (catExisting) {
            catExisting.qty += 1;
            catExisting.totalWeightKg += wt;
            catExisting.totalValue += value;
          } else {
            categoryMap.set(catName, { categoryName: catName, qty: 1, totalWeightKg: wt, totalValue: value });
          }
        }
      }

      const productRows = [...productMap.values()].sort((a, b) => a.articleCode.localeCompare(b.articleCode));
      const categoryRows = [...categoryMap.values()].sort((a, b) => a.categoryName.localeCompare(b.categoryName));

      const totalBales = productRows.reduce((s, r) => s + r.qty, 0);
      const totalBaleWeightKg = productRows.reduce((s, r) => s + r.totalWeightKg, 0);
      const totalProductionValue = productRows.reduce((s, r) => s + r.totalValue, 0);

      // ── Wipers/garbage totals ──
      const wgRows = [...wgMap.entries()].map(([catName, v]) => ({ categoryName: catName, ...v }));
      const totalWipersQty = wgRows.filter(r => r.subType === "wiper").reduce((s, r) => s + r.qty, 0);
      const totalWipersKg = wgRows.filter(r => r.subType === "wiper").reduce((s, r) => s + r.totalWeightKg, 0);
      const totalGarbageQty = wgRows.filter(r => r.subType === "garbage" || r.subType === "other").reduce((s, r) => s + r.qty, 0);
      const totalGarbageKg = wgRows.filter(r => r.subType === "garbage" || r.subType === "other").reduce((s, r) => s + r.totalWeightKg, 0);
      const totalWgValue = wgRows.reduce((s, r) => s + r.totalValue, 0);
      const totalWgWeightKg = wgRows.reduce((s, r) => s + r.totalWeightKg, 0);

      // ── Fetch mix batches ──
      const mixBatchRows = await db
        .select({
          id: factoryMixBatches.id,
          batchCode: factoryMixBatches.batchCode,
          name: factoryMixBatches.name,
          totalWeightKg: factoryMixBatches.totalWeightKg,
          usedKg: factoryMixBatches.usedKg,
          status: factoryMixBatches.status,
          costPerKg: factoryMixBatches.costPerKg,
          totalCost: factoryMixBatches.totalCost,
          batchDate: factoryMixBatches.batchDate,
          createdAt: factoryMixBatches.createdAt,
        })
        .from(factoryMixBatches)
        .where(and(...mixBatchConditions))
        .orderBy(sql`COALESCE(${factoryMixBatches.batchDate}, DATE(${factoryMixBatches.createdAt}))`);

      const totalMixWeightKg = mixBatchRows.reduce((s: number, r: any) => s + parseFloat(r.totalWeightKg || "0"), 0);
      const totalMixCost = mixBatchRows.reduce((s: number, r: any) => s + parseFloat(r.totalCost || "0"), 0);

      // Material from period batches that is still on the pressing table (not yet turned into bales).
      // Only ACTIVE batches have meaningful on-table material; COMPLETED batches set usedKg = totalWeightKg
      // when closed, so their contribution is already 0 by definition.
      const periodOnTableKg = mixBatchRows.reduce((s: number, r: any) => {
        if ((r.status || "ACTIVE") !== "ACTIVE") return s;
        const remaining = Math.max(0, parseFloat(r.totalWeightKg || "0") - parseFloat(r.usedKg || "0"));
        return s + remaining;
      }, 0);

      // ── Balance on table ──
      // "Balance on Table" is a CURRENT STATE metric: how much raw material has been mixed into
      // batches but not yet turned into finished bales.  We use the same formula as the Net
      // Position page: allTimeMixKg − allTimeBaleKg.  This is more robust than tracking
      // usedKg per-batch, which breaks when batches are marked COMPLETED prematurely.
      const mixAllTimeResult = await db.execute(sql`
        SELECT
          COALESCE(SUM(total_weight_kg::numeric), 0) AS mix_kg,
          COALESCE(SUM(total_cost::numeric),      0) AS mix_cost
        FROM factory_mix_batches
        WHERE company_id = ${companyId}
      `);
      const mixAllTimeRow = ((mixAllTimeResult as any).rows ?? (mixAllTimeResult as any))[0] ?? {};
      const allTimeMixKg   = parseFloat(String(mixAllTimeRow.mix_kg   ?? "0")) || 0;
      const allTimeMixCost = parseFloat(String(mixAllTimeRow.mix_cost  ?? "0")) || 0;

      const baleAllTimeResult = await db.execute(sql`
        SELECT COALESCE(SUM(b.weight_kg::numeric), 0) AS bale_kg
        FROM   factory_bales        b
        LEFT   JOIN factory_bale_products p ON p.id = b.product_id
        LEFT   JOIN factory_categories    c ON c.id = p.category_id
        WHERE  b.company_id = ${companyId}
          AND  b.status NOT IN ('DELETED', 'REMOVED')
      `);
      const baleAllTimeRow = ((baleAllTimeResult as any).rows ?? (baleAllTimeResult as any))[0] ?? {};
      const allTimeBaleKg  = parseFloat(String(baleAllTimeRow.bale_kg ?? "0")) || 0;

      const allTimeBlendedCpk = allTimeMixKg > 0 ? allTimeMixCost / allTimeMixKg : 0;
      const blendedCostPerKg  = totalMixWeightKg > 0 ? totalMixCost / totalMixWeightKg : 0;
      const balanceWeightKg   = Math.max(0, allTimeMixKg - allTimeBaleKg);
      const balanceValue      = Math.round(balanceWeightKg * allTimeBlendedCpk * 100) / 100;

      // ── STATUS = Production value − Batch cost ──
      const statusValue = totalProductionValue - totalMixCost;

      // ── Kg comparison ──
      const kgDiff = totalBaleWeightKg - totalMixWeightKg;

      res.json({
        from: from || null,
        to: to || null,
        production: {
          totalBales,
          totalWeightKg: totalBaleWeightKg,
          totalValue: totalProductionValue,
          byProduct: productRows,
          byCategory: categoryRows,
        },
        wipersGarbage: {
          totalWipersQty,
          totalWipersKg,
          totalGarbageQty,
          totalGarbageKg,
          totalWeightKg: totalWgWeightKg,
          totalValue: totalWgValue,
          rows: wgRows,
        },
        rawMaterial: {
          totalBatches: mixBatchRows.length,
          totalWeightKg: totalMixWeightKg,
          onTableKg: periodOnTableKg,
          totalCost: totalMixCost,
          blendedCostPerKg,
          batches: mixBatchRows,
        },
        balanceOnTable: {
          weightKg: balanceWeightKg,
          costPerKg: blendedCostPerKg,
          value: balanceValue,
        },
        summary: {
          batchCost: totalMixCost,
          productionValue: totalProductionValue,
          statusValue,
        },
        kgComparison: {
          producedKg: totalBaleWeightKg,
          mixedKg: totalMixWeightKg,
          diffKg: kgDiff,
          diffLabel: kgDiff >= 0 ? "more produced than mixed" : "less produced than mixed",
        },
      });
    } catch (error: any) {
      console.error("Error fetching production value report:", error);
      res.status(500).json({ message: error.message });
    }
  });

}
