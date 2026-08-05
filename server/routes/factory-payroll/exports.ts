import { toArrayBuffer } from "../../lib/bufferCompatibility";
/**
 * factoryPayrollRoutes: FactoryPayrollExport endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { logAudit } from "../helpers/auditHelpers";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { eq, and, gte, lte } from "drizzle-orm";
import PDFDocument from "pdfkit";
import path from "path";
import fs from "fs";
import ExcelJS from "exceljs";
import { factoryWorkers, factoryPayrolls, companies } from "@shared/schema";

export function registerFactoryPayrollExportRoutes(app: Express, requireAuth: any, db: any) {
  app.post("/api/factory/payroll/export-pdf", requireAuth, async (req: any, res: any) => {
    try {
      const { companyId, startDate, endDate } = req.body;
      if (!companyId || !startDate || !endDate) {
        return res.status(400).json({ message: "companyId, startDate, and endDate are required" });
      }

      const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
      const companyName = company?.name || "Company";

      const payrollData = await db
        .select({
          payroll: factoryPayrolls,
          workerName: factoryWorkers.fullName,
          workerCode: factoryWorkers.employeeCode,
          workerPosition: factoryWorkers.position,
        })
        .from(factoryPayrolls)
        .leftJoin(factoryWorkers, eq(factoryPayrolls.workerId, factoryWorkers.id))
        .where(
          and(
            eq(factoryPayrolls.companyId, companyId),
            gte(factoryPayrolls.periodStart, startDate),
            lte(factoryPayrolls.periodEnd, endDate)
          )
        )
        .orderBy(factoryWorkers.fullName);

      const doc = new PDFDocument({ margin: 30, size: "A4", layout: "landscape" });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=payroll_${startDate}_${endDate}.pdf`);
      try {
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || req.session.userId!,
          companyId: parseInt(companyId),
          action: "export",
          tableName: "factory_payrolls",
          recordId: null,
          recordIdentifier: `PDF export — period ${startDate} to ${endDate}`,
          changes: null,
        });
      } catch (auditErr) {
        logger.error("[payroll export-pdf audit] non-fatal:", { error: auditErr });
      }
      doc.pipe(res);

      const hmdLogoPath = path.join(process.cwd(), "server", "hmd-logo.png");
      if (fs.existsSync(hmdLogoPath)) {
        try {
          doc.image(hmdLogoPath, (doc.page.width - 220) / 2, doc.y, { width: 220 });
          doc.moveDown(0.5);
        } catch {}
      }
      doc.fontSize(12).font("Helvetica").text("Factory Payroll Report", { align: "center" });
      doc.fontSize(10).text(`Period: ${startDate} to ${endDate}`, { align: "center" });
      doc.moveDown(1);

      // Columns: Code | Name | Days(P/T) | Absent | Base | Bale | KG | OT | Bonus | Deduct | Net
      const headers = ["Code", "Name", "Days", "Absent", "Base", "Bale", "KG", "OT", "Bonus", "Deduct", "Net"];
      const colWidths = [50, 110, 55, 50, 62, 55, 55, 50, 50, 52, 65];
      const startX = 30;
      let y = doc.y;

      doc.fontSize(8).font("Helvetica-Bold");
      let x = startX;
      headers.forEach((h, i) => {
        doc.text(h, x, y, { width: colWidths[i], align: i >= 2 ? "right" : "left" });
        x += colWidths[i];
      });

      y += 15;
      doc
        .moveTo(startX, y)
        .lineTo(startX + colWidths.reduce((a, b) => a + b, 0), y)
        .stroke();
      y += 5;

      doc.font("Helvetica").fontSize(7);

      const totals = { base: 0, bale: 0, kg: 0, ot: 0, bonus: 0, deduct: 0, net: 0 };

      for (const row of payrollData) {
        const p = row.payroll;
        const base = parseFloat(p.baseSalary || "0");
        const bale = parseFloat(p.baleEarnings || "0");
        const kg = parseFloat(p.kgEarnings || "0");
        const ot = parseFloat(p.overtimePay || "0");
        const bonus = parseFloat(p.bonuses || "0");
        const deduct = parseFloat(p.deductions || "0");
        const net = parseFloat(p.netSalary || "0");
        const totalDays = p.totalWorkingDays || 0;
        const present = parseFloat(p.presentDays || "0");
        const absent = parseFloat(p.absentDays || "0");

        totals.base += base;
        totals.bale += bale;
        totals.kg += kg;
        totals.ot += ot;
        totals.bonus += bonus;
        totals.deduct += deduct;
        totals.net += net;

        if (y > 550) {
          doc.addPage();
          y = 30;
        }

        const daysLabel = totalDays > 0 ? `${present % 1 === 0 ? present.toFixed(0) : present}/${totalDays}` : "—";
        const absentLabel = totalDays > 0 ? (absent % 1 === 0 ? absent.toFixed(0) : String(absent)) : "—";

        const values = [
          row.workerCode || "-",
          row.workerName || "-",
          daysLabel,
          absentLabel,
          base.toFixed(2),
          bale.toFixed(2),
          kg.toFixed(2),
          ot.toFixed(2),
          bonus.toFixed(2),
          deduct.toFixed(2),
          net.toFixed(2),
        ];

        x = startX;
        values.forEach((v, i) => {
          doc.text(v, x, y, { width: colWidths[i], align: i >= 2 ? "right" : "left" });
          x += colWidths[i];
        });
        y += 12;
      }

      y += 5;
      doc
        .moveTo(startX, y)
        .lineTo(startX + colWidths.reduce((a, b) => a + b, 0), y)
        .stroke();
      y += 5;

      doc.font("Helvetica-Bold").fontSize(8);
      const totalValues = [
        "",
        "TOTALS",
        "",
        "",
        totals.base.toFixed(2),
        totals.bale.toFixed(2),
        totals.kg.toFixed(2),
        totals.ot.toFixed(2),
        totals.bonus.toFixed(2),
        totals.deduct.toFixed(2),
        totals.net.toFixed(2),
      ];
      x = startX;
      totalValues.forEach((v, i) => {
        doc.text(v, x, y, { width: colWidths[i], align: i >= 2 ? "right" : "left" });
        x += colWidths[i];
      });

      doc.end();
    } catch (error: unknown) {
      logger.error("Error exporting payroll PDF:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.post("/api/factory/payroll/export-excel", requireAuth, async (req: any, res: any) => {
    try {
      const { companyId, startDate, endDate } = req.body;
      if (!companyId || !startDate || !endDate) {
        return res.status(400).json({ message: "companyId, startDate, and endDate are required" });
      }

      const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
      const companyName = company?.name || "Company";

      const payrollData = await db
        .select({
          payroll: factoryPayrolls,
          worker: factoryWorkers,
        })
        .from(factoryPayrolls)
        .leftJoin(factoryWorkers, eq(factoryPayrolls.workerId, factoryWorkers.id))
        .where(
          and(
            eq(factoryPayrolls.companyId, companyId),
            gte(factoryPayrolls.periodStart, startDate),
            lte(factoryPayrolls.periodEnd, endDate)
          )
        )
        .orderBy(factoryWorkers.fullName);

      const workbook = new ExcelJS.Workbook();
      const xlogoPath = path.join(process.cwd(), "server", "hmd-logo.png");
      let xlogoId: number | null = null;
      try {
        if (fs.existsSync(xlogoPath)) {
          const buf = fs.readFileSync(xlogoPath);
          xlogoId = workbook.addImage({ buffer: toArrayBuffer(buf), extension: "jpeg" });
        }
      } catch {}

      function addSheetHeader(sheet: ExcelJS.Worksheet, title: string, numCols: number, logoCenterCol: number = 0) {
        const logoRow = sheet.addRow([]);
        logoRow.height = 90;
        if (xlogoId !== null)
          sheet.addImage(xlogoId, { tl: { col: logoCenterCol, row: 0 }, ext: { width: 300, height: 90 } });
        const rName = sheet.addRow(["HMD INTERNATIONAL GROUP"]);
        rName.getCell(1).font = { bold: true, size: 16, color: { argb: "FF1F3864" } };
        rName.getCell(1).alignment = { horizontal: "center" };
        sheet.mergeCells(rName.number, 1, rName.number, numCols);
        const rTitle = sheet.addRow([title]);
        rTitle.getCell(1).font = { bold: true, size: 12 };
        rTitle.getCell(1).alignment = { horizontal: "center" };
        sheet.mergeCells(rTitle.number, 1, rTitle.number, numCols);
        const rPeriod = sheet.addRow([`Period: ${startDate} to ${endDate}`]);
        rPeriod.getCell(1).font = { size: 10, color: { argb: "FF555555" } };
        sheet.mergeCells(rPeriod.number, 1, rPeriod.number, numCols);
        sheet.addRow([]);
      }

      const SUMMARY_COLS = 18;
      const summarySheet = workbook.addWorksheet("Payroll Summary");
      summarySheet.columns = [
        { key: "code", width: 15 },
        { key: "name", width: 25 },
        { key: "position", width: 18 },
        { key: "salaryType", width: 14 },
        { key: "totalDays", width: 13 },
        { key: "presentDays", width: 13 },
        { key: "absentDays", width: 13 },
        { key: "base", width: 14 },
        { key: "bale", width: 14 },
        { key: "kg", width: 14 },
        { key: "ot", width: 14 },
        { key: "bonus", width: 12 },
        { key: "deduct", width: 12 },
        { key: "advance", width: 12 },
        { key: "net", width: 14 },
        { key: "balesCount", width: 12 },
        { key: "kgProcessed", width: 14 },
        { key: "status", width: 12 },
      ];
      addSheetHeader(summarySheet, "Payroll Summary", SUMMARY_COLS, 6.5);
      const headerRow = summarySheet.addRow([
        "Employee Code",
        "Name",
        "Position",
        "Salary Type",
        "Working Days",
        "Present Days",
        "Absent Days",
        "Base Salary",
        "Bale Earnings",
        "KG Earnings",
        "Overtime Pay",
        "Bonuses",
        "Deductions",
        "Advances",
        "Net Salary",
        "Bales Count",
        "KG Processed",
        "Status",
      ]);
      headerRow.font = { bold: true };
      headerRow.alignment = { horizontal: "center" };
      headerRow.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      });

      for (const row of payrollData) {
        const p = row.payroll;
        const w = row.worker;
        summarySheet.addRow({
          code: w?.employeeCode || "-",
          name: w?.fullName || "-",
          position: w?.position || "-",
          salaryType: w?.salaryType || "-",
          totalDays: p.totalWorkingDays || 0,
          presentDays: parseFloat(p.presentDays || "0"),
          absentDays: parseFloat(p.absentDays || "0"),
          base: parseFloat(p.baseSalary || "0"),
          bale: parseFloat(p.baleEarnings || "0"),
          kg: parseFloat(p.kgEarnings || "0"),
          ot: parseFloat(p.overtimePay || "0"),
          bonus: parseFloat(p.bonuses || "0"),
          deduct: parseFloat(p.deductions || "0"),
          advance: parseFloat(p.advances || "0"),
          net: parseFloat(p.netSalary || "0"),
          balesCount: p.balesCount || 0,
          kgProcessed: parseFloat(p.kgProcessed || "0"),
          status: p.status,
        });
      }

      [
        "base",
        "bale",
        "kg",
        "ot",
        "bonus",
        "deduct",
        "advance",
        "net",
        "kgProcessed",
        "presentDays",
        "absentDays",
      ].forEach((key) => {
        const col = summarySheet.getColumn(key);
        col.numFmt = "#,##0.0";
      });

      const DETAILS_COLS = 12;
      const detailsSheet = workbook.addWorksheet("Worker Details");
      detailsSheet.columns = [
        { key: "code", width: 15 },
        { key: "name", width: 25 },
        { key: "position", width: 18 },
        { key: "department", width: 18 },
        { key: "salaryType", width: 14 },
        { key: "baseSalary", width: 14 },
        { key: "perBaleRate", width: 14 },
        { key: "perKgRate", width: 14 },
        { key: "overtimeRate", width: 14 },
        { key: "phone", width: 16 },
        { key: "dateJoined", width: 14 },
        { key: "paymentMethod", width: 16 },
      ];
      addSheetHeader(detailsSheet, "Worker Details", DETAILS_COLS, 3.5);
      const detailsHeaderRow = detailsSheet.addRow([
        "Employee Code",
        "Full Name",
        "Position",
        "Department",
        "Salary Type",
        "Base Salary",
        "Per Bale Rate",
        "Per KG Rate",
        "Overtime Rate",
        "Phone",
        "Date Joined",
        "Payment Method",
      ]);
      detailsHeaderRow.font = { bold: true };
      detailsHeaderRow.alignment = { horizontal: "center" };
      detailsHeaderRow.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      });

      const seenWorkers = new Set<number>();
      for (const row of payrollData) {
        const w = row.worker;
        if (!w || seenWorkers.has(w.id)) continue;
        seenWorkers.add(w.id);
        detailsSheet.addRow({
          code: w.employeeCode || "-",
          name: w.fullName || "-",
          position: w.position || "-",
          department: w.department || "-",
          salaryType: w.salaryType || "-",
          baseSalary: parseFloat(w.baseSalary || "0"),
          perBaleRate: parseFloat(w.perBaleRate || "0"),
          perKgRate: parseFloat(w.perKgRate || "0"),
          overtimeRate: parseFloat(w.overtimeRate || "0"),
          phone: w.phone1 || "-",
          dateJoined: w.dateJoined || "-",
          paymentMethod: w.paymentMethod || "-",
        });
      }

      ["baseSalary", "perBaleRate", "perKgRate", "overtimeRate"].forEach((key) => {
        const col = detailsSheet.getColumn(key);
        col.numFmt = "#,##0.00";
      });

      const xlsBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
      try {
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || req.session.userId!,
          companyId: parseInt(companyId),
          action: "export",
          tableName: "factory_payrolls",
          recordId: null,
          recordIdentifier: `Excel export — period ${startDate} to ${endDate}`,
          changes: null,
        });
      } catch (auditErr) {
        logger.error("[payroll export-excel audit] non-fatal:", { error: auditErr });
      }
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=payroll_${startDate}_${endDate}.xlsx`);
      res.setHeader("Content-Length", xlsBuffer.byteLength);
      res.end(xlsBuffer);
    } catch (error: unknown) {
      logger.error("Error exporting payroll Excel:", { error: error });
      if (!res.headersSent) res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
