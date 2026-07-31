/**
 * supplierBrokerRoutes: SupplierBrokerStatement endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { parseId } from "../../../../lib/parseId";
import { getErrorMessage } from "../../../../lib/httpHandlers";
import { logger } from "../../../../lib/logger";
import { getClientDate } from "../../../../lib/dateUtils";
import { buildSafeFilename, contentDisposition } from "../../../../lib/contentDisposition";
import { requireAuth } from "../../../../auth";
import {} from "@shared/schema";
import { buildBrokerStatement } from "./_helpers";

export function registerSupplierBrokerStatementRoutes(app: Express) {
  app.get("/api/factory/suppliers/:id/broker-statement", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const brokerId = parseId(req.params.id);
      if (brokerId === null) return res.status(400).json({ message: "Invalid id" });
      const includeOtw = req.query.includeOtw === "true";
      const data = await buildBrokerStatement(brokerId, companyId, includeOtw);
      if (!data) return res.status(404).json({ message: "Supplier not found" });
      return res.json(data);
    } catch (err: unknown) {
      logger.error("Broker statement error:", { error: err });
      return res.status(500).json({ message: getErrorMessage(err) });
    }
  });

  app.get("/api/factory/suppliers/:id/broker-statement/export", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const brokerId = parseId(req.params.id);
      if (brokerId === null) return res.status(400).json({ message: "Invalid id" });
      const includeOtw = req.query.includeOtw === "true";
      const data = await buildBrokerStatement(brokerId, companyId, includeOtw);
      if (!data) return res.status(404).json({ message: "Supplier not found" });

      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = "ERP System";
      wb.created = new Date();

      const typeLabel: Record<string, string> = {
        container: "Container",
        payment: "Payment",
        fx_out: "FX Out",
        fx_in: "FX In",
        commission: "Commission",
        other_charge: "Other Charge",
        freight: "Freight",
      };
      const rowTypeFill: Record<string, string> = {
        container: "FFFAFAFA",
        payment: "FFE8F5E9",
        fx_out: "FFFFF8E1",
        fx_in: "FFE3F2FD",
        commission: "FFFFF3E0",
        other_charge: "FFEDE7F6",
        freight: "FFFFF3E0",
      };

      for (const section of data.currencyLedgers) {
        const ws = wb.addWorksheet(section.currencyCode);
        ws.properties.defaultRowHeight = 15;

        // Title row
        const titleRow = ws.addRow([`Broker Statement — ${(data.supplier as any).name} — ${section.currencyCode}`]);
        titleRow.font = { bold: true, size: 13 };
        ws.mergeCells(`A${titleRow.number}:G${titleRow.number}`);
        ws.addRow([]);

        // Column headers
        const hdrRow = ws.addRow([
          "Date",
          "Type",
          "Description",
          "Amount",
          "Commission",
          "Comm. Currency",
          "Running Balance",
        ]);
        hdrRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
        hdrRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
        hdrRow.alignment = { horizontal: "left" };
        ["D", "E", "G"].forEach((col) => {
          const cell = hdrRow.getCell(col);
          cell.alignment = { horizontal: "right" };
        });

        ws.columns = [
          { key: "date", width: 14 },
          { key: "type", width: 14 },
          { key: "description", width: 40 },
          { key: "amount", width: 18 },
          { key: "commission", width: 16 },
          { key: "commCcy", width: 14 },
          { key: "runBal", width: 18 },
        ];

        for (const row of section.rows) {
          const dr = ws.addRow([
            row.date || "",
            typeLabel[row.type] || row.type,
            row.description,
            parseFloat((row.amount as any).toFixed(2)),
            row.commissionAmount != null ? parseFloat((row.commissionAmount as any).toFixed(2)) : "",
            row.commissionCurrency || "",
            parseFloat((row.runningBalance as any).toFixed(2)),
          ]);
          dr.getCell("D").numFmt = "#,##0.00";
          dr.getCell("E").numFmt = "#,##0.00";
          dr.getCell("G").numFmt = "#,##0.00";
          dr.getCell("D").alignment = { horizontal: "right" };
          dr.getCell("E").alignment = { horizontal: "right" };
          dr.getCell("G").alignment = { horizontal: "right" };
          const fillArgb = rowTypeFill[row.type] || "FFFFFFFF";
          dr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillArgb } };
        }

        // Spacer
        ws.addRow([]);

        // Totals
        const totalsLabel = ws.addRow(["SECTION TOTALS"]);
        totalsLabel.font = { bold: true };
        const totalsData = ws.addRow([
          "",
          "",
          `Containers: ${section.totalContainers}  |  Freight: ${section.totalFreight}  |  Paid: ${section.totalPaid}  |  FX Out: ${section.totalFxOut}`,
          parseFloat(section.totalValue),
          parseFloat(section.totalCommission),
          "",
          parseFloat(section.netBalance),
        ]);
        totalsData.font = { bold: true };
        totalsData.getCell("D").numFmt = "#,##0.00";
        totalsData.getCell("E").numFmt = "#,##0.00";
        totalsData.getCell("G").numFmt = "#,##0.00";
        ["D", "E", "G"].forEach((col) => {
          totalsData.getCell(col).alignment = { horizontal: "right" };
        });
        totalsData.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCFD8DC" } };
      }

      // Summary sheet
      const sumWs = wb.addWorksheet("Summary");
      sumWs.addRow([`Broker Consolidated Statement — ${(data.supplier as any).name}`]).font = { bold: true, size: 13 };
      sumWs.addRow([
        `Generated: ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`,
      ]).font = { italic: true };
      sumWs.addRow([]);
      const sumHdr = sumWs.addRow([
        "Currency",
        "Containers",
        "Gross Value",
        "Commission",
        "Freight",
        "FX Out",
        "FX In",
        "Paid",
        "Net Balance",
      ]);
      sumHdr.font = { bold: true, color: { argb: "FFFFFFFF" } };
      sumHdr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
      for (const section of data.currencyLedgers) {
        const dr = sumWs.addRow([
          section.currencyCode,
          section.totalContainers,
          parseFloat(section.totalValue),
          parseFloat(section.totalCommission),
          parseFloat(section.totalFreight || "0"),
          parseFloat(section.totalFxOut),
          parseFloat(section.totalFxIn),
          parseFloat(section.totalPaid),
          parseFloat(section.netBalance),
        ]);
        // Colour FX Out red, FX In green for clarity
        ["C", "D", "E", "F", "G", "H", "I"].forEach((col) => {
          dr.getCell(col).numFmt = "#,##0.00";
          dr.getCell(col).alignment = { horizontal: "right" };
        });
        const fxOutVal = parseFloat(section.totalFxOut);
        const fxInVal = parseFloat(section.totalFxIn);
        const freightVal = parseFloat(section.totalFreight || "0");
        if (fxOutVal > 0) {
          dr.getCell("F").font = { color: { argb: "FFCC0000" } };
        }
        if (fxInVal > 0) {
          dr.getCell("G").font = { color: { argb: "FF006600" } };
        }
        if (freightVal > 0) {
          dr.getCell("E").font = { color: { argb: "FFE65100" } };
        }
        // Bold the Net Balance
        dr.getCell("I").font = { bold: true };
      }
      sumWs.columns = [
        { width: 12 },
        { width: 14 },
        { width: 18 },
        { width: 16 },
        { width: 14 },
        { width: 14 },
        { width: 14 },
        { width: 16 },
        { width: 18 },
      ];

      const xlsBuffer = Buffer.from(await wb.xlsx.writeBuffer());
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader(
        "Content-Disposition",
        contentDisposition(
          buildSafeFilename(
            ["broker-statement", (data.supplier as any).name || String(brokerId), getClientDate(req)],
            "xlsx"
          )
        )
      );
      res.setHeader("Content-Length", xlsBuffer.byteLength);
      res.end(xlsBuffer);
    } catch (err: unknown) {
      logger.error("Broker statement export error:", { error: err });
      if (!res.headersSent) res.status(500).json({ message: getErrorMessage(err) });
    }
  });
}
