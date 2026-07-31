/**
 * payrollCoreRoutes: PayrollPaymentSummaryPdf endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import { eq, and, inArray } from "drizzle-orm";
import path from "path";
import fs from "fs";
import { factoryWorkers, factoryPayrolls, companies } from "@shared/schema";
import { getFactoryCompanyId } from "./_helpers";

export function registerPayrollPaymentSummaryPdfRoutes(app: Express) {
  // POST /api/factory/payrolls/payment-summary-pdf - Compact payment summary PDF
  app.post("/api/factory/payrolls/payment-summary-pdf", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { payrollIds } = req.body;
      if (!payrollIds?.length) return res.status(400).json({ message: "payrollIds required" });

      const payrollRows = await db
        .select()
        .from(factoryPayrolls)
        .where(and(eq(factoryPayrolls.companyId, companyId), inArray(factoryPayrolls.id, payrollIds)));
      if (!payrollRows.length) return res.status(404).json({ message: "No payroll records found" });

      const workerIdList = [...new Set(payrollRows.map((p: any) => p.workerId))];
      const workerRows = await db
        .select({ id: factoryWorkers.id, fullName: factoryWorkers.fullName })
        .from(factoryWorkers)
        .where(inArray(factoryWorkers.id, workerIdList));
      const workerMap = new Map(workerRows.map((w: any) => [w.id, w.fullName]));

      const [companyRow] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, companyId));
      const companyName = companyRow?.name || "Company";

      const PDFDocument = (await import("pdfkit")).default;
      const pathMod = await import("path");

      // Arabic / Unicode font setup
      const psumFontDir = pathMod.join(process.cwd(), "server", "fonts");
      const psumArabicFontPath = pathMod.join(psumFontDir, "Amiri-Regular.ttf");
      const psumHasArabicFont = fs.existsSync(psumArabicFontPath);

      const doc = new PDFDocument({ margin: 40, size: "A4" });
      if (psumHasArabicFont) doc.registerFont("Arabic", psumArabicFontPath);

      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => {
        const pdf = Buffer.concat(chunks);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="payment-summary.pdf"`);
        res.send(pdf);
      });

      // Arabic reshaping helpers
      let psumConvertArabic: ((t: string) => string) | null = null;
      let psumBidi: {
        getEmbeddingLevels: (t: string, d: string) => any;
        getReorderedString: (t: string, l: any) => string;
      } | null = null;
      try {
        psumConvertArabic = (require("arabic-reshaper") as any).convertArabic;
        psumBidi = (require("bidi-js") as any)();
      } catch {}

      const psumContainsArabic = (text: string) => /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
      const psumShapeText = (text: string): string => {
        if (!text || !psumConvertArabic) return text;
        try {
          const reshaped = psumConvertArabic(text);
          if (psumBidi) {
            const levels = psumBidi.getEmbeddingLevels(reshaped, "rtl");
            return psumBidi.getReorderedString(reshaped, levels);
          }
          return reshaped;
        } catch {
          return text;
        }
      };

      // Render text with automatic Arabic/Unicode font switching
      const psumRenderText = (
        text: string,
        x: number,
        yPos: number,
        w: number,
        align: "left" | "right" | "center",
        size = 8
      ) => {
        const hasAr = psumHasArabicFont && psumContainsArabic(text);
        doc
          .font(hasAr ? "Arabic" : "Helvetica")
          .fontSize(size)
          .text(hasAr ? psumShapeText(text) : text, x, yPos, { width: w, align: hasAr ? "right" : align });
      };

      // Header logo
      const hmdLogoPathPay = path.join(process.cwd(), "server", "hmd-logo.png");
      if (fs.existsSync(hmdLogoPathPay)) {
        try {
          doc.image(hmdLogoPathPay, (doc.page.width - 220) / 2, doc.y, { width: 220 });
          doc.moveDown(0.5);
        } catch {}
      }
      doc.fontSize(10).font("Helvetica").text("Payment Summary", { align: "center" });
      doc.moveDown(0.3);
      doc.fontSize(8).fillColor("#666666").text(`Generated: ${new Date().toLocaleDateString()}`, { align: "center" });
      doc.moveDown(0.8);

      // Period range
      const periods = [...new Set(payrollRows.map((p: any) => `${p.periodStart} – ${p.periodEnd}`))];
      doc
        .fontSize(8)
        .fillColor("#333333")
        .text(`Period: ${periods.join(", ")}`);
      doc.moveDown(0.5);

      // Table layout — 5 columns: Name | Present | Absent | Amount | Signature
      // Total table: x=40 to x=555 = 515px wide
      const COL = { name: 40, present: 265, absent: 313, amount: 368, signature: 445 };
      const COL_W = { name: 215, present: 40, absent: 40, amount: 70, signature: 110 };
      const rowH = 20;
      const tableTop = doc.y;

      // Table header row
      doc.rect(40, tableTop, 515, rowH).fill("#1F3864");
      doc.fillColor("#ffffff").fontSize(8).font("Helvetica-Bold");
      doc.text("Worker Name", COL.name, tableTop + 6, { width: COL_W.name });
      doc.text("Present", COL.present, tableTop + 6, { width: COL_W.present, align: "center" });
      doc.text("Absent", COL.absent, tableTop + 6, { width: COL_W.absent, align: "center" });
      doc.text("Amount", COL.amount, tableTop + 6, { width: COL_W.amount, align: "right" });
      doc.text("Signature", COL.signature, tableTop + 6, { width: COL_W.signature, align: "center" });

      let y = tableTop + rowH;
      let totalAmt = 0;

      payrollRows.forEach((p: any, i: number) => {
        const name = (workerMap.get(p.workerId) as string) || `Worker #${p.workerId}`;
        const present = p.presentDays != null ? Number(p.presentDays) : "—";
        const absent = p.absentDays != null ? Number(p.absentDays) : "—";
        const net = parseFloat(p.netSalary || "0");
        totalAmt += net;

        if (i % 2 === 1) doc.rect(40, y, 515, rowH).fill("#f5f7fa");
        doc.fillColor("#000000");

        // Worker name — supports Arabic/Unicode
        psumRenderText(name, COL.name, y + 6, COL_W.name, "left");

        doc.font("Helvetica").fontSize(8);
        doc.text(
          typeof present === "number" ? (present % 1 === 0 ? present.toFixed(0) : present.toFixed(1)) : "—",
          COL.present,
          y + 6,
          { width: COL_W.present, align: "center" }
        );
        doc.text(
          typeof absent === "number" ? (absent % 1 === 0 ? absent.toFixed(0) : absent.toFixed(1)) : "—",
          COL.absent,
          y + 6,
          { width: COL_W.absent, align: "center" }
        );
        doc.text(net.toFixed(2), COL.amount, y + 6, { width: COL_W.amount, align: "right" });

        // Signature box — a horizontal line for the worker to sign
        const sigLineY = y + rowH - 5;
        doc
          .moveTo(COL.signature + 8, sigLineY)
          .lineTo(COL.signature + COL_W.signature - 8, sigLineY)
          .strokeColor("#aaaaaa")
          .lineWidth(0.5)
          .stroke();

        y += rowH;
      });

      // Footer total row
      doc.rect(40, y + 2, 515, rowH).fill("#1F3864");
      doc.fillColor("#ffffff").fontSize(9).font("Helvetica-Bold");
      doc.text("Total Amount Paid", COL.name, y + 7, { width: COL_W.name + COL_W.present + COL_W.absent + 8 });
      doc.text(totalAmt.toFixed(2), COL.amount, y + 7, { width: COL_W.amount, align: "right" });

      doc.end();
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // GET /api/factory/workers/:id/stats - Get worker productivity stats
}
