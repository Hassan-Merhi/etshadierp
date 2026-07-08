import express, { type Express } from "express";
import { getClientDate } from "../../lib/dateUtils";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import {
  locations,
  vouchers,
  voucherEntries,
  ledgerAccounts,
  posShifts,
  companies,
} from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { generateStockPdf } from "../../helpers/generateStockPdf";
import { generateInvoicePdf, generateInvoicePdfMeta } from "../../helpers/generateInvoicePdf";
import { getErpExportVisibility } from "../../helpers/exportVisibility";
import {
  sendWhatsAppFileToChatIdPos,
  sendWhatsAppFileByUploadPos,
} from "../../services/whatsappService";
import { tempPdfStore } from "./posHelpers";

export function registerPosPrintRoutes(app: Express): void {
  // ── Serve temporarily stored PDFs (used by WhatsApp sendFileByUrl) ──────────
  // Auth-gated: even though the ID is a random unguessable key, we require an
  // authenticated session to defend against accidental URL leakage in browser
  // history, referrer headers, or chat logs.
  app.get("/api/pos/temp-pdf/:id", requireAuth, (req, res) => {
    const entry = tempPdfStore.get(req.params.id);
    if (!entry || entry.expiresAt < Date.now()) {
      return res.status(404).json({ message: "File not found or expired" });
    }
    const ct = entry.contentType ?? "application/pdf";
    const fn = entry.filename ?? "stock_report.pdf";
    res.setHeader("Content-Type", ct);
    res.setHeader("Content-Disposition", `inline; filename="${fn}"`);
    res.send(entry.buffer);
  });

  // ── Receive a frontend-generated PDF and forward to WhatsApp ──────────────
  // Body: { pdfBase64: string, locationId: number, filename: string, caption?: string }
  // NOTE: PDFs sent as base64 in JSON can easily exceed the global 2 MB body
  // limit (a 1.5 MB PDF becomes ~2 MB base64), so we apply a route-specific
  // 25 MB limit here. WhatsApp itself caps attachments around 15 MB.
  app.post("/api/pos/send-whatsapp-pdf-upload", requireAuth, express.json({ limit: "25mb" }), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { pdfBase64, locationId, filename, caption } = req.body;
      if (!pdfBase64) return res.status(400).json({ message: "pdfBase64 is required" });
      if (!locationId) return res.status(400).json({ message: "locationId is required" });

      const [location] = await db
        .select()
        .from(locations)
        .where(and(eq(locations.id, parseInt(locationId)), eq(locations.companyId, companyId)))
        .limit(1);

      if (!location) return res.status(404).json({ message: "Location not found" });
      if (!location.whatsappGroupChatId)
        return res.status(400).json({ message: "No WhatsApp group configured for this location" });

      const pdfBuffer = Buffer.from(pdfBase64, "base64");
      const safeFile = (filename || "report.pdf").replace(/[^\w\s.()\-]/g, "_");

      console.log(`[WA PDF upload] chatId=${location.whatsappGroupChatId} file=${safeFile} size=${pdfBuffer.length}`);
      const result = await sendWhatsAppFileByUploadPos(
        location.whatsappGroupChatId,
        pdfBuffer,
        safeFile,
        caption ?? safeFile
      );

      if (!result.success) {
        return res.status(502).json({ message: result.error ?? "WhatsApp send failed" });
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("[/api/pos/send-whatsapp-pdf-upload]", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Server-side stock PDF → WhatsApp (no browser capture needed) ──────────
  app.post("/api/pos/send-stock-pdf-backend", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { locationId } = req.body;
      if (!locationId) return res.status(400).json({ message: "locationId is required" });

      const locId = parseInt(locationId);
      if (isNaN(locId)) return res.status(400).json({ message: "Invalid locationId" });

      const [location] = await db
        .select()
        .from(locations)
        .where(and(eq(locations.id, locId), eq(locations.companyId, companyId)))
        .limit(1);

      if (!location) return res.status(404).json({ message: "Location not found" });
      if (!location.whatsappGroupChatId)
        return res.status(400).json({ message: "No WhatsApp group configured for this location" });

      const [company] = await db
        .select({ name: companies.name })
        .from(companies)
        .where(eq(companies.id, companyId))
        .limit(1);

      const companyName = company?.name || "Company";
      const locName = location.name;

      const { buffer: pdfBuffer, pageCount, rowCount } = await generateStockPdf(companyId, companyName, locId, locName);

      // ── Safety guard: reject absurdly over-paginated PDFs before sending ──
      // Root cause was PDFKit ≥0.17 exposing page.maxY as a function instead of
      // a number, making the ensureSpace comparison always false. This guard
      // catches any future regression before a broken PDF reaches WhatsApp.
      const maxAllowedPages = Math.ceil(rowCount / 20) + 5;
      if (pageCount > maxAllowedPages) {
        console.error(
          `[WA stock backend] SAFETY GUARD: PDF has ${pageCount} pages for ${rowCount} rows ` +
            `(max allowed: ${maxAllowedPages}). location="${locName}". Refusing to send.`
        );
        return res.status(500).json({
          message:
            `PDF pagination error detected: ${pageCount} pages generated for ${rowCount} stock items ` +
            `(expected ≤${maxAllowedPages}). Report not sent to WhatsApp.`,
        });
      }

      const dateStr = getClientDate(req);
      const safeName = `${locName} STK ${companyName} ${dateStr}`.replace(/[^\w\s.()\-]/g, "_").trim();
      const stampStr = new Date().toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      const caption = `Stock Report — ${locName}\n${stampStr}`;

      console.log(
        `[WA stock backend] chatId=${location.whatsappGroupChatId} file=${safeName}.pdf ` +
          `size=${pdfBuffer.length} pageCount=${pageCount} rowCount=${rowCount}`
      );

      const result = await sendWhatsAppFileToChatIdPos(
        location.whatsappGroupChatId,
        pdfBuffer,
        `${safeName}.pdf`,
        caption
      );

      if (!result.success) {
        console.error(
          `[WA stock backend] Upload failed — chatId=${location.whatsappGroupChatId} ` +
            `file=${safeName}.pdf size=${pdfBuffer.length} pageCount=${pageCount} rowCount=${rowCount} ` +
            `greenApiError="${result.error}"`
        );
        return res.status(502).json({ message: result.error ?? "WhatsApp send failed" });
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("[/api/pos/send-stock-pdf-backend]", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Server-side invoice PDF → WhatsApp ────────────────────────────────────
  app.post("/api/pos/send-invoice-pdf-backend", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { voucherId, locationId, dryRun } = req.body;
      if (!voucherId) return res.status(400).json({ message: "voucherId is required" });
      if (!locationId) return res.status(400).json({ message: "locationId is required" });
      const parsedVoucherId = parseInt(voucherId);
      if (isNaN(parsedVoucherId)) return res.status(400).json({ message: "Invalid voucherId" });

      const locId = parseInt(locationId);
      if (isNaN(locId)) return res.status(400).json({ message: "Invalid locationId" });

      const [location] = await db
        .select()
        .from(locations)
        .where(and(eq(locations.id, locId), eq(locations.companyId, companyId)))
        .limit(1);

      if (!location) return res.status(404).json({ message: "Location not found" });

      // For non-dry-run, a WhatsApp group must be configured
      if (!dryRun && !location.whatsappGroupChatId)
        return res.status(400).json({ message: "No WhatsApp group configured for this location" });

      // POS users can only send invoices for vouchers from their own shifts
      if (req.user?.role === "POS") {
        const [voucherToCheck] = await db
          .select({ id: vouchers.id, shiftId: vouchers.shiftId })
          .from(vouchers)
          .where(and(eq(vouchers.id, parsedVoucherId), eq(vouchers.companyId, companyId)))
          .limit(1);
        if (!voucherToCheck) {
          return res.status(404).json({ message: "Voucher not found" });
        }
        if (voucherToCheck.shiftId) {
          const [shift] = await db
            .select({ userId: posShifts.userId })
            .from(posShifts)
            .where(eq(posShifts.id, voucherToCheck.shiftId))
            .limit(1);
          if (!shift || shift.userId !== req.user.id) {
            return res.status(403).json({ message: "Access denied" });
          }
        }
      }

      // Always generate in compact / WhatsApp mode for this endpoint (tighter
      // sizing only). P/L columns (CONFIG / P/L BALE / TOTAL P/L) auto-hide
      // inside the PDF generator when no item has a configured price — do NOT
      // force them hidden here, or a location with a selling price fix would
      // lose its P/L per bale + Total P/L on the WhatsApp invoice.
      const compactMode   = true;
      const whatsappMode  = true;
      const erpVis = await getErpExportVisibility(req);
      const hideProfitCols = erpVis.hideSelling || erpVis.hideCost;
      const { buffer: pdfBuffer, pageCount, itemCount } = await generateInvoicePdfMeta(
        parsedVoucherId,
        companyId,
        (req as any).user?.username,
        { hideProfitCols, compactMode, whatsappMode },
      );

      // ── PDF validation ─────────────────────────────────────────────────────
      const pdfSize = pdfBuffer?.length ?? 0;
      const validHeader = pdfBuffer && pdfBuffer.slice(0, 4).toString("ascii") === "%PDF";

      // Compact mode fits ~60 rows/page. Allow 1 page per 20 items plus a 4-page
      // fixed buffer to account for header/footer/totals.
      // e.g. 5 items → max 5 pages, 100 items → max 9 pages, 150 items → max 12 pages.
      // Any value above this means the compact layout broke — abort the WA send.
      const maxReasonablePages = Math.ceil(itemCount / 20) + 4;
      const pageCountOk = pageCount <= maxReasonablePages;

      console.log(
        `[WA invoice backend] voucherId=${voucherId} locationId=${locId} itemCount=${itemCount} ` +
        `pageCount=${pageCount} pdfSize=${pdfSize} compactMode=${compactMode} dryRun=${!!dryRun}`,
      );

      if (!pdfBuffer || pdfSize < 1000 || !validHeader) {
        console.error(`[WA invoice backend] PDF validation failed voucherId=${voucherId} size=${pdfSize} validHeader=${validHeader}`);
        return res.status(500).json({ message: "PDF generation failed: invalid or empty PDF" });
      }
      if (!pageCountOk) {
        console.error(`[WA invoice backend] PDF page count excessive voucherId=${voucherId} pages=${pageCount} items=${itemCount}`);
        return res.status(500).json({
          message: `PDF page count (${pageCount}) is excessive for ${itemCount} items — aborting WhatsApp send`,
        });
      }

      // ── Dry-run: return metadata, do NOT send to WhatsApp ─────────────────
      if (dryRun) {
        // Build filename for the dry-run response (same logic as real send)
        const locName  = location.name;
        const dateStr  = getClientDate(req);
        const rawName  = `${locName} Invoice ${dateStr}`;
        const safeName = rawName.replace(/[^\w\s.()\-]/g, "_").trim();
        return res.json({
          success:     true,
          dryRun:      true,
          pdfSize,
          pageCount,
          itemCount,
          filename:    `${safeName}.pdf`,
          compactMode,
          whatsappMode,
        });
      }

      // ── Build filename (real send) ─────────────────────────────────────────
      const locName = location.name;
      const dateStr = getClientDate(req);

      let customerNameForFile: string | null = null;
      const [voucherMeta] = await db
        .select({ isCreditSale: vouchers.isCreditSale })
        .from(vouchers)
        .where(eq(vouchers.id, parsedVoucherId))
        .limit(1);
      if (voucherMeta?.isCreditSale) {
        const [custEntry] = await db
          .select({ name: ledgerAccounts.name })
          .from(voucherEntries)
          .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, voucherEntries.ledgerAccountId))
          .where(
            and(eq(voucherEntries.voucherId, parsedVoucherId), sql`${voucherEntries.debitAmount}::numeric > 0`),
          )
          .limit(1);
        customerNameForFile = custEntry?.name || null;
      }

      const rawName  = customerNameForFile
        ? `${customerNameForFile} Invoice ${locName} ${dateStr}`
        : `${locName} Invoice ${dateStr}`;
      const safeName = rawName.replace(/[^\w\s.()\-]/g, "_").trim();
      const caption  = "";

      const result = await sendWhatsAppFileToChatIdPos(
        location.whatsappGroupChatId!,
        pdfBuffer,
        `${safeName}.pdf`,
        caption,
      );

      if (!result.success) return res.status(502).json({ message: result.error ?? "WhatsApp send failed" });

      res.json({ success: true });
    } catch (error: any) {
      console.error("[/api/pos/send-invoice-pdf-backend]", error);
      const msg: string = error?.message ?? "Internal server error";
      if (msg.toLowerCase().includes("voucher not found")) {
        return res.status(404).json({ message: "Voucher not found" });
      }
      res.status(500).json({ message: msg });
    }
  });

  // ── Direct invoice PDF download (ERP use — no location/WA required) ──────────
  app.get("/api/pos/invoice/:voucherId/pdf", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const voucherId = parseInt(req.params.voucherId);
      if (isNaN(voucherId)) return res.status(400).json({ message: "Invalid voucherId" });

      // Verify the voucher belongs to this company
      const [voucherRow] = await db
        .select({ id: vouchers.id, isCreditSale: vouchers.isCreditSale, voucherDate: vouchers.voucherDate })
        .from(vouchers)
        .where(and(eq(vouchers.id, voucherId), eq(vouchers.companyId, companyId)))
        .limit(1);
      if (!voucherRow) return res.status(404).json({ message: "Voucher not found" });

      const erpVis = await getErpExportVisibility(req);
      // P/L columns (CONFIG / P/L BALE / TOTAL P/L) auto-hide inside the PDF generator
      // when no item has a configured price.  Do NOT gate on hideSalesProfitCost here —
      // the only valid reason to suppress the columns is "no configured price set".
      const hideProfitCols = erpVis.hideSelling || erpVis.hideCost;
      const pdfBuffer = await generateInvoicePdf(voucherId, companyId, (req as any).user?.username, { hideProfitCols });

      // Build a friendly filename
      let customerName: string | null = null;
      if (voucherRow.isCreditSale) {
        const [custEntry] = await db
          .select({ name: ledgerAccounts.name })
          .from(voucherEntries)
          .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, voucherEntries.ledgerAccountId))
          .where(and(eq(voucherEntries.voucherId, voucherId), sql`${voucherEntries.debitAmount}::numeric > 0`))
          .limit(1);
        customerName = custEntry?.name || null;
      }
      const dateStr = voucherRow.voucherDate ? String(voucherRow.voucherDate).slice(0, 10) : getClientDate(req);
      const rawName = customerName ? `${customerName} Invoice ${dateStr}` : `Invoice ${dateStr}`;
      const safeName = rawName.replace(/[^\w\s.()\-]/g, "_").trim();

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${safeName}.pdf"`);
      res.setHeader("Content-Length", pdfBuffer.length);
      res.send(pdfBuffer);
    } catch (error: any) {
      console.error("[GET /api/pos/invoice/:voucherId/pdf]", error);
      res.status(500).json({ message: error.message });
    }
  });
}
