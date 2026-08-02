/**
 * factoryBaleExportRoutes: FactoryDailyReport endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { logger } from "../../../lib/logger";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import { getUserHideAllCosts } from "../_helpers";
import { factoryMixBatches, factoryDailyUsages, factorySettings } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import path from "path";
import fs from "fs";

export function registerFactoryDailyReportRoutes(app: Express) {
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
    } catch (error: unknown) {
      logger.error("Error fetching daily report:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
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

      const [fCfgDR] = await db
        .select({ hideAvgCost: factorySettings.hideAvgCost })
        .from(factorySettings)
        .where(eq(factorySettings.companyId, companyId))
        .limit(1);
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

        const totalRowData: any = {
          date: "TOTAL",
          batchCode: "",
          batchName: "",
          operatorUser: "",
          kgUsed: totalKgUsed,
          notes: "",
        };
        if (showCostDR) totalRowData.costPerKg = "";
        const totalRow = sheet.addRow(totalRowData);
        totalRow.eachCell((cell) => {
          cell.font = { bold: true };
        });

        const xlsBuffer1 = Buffer.from(await workbook.xlsx.writeBuffer());
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="raw-production-report-${filenameDate}.xlsx"`);
        res.setHeader("Content-Length", xlsBuffer1.byteLength);
        return res.end(xlsBuffer1);
      }

      if (format === "pdf") {
        const PDFDocument = (await import("pdfkit")).default;
        const doc = new PDFDocument({ margin: 40, size: "A4", layout: "landscape" });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="raw-production-report-${filenameDate}.pdf"`);
        doc.pipe(res);

        const rpLogoPath = path.join(process.cwd(), "server", "hmd-logo.png");
        if (fs.existsSync(rpLogoPath)) {
          try {
            doc.image(rpLogoPath, (doc.page.width - 220) / 2, doc.y, { width: 220 });
            doc.moveDown(0.4);
          } catch {}
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
        doc
          .font("Helvetica-Bold")
          .fontSize(10)
          .text(`Total KG Consumed: ${totalKgUsed.toFixed(3)} kg`, { align: "right" });

        doc.end();
        return;
      }

      return res.status(400).json({ message: "Invalid format. Use excel or pdf." });
    } catch (error: unknown) {
      logger.error("Error exporting production report:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
