import { getClientDate } from "../lib/dateUtils";
import type { Express } from "express";
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";
import { eq, and, sql, desc } from "drizzle-orm";
import {
  factorySuppliers,
  factoryContainers,
  factoryRawStock,
  factoryMixBatches,
  factoryMixBatchSources,
  factoryBales,
  factoryDaybookEntries,
  companies,
} from "@shared/schema";

export function registerFactoryReportRoutes(app: Express, requireAuth: any, db: any) {

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

  app.post("/api/factory/reports/supplier-usage", requireAuth, async (req: any, res: any) => {
    try {
      const { companyId, supplierId, startDate, endDate, format } = req.body;

      if (!companyId || !startDate || !endDate) {
        return res.status(400).json({ message: "companyId, startDate, and endDate are required" });
      }
      if (format !== "pdf" && format !== "excel") {
        return res.status(400).json({ message: "format must be 'pdf' or 'excel'" });
      }

      const [company] = await db
        .select()
        .from(companies)
        .where(eq(companies.id, companyId));

      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      const containerConditions: any[] = [eq(factoryContainers.companyId, companyId)];
      if (supplierId) {
        containerConditions.push(eq(factoryContainers.supplierId, supplierId));
      }

      const allContainers = await db
        .select()
        .from(factoryContainers)
        .where(and(...containerConditions));

      const containerIds = allContainers.map((c: any) => c.id);

      if (containerIds.length === 0) {
        if (format === "pdf") {
          return generateEmptyPdf(res, company.name, startDate, endDate);
        } else {
          return generateEmptyExcel(res, company.name, startDate, endDate);
        }
      }

      const allRawStock = await db
        .select({
          id: factoryRawStock.id,
          companyId: factoryRawStock.companyId,
          containerId: factoryRawStock.containerId,
          receivedKg: factoryRawStock.receivedKg,
          usedKg: factoryRawStock.usedKg,
          costPerKg: factoryRawStock.costPerKg,
          costPerKgUsd: factoryRawStock.costPerKgUsd,
          offloadedAt: factoryRawStock.offloadedAt,
          createdAt: factoryRawStock.createdAt,
        })
        .from(factoryRawStock)
        .where(eq(factoryRawStock.companyId, companyId));

      const relevantRawStock = allRawStock.filter((rs: any) =>
        containerIds.includes(rs.containerId)
      );

      const allMixSources = await db
        .select({
          id: factoryMixBatchSources.id,
          mixBatchId: factoryMixBatchSources.mixBatchId,
          containerId: factoryMixBatchSources.containerId,
          weightKg: factoryMixBatchSources.weightKg,
          costPerKg: factoryMixBatchSources.costPerKg,
          totalCost: factoryMixBatchSources.totalCost,
          createdAt: factoryMixBatchSources.createdAt,
        })
        .from(factoryMixBatchSources)
        .where(sql`${factoryMixBatchSources.containerId} IN (${sql.raw(containerIds.join(","))})`);

      const allMixBatches = await db
        .select()
        .from(factoryMixBatches)
        .where(eq(factoryMixBatches.companyId, companyId));

      const mixBatchMap = new Map<number, any>();
      for (const mb of allMixBatches) {
        mixBatchMap.set(mb.id, mb);
      }

      const allBales = await db
        .select()
        .from(factoryBales)
        .where(eq(factoryBales.companyId, companyId))
        .orderBy(desc(factoryBales.createdAt));

      const suppliers = await db
        .select()
        .from(factorySuppliers)
        .where(eq(factorySuppliers.companyId, companyId));

      const supplierMap = new Map<number, any>();
      for (const s of suppliers) {
        supplierMap.set(s.id, s);
      }

      const containerMap = new Map<number, any>();
      for (const c of allContainers) {
        containerMap.set(c.id, c);
      }

      const mixBatchIdsByContainer = new Map<number, Set<number>>();
      for (const src of allMixSources) {
        if (src.containerId) {
          if (!mixBatchIdsByContainer.has(src.containerId)) {
            mixBatchIdsByContainer.set(src.containerId, new Set());
          }
          mixBatchIdsByContainer.get(src.containerId)!.add(src.mixBatchId);
        }
      }

      const supplierSummaries: any[] = [];
      const supplierGroups = new Map<number, any[]>();

      for (const container of allContainers) {
        const sid = container.supplierId || 0;
        if (!supplierGroups.has(sid)) {
          supplierGroups.set(sid, []);
        }
        supplierGroups.get(sid)!.push(container);
      }

      for (const [sid, sContainers] of Array.from(supplierGroups.entries())) {
        const supplier = supplierMap.get(sid);
        const supplierName = supplier ? supplier.name : `Unknown (ID: ${sid})`;
        const sContainerIds = sContainers.map((c: any) => c.id);

        const sRawStock = relevantRawStock.filter((rs: any) =>
          sContainerIds.includes(rs.containerId)
        );

        let openingReceivedKg = 0;
        let openingUsedKg = 0;
        let periodPurchasedKg = 0;
        let totalCostPerKg = 0;
        let costCount = 0;

        for (const rs of sRawStock) {
          const rsDate = rs.offloadedAt ? new Date(rs.offloadedAt).toISOString().split("T")[0] : 
                         rs.createdAt ? new Date(rs.createdAt).toISOString().split("T")[0] : startDate;

          const receivedKg = parseFloat(rs.receivedKg || "0");
          const usedKg = parseFloat(rs.usedKg || "0");
          const cpk = parseFloat(rs.costPerKgUsd) || parseFloat(rs.costPerKg) || 0;

          if (rsDate < startDate) {
            openingReceivedKg += receivedKg;
            openingUsedKg += usedKg;
          } else if (rsDate >= startDate && rsDate <= endDate) {
            periodPurchasedKg += receivedKg;
          }

          if (cpk > 0) {
            totalCostPerKg += cpk;
            costCount++;
          }
        }

        const sMixSources = allMixSources.filter((ms: any) =>
          sContainerIds.includes(ms.containerId)
        );

        let periodUsedKg = 0;
        for (const ms of sMixSources) {
          const mb = mixBatchMap.get(ms.mixBatchId);
          if (mb) {
            const mbDate = mb.createdAt ? new Date(mb.createdAt).toISOString().split("T")[0] : "";
            if (mbDate >= startDate && mbDate <= endDate) {
              periodUsedKg += parseFloat(ms.weightKg || "0");
            }
          }
        }

        const sMixBatchIds = new Set<number>();
        for (const cid of sContainerIds) {
          const mbIds = mixBatchIdsByContainer.get(cid);
          if (mbIds) {
            mbIds.forEach((id: number) => sMixBatchIds.add(id));
          }
        }

        const sBales = allBales.filter((b: any) =>
          b.mixBatchId && sMixBatchIds.has(b.mixBatchId)
        );

        const periodBales = sBales.filter((b: any) => {
          const bDate = b.finalizedAt ? new Date(b.finalizedAt).toISOString().split("T")[0] :
                        b.createdAt ? new Date(b.createdAt).toISOString().split("T")[0] : "";
          return bDate >= startDate && bDate <= endDate;
        });

        const totalBales = periodBales.length;
        const openingBalance = openingReceivedKg - openingUsedKg;
        const remaining = openingBalance + periodPurchasedKg - periodUsedKg;
        const avgCostPerKg = costCount > 0 ? totalCostPerKg / costCount : 0;
        const totalCost = periodPurchasedKg * avgCostPerKg;
        const costPerBale = totalBales > 0 ? totalCost / totalBales : 0;

        supplierSummaries.push({
          supplierId: sid,
          supplierName,
          openingBalance,
          totalPurchasedKg: periodPurchasedKg,
          totalUsedKg: periodUsedKg,
          remaining,
          avgCostPerKg,
          costPerBale,
          totalBales,
          totalCost,
          bales: periodBales,
        });
      }

      const baleBreakdown: any[] = [];
      for (const summary of supplierSummaries) {
        for (const bale of summary.bales) {
          const mixSources = allMixSources.filter((ms: any) => ms.mixBatchId === bale.mixBatchId);
          const materials = mixSources.map((ms: any) => {
            const container = containerMap.get(ms.containerId);
            return {
              containerId: ms.containerId,
              containerNumber: container ? container.containerNumber : `C-${ms.containerId}`,
              weightKg: parseFloat(ms.weightKg || "0"),
              costPerKg: parseFloat(ms.costPerKg || "0"),
              totalCost: parseFloat(ms.totalCost || "0"),
            };
          });

          baleBreakdown.push({
            baleId: bale.id,
            baleCode: bale.baleCode,
            referenceNumber: bale.referenceNumber,
            productName: bale.productName || bale.baleCode,
            supplierName: summary.supplierName,
            weightKg: parseFloat(bale.weightKg || "0"),
            costPerKg: parseFloat(bale.costPerKg || "0"),
            totalCost: parseFloat(bale.totalCost || "0"),
            date: bale.finalizedAt ? new Date(bale.finalizedAt).toISOString().split("T")[0] :
                  bale.createdAt ? new Date(bale.createdAt).toISOString().split("T")[0] : "",
            materials,
          });
        }
      }

      if (format === "pdf") {
        await generatePdf(res, company.name, startDate, endDate, supplierSummaries, baleBreakdown);
      } else {
        await generateExcel(res, company.name, startDate, endDate, supplierSummaries, baleBreakdown, allMixSources, containerMap, supplierMap);
      }

      const today = getClientDate(req);
      await writeDaybookEntry(db, {
        companyId,
        txDate: today,
        txType: "REPORT_GENERATED",
        description: `Supplier Usage Report (${format.toUpperCase()}) – ${startDate} to ${endDate}${supplierId ? ` – ${supplierMap.get(supplierId)?.name || `Supplier #${supplierId}`}` : " – All Suppliers"}`,
        metaJson: JSON.stringify({ format, startDate, endDate, supplierId: supplierId || null }),
      });

    } catch (error: any) {
      console.error("Error generating supplier usage report:", error);
      res.status(500).json({ message: error.message });
    }
  });

  const hmdLogo = path.join(process.cwd(), "server", "hmd-logo.png");
  function addPdfBranding(doc: any) {
    if (fs.existsSync(hmdLogo)) {
      try { doc.image(hmdLogo, (doc.page.width - 220) / 2, doc.y, { width: 220 }); doc.moveDown(0.4); } catch {}
    }
    doc.font("Helvetica");
  }

  function generateEmptyPdf(res: any, companyName: string, startDate: string, endDate: string) {
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="supplier_usage_report_${startDate}_${endDate}.pdf"`);
    doc.pipe(res);

    addPdfBranding(doc);
    doc.moveDown(0.5);
    doc.fontSize(14).text("Supplier Usage Report", { align: "center" });
    doc.moveDown(0.3);
    doc.fontSize(10).text(`Period: ${startDate} to ${endDate}`, { align: "center" });
    doc.moveDown(2);
    doc.fontSize(12).text("No data found for the selected period and filters.", { align: "center" });

    doc.end();
  }

  async function generateEmptyExcel(res: any, companyName: string, startDate: string, endDate: string) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Summary");
    let xlLogoId: number | null = null;
    try { if (fs.existsSync(hmdLogo)) { xlLogoId = workbook.addImage({ buffer: fs.readFileSync(hmdLogo) as Buffer, extension: "jpeg" }); } } catch {}
    const lr = sheet.addRow([]); lr.height = 90;
    if (xlLogoId !== null) sheet.addImage(xlLogoId, { tl: { col: 1.5, row: 0 }, ext: { width: 300, height: 90 } });
    const rn = sheet.addRow(["HMD INTERNATIONAL GROUP"]); rn.getCell(1).font = { bold: true, size: 16, color: { argb: "FF1F3864" } }; rn.getCell(1).alignment = { horizontal: "center" };
    const rnTitle = sheet.addRow(["Supplier Usage Report"]); rnTitle.getCell(1).font = { bold: true, size: 13 }; rnTitle.getCell(1).alignment = { horizontal: "center" };
    sheet.addRow([`Period: ${startDate} to ${endDate}`]);
    sheet.addRow([]);
    sheet.addRow(["No data found for the selected period and filters."]);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="supplier_usage_report_${startDate}_${endDate}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  }

  async function generatePdf(
    res: any,
    companyName: string,
    startDate: string,
    endDate: string,
    supplierSummaries: any[],
    baleBreakdown: any[]
  ) {
    const doc = new PDFDocument({ margin: 40, size: "A4", layout: "landscape" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="supplier_usage_report_${startDate}_${endDate}.pdf"`);
    doc.pipe(res);

    addPdfBranding(doc);
    doc.moveDown(0.3);
    doc.fontSize(14).text("Supplier Usage Report", { align: "center" });
    doc.moveDown(0.2);
    doc.fontSize(9).text(`Period: ${startDate} to ${endDate}`, { align: "center" });
    doc.fontSize(8).text(`Generated: ${new Date().toISOString().replace("T", " ").substring(0, 19)}`, { align: "center" });
    doc.moveDown(1);

    doc.fontSize(12).text("Supplier Summary", { underline: true });
    doc.moveDown(0.5);

    const summaryHeaders = ["Supplier", "Opening (KG)", "Purchased (KG)", "Used (KG)", "Remaining (KG)", "Cost/KG", "Cost/Bale", "Total Bales"];
    const colWidths = [140, 85, 90, 80, 90, 70, 70, 70];
    let startX = 40;
    let y = doc.y;

    doc.fontSize(8);
    doc.font("Helvetica-Bold");
    let x = startX;
    for (let i = 0; i < summaryHeaders.length; i++) {
      doc.text(summaryHeaders[i], x, y, { width: colWidths[i] });
      x += colWidths[i];
    }
    y += 15;

    doc.font("Helvetica");
    doc.fontSize(7);

    for (const s of supplierSummaries) {
      if (y > 520) {
        doc.addPage();
        y = 40;
      }
      x = startX;
      const row = [
        s.supplierName,
        s.openingBalance.toFixed(3),
        s.totalPurchasedKg.toFixed(3),
        s.totalUsedKg.toFixed(3),
        s.remaining.toFixed(3),
        `$${s.avgCostPerKg.toFixed(4)}`,
        `$${s.costPerBale.toFixed(2)}`,
        String(s.totalBales),
      ];
      for (let i = 0; i < row.length; i++) {
        doc.text(row[i], x, y, { width: colWidths[i] });
        x += colWidths[i];
      }
      y += 13;
    }

    if (baleBreakdown.length > 0) {
      doc.addPage();
      y = 40;

      doc.fontSize(12).font("Helvetica-Bold").text("Mixing Breakdown per Bale", startX, y, { underline: true });
      y += 25;

      const baleHeaders = ["Bale ID", "Bale Code", "Materials", "KG Each", "Total Weight", "Date"];
      const baleColWidths = [60, 80, 220, 130, 90, 100];

      doc.fontSize(8).font("Helvetica-Bold");
      x = startX;
      for (let i = 0; i < baleHeaders.length; i++) {
        doc.text(baleHeaders[i], x, y, { width: baleColWidths[i] });
        x += baleColWidths[i];
      }
      y += 15;

      doc.font("Helvetica").fontSize(7);

      for (const bale of baleBreakdown) {
        if (y > 520) {
          doc.addPage();
          y = 40;
        }

        const materialsStr = bale.materials.map((m: any) => m.containerNumber).join(", ") || "N/A";
        const kgEachStr = bale.materials.map((m: any) => m.weightKg.toFixed(3)).join(", ") || "N/A";

        x = startX;
        const baleRow = [
          String(bale.baleId),
          bale.baleCode,
          materialsStr,
          kgEachStr,
          bale.weightKg.toFixed(3),
          bale.date,
        ];
        for (let i = 0; i < baleRow.length; i++) {
          doc.text(baleRow[i], x, y, { width: baleColWidths[i] });
          x += baleColWidths[i];
        }
        y += 13;
      }
    }

    doc.end();
  }

  async function generateExcel(
    res: any,
    companyName: string,
    startDate: string,
    endDate: string,
    supplierSummaries: any[],
    baleBreakdown: any[],
    allMixSources: any[],
    containerMap: Map<number, any>,
    supplierMap: Map<number, any>
  ) {
    const workbook = new ExcelJS.Workbook();
    const boldFont = { bold: true };
    const numberFmt = "#,##0.000";
    const moneyFmt = "$#,##0.00";

    let xlLogoId2: number | null = null;
    try { if (fs.existsSync(hmdLogo)) { xlLogoId2 = workbook.addImage({ buffer: fs.readFileSync(hmdLogo) as Buffer, extension: "jpeg" }); } } catch {}
    const sheet1 = workbook.addWorksheet("Summary");
    const lr1 = sheet1.addRow([]); lr1.height = 90;
    if (xlLogoId2 !== null) sheet1.addImage(xlLogoId2, { tl: { col: 1.5, row: 0 }, ext: { width: 300, height: 90 } });
    const rn1 = sheet1.addRow(["HMD INTERNATIONAL GROUP"]); rn1.getCell(1).font = { bold: true, size: 16, color: { argb: "FF1F3864" } }; rn1.getCell(1).alignment = { horizontal: "center" };
    const rn1Title = sheet1.addRow(["Supplier Usage Report"]); rn1Title.getCell(1).font = boldFont; rn1Title.getCell(1).alignment = { horizontal: "center" };
    sheet1.addRow([`Period: ${startDate} to ${endDate}`]);
    sheet1.addRow([`Generated: ${new Date().toISOString().replace("T", " ").substring(0, 19)}`]);
    sheet1.addRow([]);

    const summaryHeaderRow = sheet1.addRow([
      "Supplier", "Opening Balance (KG)", "Total Purchased (KG)", "Total Used (KG)",
      "Remaining (KG)", "Avg Cost/KG (USD)", "Cost/Bale (USD)", "Total Bales", "Total Cost (USD)"
    ]);
    summaryHeaderRow.font = boldFont;

    for (const s of supplierSummaries) {
      const row = sheet1.addRow([
        s.supplierName, s.openingBalance, s.totalPurchasedKg, s.totalUsedKg,
        s.remaining, s.avgCostPerKg, s.costPerBale, s.totalBales, s.totalCost,
      ]);
      row.getCell(2).numFmt = numberFmt;
      row.getCell(3).numFmt = numberFmt;
      row.getCell(4).numFmt = numberFmt;
      row.getCell(5).numFmt = numberFmt;
      row.getCell(6).numFmt = moneyFmt;
      row.getCell(7).numFmt = moneyFmt;
      row.getCell(9).numFmt = moneyFmt;
    }

    sheet1.columns.forEach((col) => {
      let maxLen = 12;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const len = String(cell.value || "").length;
        if (len > maxLen) maxLen = len;
      });
      col.width = Math.min(maxLen + 4, 40);
    });

    const sheet2 = workbook.addWorksheet("Bale Breakdown");
    const baleHeaderRow = sheet2.addRow([
      "Bale ID", "Reference Number", "Bale Code", "Product", "Supplier",
      "Weight (KG)", "Cost/KG (USD)", "Total Cost (USD)", "Date"
    ]);
    baleHeaderRow.font = boldFont;

    for (const bale of baleBreakdown) {
      const row = sheet2.addRow([
        bale.baleId, bale.referenceNumber, bale.baleCode, bale.productName,
        bale.supplierName, bale.weightKg, bale.costPerKg, bale.totalCost, bale.date,
      ]);
      row.getCell(6).numFmt = numberFmt;
      row.getCell(7).numFmt = moneyFmt;
      row.getCell(8).numFmt = moneyFmt;
    }

    sheet2.columns.forEach((col) => {
      let maxLen = 12;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const len = String(cell.value || "").length;
        if (len > maxLen) maxLen = len;
      });
      col.width = Math.min(maxLen + 4, 40);
    });

    const sheet3 = workbook.addWorksheet("Mixing Details");
    const mixHeaderRow = sheet3.addRow([
      "Mix Batch ID", "Container ID", "Container Number", "Supplier",
      "Weight (KG)", "Cost/KG (USD)", "Total Cost (USD)"
    ]);
    mixHeaderRow.font = boldFont;

    for (const ms of allMixSources) {
      const container = containerMap.get(ms.containerId);
      const supplier = container ? supplierMap.get(container.supplierId) : null;
      const row = sheet3.addRow([
        ms.mixBatchId,
        ms.containerId,
        container ? container.containerNumber : `C-${ms.containerId}`,
        supplier ? supplier.name : "Unknown",
        parseFloat(ms.weightKg || "0"),
        parseFloat(ms.costPerKg || "0"),
        parseFloat(ms.totalCost || "0"),
      ]);
      row.getCell(5).numFmt = numberFmt;
      row.getCell(6).numFmt = moneyFmt;
      row.getCell(7).numFmt = moneyFmt;
    }

    sheet3.columns.forEach((col) => {
      let maxLen = 12;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const len = String(cell.value || "").length;
        if (len > maxLen) maxLen = len;
      });
      col.width = Math.min(maxLen + 4, 40);
    });

    const sheet4 = workbook.addWorksheet("Balance Calculation");
    const balHeaderRow = sheet4.addRow([
      "Supplier", "Opening Balance (KG)", "Purchased (KG)", "Used (KG)", "Remaining (KG)"
    ]);
    balHeaderRow.font = boldFont;

    for (const s of supplierSummaries) {
      const row = sheet4.addRow([
        s.supplierName, s.openingBalance, s.totalPurchasedKg, s.totalUsedKg, s.remaining,
      ]);
      row.getCell(2).numFmt = numberFmt;
      row.getCell(3).numFmt = numberFmt;
      row.getCell(4).numFmt = numberFmt;
      row.getCell(5).numFmt = numberFmt;
    }

    sheet4.columns.forEach((col) => {
      let maxLen = 12;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const len = String(cell.value || "").length;
        if (len > maxLen) maxLen = len;
      });
      col.width = Math.min(maxLen + 4, 40);
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="supplier_usage_report_${startDate}_${endDate}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  }
}
