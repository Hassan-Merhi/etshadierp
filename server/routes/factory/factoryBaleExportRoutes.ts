import type { Express } from "express";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { classifyNetPositionAccounts } from "../../netPositionHelper";
import { adjustInventory } from "../../inventoryHelper";
import {
  writeDaybookEntry, getOrFetchFxRateToUsd, getOrCreateLedgerAccount,
  isLegacySHA256Hash, verifySupervisorPassword,
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
} from "@shared/schema";
import { eq, and, or, asc, desc, sql, inArray, ilike, ne, isNull, not, gte, lte, lt, gt } from "drizzle-orm";
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
      const showCostDR = !fCfgDR?.hideAvgCost;

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
  // Weekly pivot production report (by supplier × day)
  // ───────────────────────────────────────────────
  app.get("/api/factory/weekly-report/export", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const format = (req.query.format as string) || "excel";

      // Helper: ISO week key "YYYY-Www"
      function isoWeekKey(dateStr: string): string {
        const d = new Date(dateStr + "T00:00:00");
        const day = d.getUTCDay(); // 0=Sun
        const diff = (day === 0 ? -6 : 1) - day; // shift to Monday
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
        const idx = (d.getUTCDay() + 6) % 7; // 0=Mon
        return DAY_NAMES[idx];
      }
      function fmtDate(dateStr: string): string {
        // "DD/MM" format
        const [, mm, dd] = dateStr.split("-");
        return `${dd}/${mm}`;
      }

      // 1. Current balance per supplier (remaining kg) from raw stock
      const rawStockRows = await db
        .select({
          supplierId: factoryContainers.supplierId,
          supplierName: factorySuppliers.name,
          receivedKg: factoryRawStock.receivedKg,
          usedKg: factoryRawStock.usedKg,
          offloadedAt: factoryRawStock.offloadedAt,
        })
        .from(factoryRawStock)
        .innerJoin(factoryContainers, eq(factoryRawStock.containerId, factoryContainers.id))
        .leftJoin(factorySuppliers, eq(factoryContainers.supplierId, factorySuppliers.id))
        .where(and(eq(factoryRawStock.companyId, companyId), sql`${factoryContainers.status} != 'DELETED'`));

      // Map: supplierId → { name, currentBalance }
      const supplierBalMap = new Map<number, { name: string; currentBalance: number }>();
      for (const r of rawStockRows) {
        const sid = r.supplierId as number;
        if (!sid) continue;
        const remaining = (parseFloat(r.receivedKg as string) || 0) - (parseFloat(r.usedKg as string) || 0);
        if (supplierBalMap.has(sid)) {
          supplierBalMap.get(sid)!.currentBalance += remaining;
        } else {
          supplierBalMap.set(sid, { name: r.supplierName || "Unknown", currentBalance: remaining });
        }
      }

      // 2. Stock-in per supplier per date (from offloadedAt of raw stock entries)
      // Map: date → supplierId → kg
      const stockInByDate = new Map<string, Map<number, number>>();
      for (const r of rawStockRows) {
        const sid = r.supplierId as number;
        if (!sid) continue;
        const dateStr = (r.offloadedAt as Date).toISOString().slice(0, 10);
        if (!stockInByDate.has(dateStr)) stockInByDate.set(dateStr, new Map());
        const dm = stockInByDate.get(dateStr)!;
        dm.set(sid, (dm.get(sid) || 0) + (parseFloat(r.receivedKg as string) || 0));
      }

      // 3. Get all daily usages for this company
      const usages = await db
        .select({
          id: factoryDailyUsages.id,
          mixBatchId: factoryDailyUsages.mixBatchId,
          kgUsed: factoryDailyUsages.kgUsed,
          usedDate: factoryDailyUsages.usedDate,
        })
        .from(factoryDailyUsages)
        .where(eq(factoryDailyUsages.companyId, companyId))
        .orderBy(factoryDailyUsages.usedDate);

      // 4. Get mix batch sources for all relevant batch IDs
      const batchIds = [...new Set(usages.map((u: any) => u.mixBatchId))];
      const batchSourceMap = new Map<number, Array<{ supplierId: number; supplierName: string; weightKg: number; fraction: number }>>();

      if (batchIds.length > 0) {
        const sourceRows = await db
          .select({
            mixBatchId: factoryMixBatchSources.mixBatchId,
            supplierId: factoryContainers.supplierId,
            supplierName: factorySuppliers.name,
            weightKg: factoryMixBatchSources.weightKg,
          })
          .from(factoryMixBatchSources)
          .leftJoin(factoryContainers, eq(factoryMixBatchSources.containerId, factoryContainers.id))
          .leftJoin(factorySuppliers, eq(factoryContainers.supplierId, factorySuppliers.id))
          .where(inArray(factoryMixBatchSources.mixBatchId, batchIds));

        // Aggregate by batch → supplier
        const batchRaw = new Map<number, Map<number, { name: string; weightKg: number }>>();
        for (const r of sourceRows) {
          const bid = r.mixBatchId;
          const sid = (r.supplierId as number) || 0;
          if (!sid) continue;
          if (!batchRaw.has(bid)) batchRaw.set(bid, new Map());
          const sm = batchRaw.get(bid)!;
          const w = parseFloat(r.weightKg as string) || 0;
          if (sm.has(sid)) {
            sm.get(sid)!.weightKg += w;
          } else {
            sm.set(sid, { name: r.supplierName || "Unknown", weightKg: w });
          }
        }

        // Compute fractions
        for (const [bid, srcMap] of batchRaw) {
          const totalW = [...srcMap.values()].reduce((s, v) => s + v.weightKg, 0);
          const sources = [...srcMap.entries()].map(([sid, v]) => ({
            supplierId: sid,
            supplierName: v.name,
            weightKg: v.weightKg,
            fraction: totalW > 0 ? v.weightKg / totalW : 0,
          }));
          batchSourceMap.set(bid, sources);
        }
      }

      // 5. Build consumption map: date → supplierId → kgConsumed
      const consumptionByDate = new Map<string, Map<number, number>>();
      for (const u of usages) {
        const dateStr = u.usedDate as string;
        const kgUsed = parseFloat(u.kgUsed as string) || 0;
        const sources = batchSourceMap.get(u.mixBatchId) || [];
        if (!consumptionByDate.has(dateStr)) consumptionByDate.set(dateStr, new Map());
        const dm = consumptionByDate.get(dateStr)!;
        if (sources.length === 0) continue;
        for (const src of sources) {
          const alloc = kgUsed * src.fraction;
          dm.set(src.supplierId, (dm.get(src.supplierId) || 0) + alloc);
          // Register supplier if not already known
          if (!supplierBalMap.has(src.supplierId)) {
            supplierBalMap.set(src.supplierId, { name: src.supplierName, currentBalance: 0 });
          }
        }
      }

      // 6. Collect all dates with any data (consumption OR stock-in) and group by week
      const allDates = new Set<string>([
        ...consumptionByDate.keys(),
        ...stockInByDate.keys(),
      ]);

      const weekMap = new Map<string, string[]>(); // weekKey → sorted dates
      for (const d of allDates) {
        const wk = isoWeekKey(d);
        if (!weekMap.has(wk)) weekMap.set(wk, []);
        weekMap.get(wk)!.push(d);
      }
      // Sort weeks and days
      const sortedWeekKeys = [...weekMap.keys()].sort();
      for (const wk of sortedWeekKeys) weekMap.get(wk)!.sort();

      // If no data, return an empty report
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

      // 7. Compute opening/closing balance per supplier per week
      // Strategy: work from latest week backwards.
      // currentBalance = balance right now.
      // openingBalance[lastWeek] = currentBalance + consumption[lastWeek] - stockIn[lastWeek]
      // openingBalance[prevWeek] = openingBalance[nextWeek] + consumption[prevWeek] - stockIn[prevWeek]
      // closingBalance[W] = openingBalance[nextWeek]

      const allSupplierIds = [...supplierBalMap.keys()];

      // Compute per-week totals for each supplier
      const weekConsumption = new Map<string, Map<number, number>>(); // weekKey → supplierId → kg
      const weekStockIn = new Map<string, Map<number, number>>();
      for (const wk of sortedWeekKeys) {
        const dates = weekMap.get(wk)!;
        const cMap = new Map<number, number>();
        const sMap = new Map<number, number>();
        for (const d of dates) {
          const cDay = consumptionByDate.get(d) || new Map();
          for (const [sid, kg] of cDay) { cMap.set(sid, (cMap.get(sid) || 0) + kg); }
          const sDay = stockInByDate.get(d) || new Map();
          for (const [sid, kg] of sDay) { sMap.set(sid, (sMap.get(sid) || 0) + kg); }
        }
        weekConsumption.set(wk, cMap);
        weekStockIn.set(wk, sMap);
      }

      // Opening balances: work backwards from current
      const openingBalances = new Map<string, Map<number, number>>(); // weekKey → supplierId → openingBal
      const closingBalances = new Map<string, Map<number, number>>();

      // Closing of last week = current balance
      const lastWk = sortedWeekKeys[sortedWeekKeys.length - 1];
      const lastClosing = new Map<number, number>();
      for (const sid of allSupplierIds) lastClosing.set(sid, supplierBalMap.get(sid)!.currentBalance);
      closingBalances.set(lastWk, lastClosing);

      // Compute opening of last week and backwards
      for (let i = sortedWeekKeys.length - 1; i >= 0; i--) {
        const wk = sortedWeekKeys[i];
        const closing = closingBalances.get(wk)!;
        const cMap = weekConsumption.get(wk)!;
        const sMap = weekStockIn.get(wk)!;
        const opening = new Map<number, number>();
        for (const sid of allSupplierIds) {
          opening.set(sid, (closing.get(sid) || 0) + (cMap.get(sid) || 0) - (sMap.get(sid) || 0));
        }
        openingBalances.set(wk, opening);
        if (i > 0) {
          // closing of previous week = opening of this week
          closingBalances.set(sortedWeekKeys[i - 1], opening);
        }
      }

      // 8. Generate Excel
      if (format === "excel") {
        const ExcelJS = (await import("exceljs")).default;
        const wb = new ExcelJS.Workbook();
        const sh = wb.addWorksheet("Weekly Report");
        sh.properties.defaultColWidth = 12;

        const BLUE = "FF1E40AF";
        const LIGHT_BLUE = "FFE0EAFF";
        const DARK_GRAY = "FF374151";
        const TOTAL_BG = "FFD1FAE5";
        const BORDER_STYLE: any = { style: "thin", color: { argb: "FFD1D5DB" } };
        const BORDER_ALL = { top: BORDER_STYLE, left: BORDER_STYLE, bottom: BORDER_STYLE, right: BORDER_STYLE };

        let row = 1;

        for (const wk of sortedWeekKeys) {
          const dates = weekMap.get(wk)!;
          const monDate = mondayOfWeek(dates[0]);
          const satDate = dates[dates.length - 1];

          // Full Mon-Sat date list for the week (fill in missing days)
          const weekDays: string[] = [];
          const monD = new Date(monDate + "T00:00:00");
          for (let di = 0; di < 7; di++) {
            const d = new Date(monD);
            d.setUTCDate(monD.getUTCDate() + di);
            const ds = d.toISOString().slice(0, 10);
            weekDays.push(ds);
          }
          // Mon-Sat only (first 6)
          const weekDaysMoSa = weekDays.slice(0, 6);

          // Title row for this week
          const titleRow = sh.getRow(row);
          const titleText = `Week of ${fmtDate(monDate)} – ${fmtDate(weekDaysMoSa[5])}  |  ${wk}`;
          titleRow.getCell(1).value = titleText;
          titleRow.getCell(1).font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
          titleRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
          sh.mergeCells(row, 1, row, 3 + weekDaysMoSa.length + 2);
          titleRow.height = 20;
          row++;

          // Column header row
          const colHeaders = ["TYPE", "Balance", "Stock In", ...weekDaysMoSa.map(d => `${dayName(d)}\n${fmtDate(d)}`), "TOTAL", "REMAINS"];
          const headerRow = sh.getRow(row);
          colHeaders.forEach((h, ci) => {
            const cell = headerRow.getCell(ci + 1);
            cell.value = h;
            cell.font = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DARK_GRAY } };
            cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
            cell.border = BORDER_ALL;
          });
          sh.getColumn(1).width = 22;
          sh.getColumn(2).width = 14;
          sh.getColumn(3).width = 11;
          headerRow.height = 28;
          row++;

          const opening = openingBalances.get(wk)!;
          const cMap = weekConsumption.get(wk)!;
          const sMap = weekStockIn.get(wk)!;

          // Supplier rows — only those with any activity this week or a non-zero balance
          const activeSuppliers = allSupplierIds.filter(sid => {
            const hasCons = [...(weekConsumption.get(wk)?.get(sid) ? [1] : [])].length > 0;
            const hasSI = (sMap.get(sid) || 0) > 0;
            const hasBalance = (opening.get(sid) || 0) > 0;
            return hasCons || hasSI || hasBalance;
          }).sort((a, b) => (supplierBalMap.get(a)?.name || "").localeCompare(supplierBalMap.get(b)?.name || ""));

          let weekTotalBalance = 0, weekTotalStockIn = 0, weekTotalTotal = 0, weekTotalRemains = 0;
          const weekTotalByDay = weekDaysMoSa.map(() => 0);

          for (const sid of activeSuppliers) {
            const sInfo = supplierBalMap.get(sid)!;
            const openBal = opening.get(sid) || 0;
            const stockIn = sMap.get(sid) || 0;
            const dayVals = weekDaysMoSa.map(d => (consumptionByDate.get(d)?.get(sid) || 0));
            const total = dayVals.reduce((s, v) => s + v, 0);
            const remains = openBal + stockIn - total;

            weekTotalBalance += openBal;
            weekTotalStockIn += stockIn;
            weekTotalTotal += total;
            weekTotalRemains += remains;
            dayVals.forEach((v, i) => { weekTotalByDay[i] += v; });

            const dataRow = sh.getRow(row);
            const vals = [sInfo.name, openBal, stockIn > 0 ? stockIn : null, ...dayVals.map(v => v > 0.001 ? Math.round(v) : null), Math.round(total) || null, Math.round(remains)];
            vals.forEach((v, ci) => {
              const cell = dataRow.getCell(ci + 1);
              cell.value = v;
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

          // Totals row
          const totRow = sh.getRow(row);
          const totVals = ["TOTAL", weekTotalBalance, weekTotalStockIn > 0 ? weekTotalStockIn : null, ...weekTotalByDay.map(v => Math.round(v) || null), Math.round(weekTotalTotal) || null, Math.round(weekTotalRemains)];
          totVals.forEach((v, ci) => {
            const cell = totRow.getCell(ci + 1);
            cell.value = v;
            cell.font = { bold: true, size: 9 };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_BG } };
            cell.border = BORDER_ALL;
            if (ci === 0) { cell.alignment = { vertical: "middle" }; }
            else { cell.alignment = { horizontal: "right", vertical: "middle" }; cell.numFmt = "#,##0"; }
          });
          totRow.height = 18;
          row++;

          // Blank gap row between weeks
          row++;
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

        const pageW = doc.page.width - 60; // usable width
        const rowH = 14;

        const wpLogoPath = path.join(process.cwd(), "server", "hmd-logo.png");

        for (let wi = 0; wi < sortedWeekKeys.length; wi++) {
          const wk = sortedWeekKeys[wi];
          if (wi > 0) doc.addPage({ layout: "landscape" });

          if (wi === 0 && fs.existsSync(wpLogoPath)) {
            try { doc.image(wpLogoPath, (doc.page.width - 220) / 2, 10, { width: 220 }); } catch {}
            doc.moveDown(0.5);
          }

          const dates = weekMap.get(wk)!;
          const monDate = mondayOfWeek(dates[0]);
          const monD = new Date(monDate + "T00:00:00");
          const weekDaysMoSa: string[] = [];
          for (let di = 0; di < 6; di++) {
            const d = new Date(monD); d.setUTCDate(monD.getUTCDate() + di);
            weekDaysMoSa.push(d.toISOString().slice(0, 10));
          }

          // Column layout: TYPE(120) | Balance(65) | StockIn(55) | days(48 each) | TOTAL(58) | REMAINS(65)
          const nDays = 6;
          const fixedW = 120 + 65 + 55 + 58 + 65;
          const dayW = Math.max(40, Math.floor((pageW - fixedW) / nDays));
          const colWidths = [120, 65, 55, ...Array(nDays).fill(dayW), 58, 65];
          const colX: number[] = [30];
          for (let i = 1; i < colWidths.length; i++) colX.push(colX[i - 1] + colWidths[i - 1]);

          // Week title
          const titleText = `Week ${wk}  |  ${fmtDate(monDate)} – ${fmtDate(weekDaysMoSa[5])}`;
          doc.fontSize(11).font("Helvetica-Bold").text(titleText, 30, 30, { width: pageW });
          doc.moveDown(0.3);

          // Draw header
          const headers = ["TYPE", "Balance", "Stock In", ...weekDaysMoSa.map(d => `${dayName(d)}\n${fmtDate(d)}`), "TOTAL", "REMAINS"];
          const hy = doc.y;
          doc.fontSize(7).font("Helvetica-Bold");
          headers.forEach((h, i) => {
            const lines = h.split("\n");
            lines.forEach((line, li) => {
              doc.text(line, colX[i], hy + li * 8, { width: colWidths[i] - 2, align: i === 0 ? "left" : "right", lineBreak: false });
            });
          });
          const hh = rowH + (headers.some(h => h.includes("\n")) ? 8 : 0);
          doc.moveDown(0.1);
          const lineY = hy + hh;
          doc.moveTo(30, lineY).lineTo(30 + colWidths.reduce((a, b) => a + b, 0), lineY).stroke();

          const opening = openingBalances.get(wk)!;
          const cMap = weekConsumption.get(wk)!;
          const sMap = weekStockIn.get(wk)!;

          const activeSuppliers = allSupplierIds.filter(sid => {
            return (cMap.get(sid) || 0) > 0 || (sMap.get(sid) || 0) > 0 || (opening.get(sid) || 0) > 0;
          }).sort((a, b) => (supplierBalMap.get(a)?.name || "").localeCompare(supplierBalMap.get(b)?.name || ""));

          let weekTotalBalance = 0, weekTotalStockIn = 0, weekTotalTotal = 0, weekTotalRemains = 0;
          const weekTotalByDay = Array(nDays).fill(0);

          let rowY = lineY + 3;
          doc.font("Helvetica").fontSize(7);

          for (const sid of activeSuppliers) {
            const sInfo = supplierBalMap.get(sid)!;
            const openBal = opening.get(sid) || 0;
            const stockIn = sMap.get(sid) || 0;
            const dayVals = weekDaysMoSa.map(d => consumptionByDate.get(d)?.get(sid) || 0);
            const total = dayVals.reduce((s, v) => s + v, 0);
            const remains = openBal + stockIn - total;

            weekTotalBalance += openBal; weekTotalStockIn += stockIn;
            weekTotalTotal += total; weekTotalRemains += remains;
            dayVals.forEach((v, i) => { weekTotalByDay[i] += v; });

            const rowVals = [
              sInfo.name,
              Math.round(openBal).toLocaleString(),
              stockIn > 0.001 ? Math.round(stockIn).toLocaleString() : "-",
              ...dayVals.map(v => v > 0.001 ? Math.round(v).toLocaleString() : "-"),
              total > 0.001 ? Math.round(total).toLocaleString() : "-",
              Math.round(remains).toLocaleString(),
            ];
            rowVals.forEach((v, i) => {
              doc.text(String(v), colX[i], rowY, { width: colWidths[i] - 2, align: i === 0 ? "left" : "right", lineBreak: false });
            });
            rowY += rowH;
          }

          // Totals row
          doc.moveTo(30, rowY).lineTo(30 + colWidths.reduce((a, b) => a + b, 0), rowY).strokeColor("#000000").stroke();
          rowY += 3;
          doc.font("Helvetica-Bold").fontSize(7);
          const totVals = [
            "TOTAL",
            Math.round(weekTotalBalance).toLocaleString(),
            weekTotalStockIn > 0.001 ? Math.round(weekTotalStockIn).toLocaleString() : "-",
            ...weekTotalByDay.map(v => v > 0.001 ? Math.round(v).toLocaleString() : "-"),
            weekTotalTotal > 0.001 ? Math.round(weekTotalTotal).toLocaleString() : "-",
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
        // Only count bales that have been pressed (IN_STOCK, FINALIZED, SOLD, or DISPATCHED to waste)
        sql`${factoryBales.status} IN ('IN_STOCK','FINALIZED','SOLD','DISPATCHED')`,
      ];
      if (from) baleConditions.push(sql`COALESCE(DATE(${factoryBales.stockEntryDate}), DATE(${factoryBales.createdAt})) >= ${from}`);
      if (to)   baleConditions.push(sql`COALESCE(DATE(${factoryBales.stockEntryDate}), DATE(${factoryBales.createdAt})) <= ${to}`);

      const mixBatchConditions: any[] = [eq(factoryMixBatches.companyId, companyId)];
      if (from) mixBatchConditions.push(sql`DATE(${factoryMixBatches.createdAt}) >= ${from}`);
      if (to)   mixBatchConditions.push(sql`DATE(${factoryMixBatches.createdAt}) <= ${to}`);

      // ── Fetch bales with product selling price and category ──
      const baleRows = await db
        .select({
          id: factoryBales.id,
          articleCode: factoryBales.articleCode,
          productName: factoryBales.productName,
          weightKg: factoryBales.weightKg,
          stockEntryDate: factoryBales.stockEntryDate,
          sellingPrice: factoryBaleProducts.sellingPrice,
          productId: factoryBales.productId,
          categoryId: factoryBaleProducts.categoryId,
          categoryName: factoryCategories.name,
        })
        .from(factoryBales)
        .leftJoin(factoryBaleProducts, eq(factoryBales.productId, factoryBaleProducts.id))
        .leftJoin(factoryCategories, eq(factoryBaleProducts.categoryId, factoryCategories.id))
        .where(and(...baleConditions));

      // ── Aggregate by article code ──
      const productMap = new Map<string, {
        articleCode: string;
        productName: string;
        categoryName: string;
        qty: number;
        totalWeightKg: number;
        sellingPricePerBale: number;
        totalValue: number;
      }>();

      // ── Aggregate by category ──
      const categoryMap = new Map<string, {
        categoryName: string;
        qty: number;
        totalWeightKg: number;
        totalValue: number;
      }>();

      for (const bale of baleRows) {
        const code = bale.articleCode || "UNKNOWN";
        const name = bale.productName || code;
        const catName = bale.categoryName || "Uncategorized";
        const wt = parseFloat(bale.weightKg || "0");
        const price = parseFloat(bale.sellingPrice || "0");
        const value = price; // price is per bale (not per kg)

        const existing = productMap.get(code);
        if (existing) {
          existing.qty += 1;
          existing.totalWeightKg += wt;
          existing.totalValue += value;
        } else {
          productMap.set(code, { articleCode: code, productName: name, categoryName: catName, qty: 1, totalWeightKg: wt, sellingPricePerBale: price, totalValue: value });
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

      const productRows = [...productMap.values()].sort((a, b) => a.articleCode.localeCompare(b.articleCode));
      const categoryRows = [...categoryMap.values()].sort((a, b) => a.categoryName.localeCompare(b.categoryName));

      const totalBales = productRows.reduce((s, r) => s + r.qty, 0);
      const totalBaleWeightKg = productRows.reduce((s, r) => s + r.totalWeightKg, 0);
      const totalProductionValue = productRows.reduce((s, r) => s + r.totalValue, 0);

      // ── Fetch mix batches ──
      const mixBatchRows = await db
        .select({
          id: factoryMixBatches.id,
          batchCode: factoryMixBatches.batchCode,
          name: factoryMixBatches.name,
          totalWeightKg: factoryMixBatches.totalWeightKg,
          costPerKg: factoryMixBatches.costPerKg,
          totalCost: factoryMixBatches.totalCost,
          createdAt: factoryMixBatches.createdAt,
        })
        .from(factoryMixBatches)
        .where(and(...mixBatchConditions))
        .orderBy(factoryMixBatches.createdAt);

      const totalMixWeightKg = mixBatchRows.reduce((s: number, r: any) => s + parseFloat(r.totalWeightKg || "0"), 0);
      const totalMixCost = mixBatchRows.reduce((s: number, r: any) => s + parseFloat(r.totalCost || "0"), 0);

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
        rawMaterial: {
          totalBatches: mixBatchRows.length,
          totalWeightKg: totalMixWeightKg,
          totalCost: totalMixCost,
          batches: mixBatchRows,
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
