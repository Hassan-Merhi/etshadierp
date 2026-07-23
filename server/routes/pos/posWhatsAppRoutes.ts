import { type Express } from "express";
import { logger } from "../../lib/logger";
import { getClientDate } from "../../lib/dateUtils";
import { db } from "../../db";
import { storage } from "../../storage";
import { requireAuth } from "../../auth";
import {
  locations,
  posShifts,
  inventory,
  stockItems,
  stockGroups,
  vouchers,
  voucherEntries,
  ledgerAccounts,
  userCompanyRoles,
} from "@shared/schema";
import { eq, and, desc, asc, gte, sql } from "drizzle-orm";
import { format } from "date-fns";
import { generateStockPdf } from "../../helpers/generateStockPdf";
import { generateInvoicePdf } from "../../helpers/generateInvoicePdf";
import { getErpExportVisibility } from "../../helpers/exportVisibility";
import {
  sendWhatsAppTextToChatIdPos,
  sendWhatsAppFileToChatIdPos,
  sendWhatsAppFileByUploadPos,
} from "../../services/whatsappService";

export function registerPosWhatsAppRoutes(app: Express): void {
  // ── POS WhatsApp Shift Report ─────────────────────────────────────────────
  app.post("/api/pos/send-shift-report", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const userId = req.session.userId!;

      // Determine location — POS users have an assigned location; admin can pass locationId
      let locationId: number | null = null;
      if (req.body.locationId) {
        locationId = parseInt(req.body.locationId as string);
      } else {
        const ucr = await db
          .select({ assignedLocationId: userCompanyRoles.assignedLocationId })
          .from(userCompanyRoles)
          .where(and(eq(userCompanyRoles.userId, userId), eq(userCompanyRoles.companyId, companyId)))
          .limit(1);
        locationId = ucr[0]?.assignedLocationId ?? null;
      }

      if (!locationId) return res.status(400).json({ message: "No location found for this user" });

      // Fetch location record (includes whatsapp_group_chat_id)
      const [location] = await db
        .select()
        .from(locations)
        .where(and(eq(locations.id, locationId), eq(locations.companyId, companyId)))
        .limit(1);

      if (!location) return res.status(404).json({ message: "Location not found" });

      if (!location.whatsappGroupChatId) {
        return res.status(400).json({ message: "WhatsApp group not configured for this location" });
      }

      // Fetch current stock for this location
      const stockRows = await db
        .select({
          name: stockItems.name,
          unit: stockItems.uom,
          quantity: inventory.quantity,
          groupName: stockGroups.name,
        })
        .from(inventory)
        .innerJoin(stockItems, eq(inventory.stockItemId, stockItems.id))
        .leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id))
        .where(and(eq(inventory.locationId, locationId), eq(inventory.companyId, companyId)))
        .orderBy(asc(stockGroups.name), asc(stockItems.name));

      // Fetch today's open or most-recently-closed shift for context
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const shifts = await db
        .select()
        .from(posShifts)
        .where(
          and(eq(posShifts.locationId, locationId), eq(posShifts.companyId, companyId), gte(posShifts.openedAt, today))
        )
        .orderBy(desc(posShifts.openedAt))
        .limit(1);

      const shift = shifts[0] ?? null;
      const now = new Date();
      const dateStr = format(now, "dd MMM yyyy, h:mm a");

      // Build grouped stock lines
      let lastGroup = "";
      const stockLines: string[] = [];
      for (const row of stockRows) {
        const qty = parseFloat(row.quantity ?? "0");
        const group = row.groupName ?? "General";
        if (group !== lastGroup) {
          stockLines.push(`\n*${group}*`);
          lastGroup = group;
        }
        const flag = qty < 0 ? " ⚠️" : "";
        const unitLabel = row.unit ? ` ${row.unit}` : "";
        stockLines.push(`  • ${row.name}: ${qty.toLocaleString()}${unitLabel}${flag}`);
      }

      const stockSection = stockLines.length ? stockLines.join("\n") : "  No stock data available";

      const salesLine = shift
        ? `*Sales Today:* ${shift.salesCount ?? 0} transactions | ${parseFloat(shift.salesTotal ?? "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : "";

      const senderName = req.user?.username || userId;

      const message = [
        `📍 *${location.name} — Stock Report*`,
        `🕐 Sent by ${senderName} on ${dateStr}`,
        ``,
        `*Current Stock:*${stockSection}`,
        ``,
        salesLine,
      ]
        .filter((l) => l !== undefined)
        .join("\n")
        .trim();

      const result = await sendWhatsAppTextToChatIdPos(location.whatsappGroupChatId, message);
      if (!result.success) {
        return res.status(502).json({ message: result.error ?? "Failed to send WhatsApp message" });
      }

      res.json({ success: true, message: "Stock report sent to WhatsApp" });
    } catch (error: any) {
      logger.error("[/api/pos/send-shift-report]", {
        locationId: req.body.locationId,
        chatId: (error as any)?.chatId ?? undefined,
        error: error?.message ?? error,
      });
      res.status(500).json({ message: error.message });
    }
  });

  // ── POS Stock PDF → WhatsApp ──────────────────────────────────────────────
  app.post("/api/pos/send-stock-pdf", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const userId = req.session.userId!;

      let locationId: number | null = null;
      if (req.body.locationId) {
        locationId = parseInt(req.body.locationId as string);
      } else {
        const ucr = await db
          .select({ assignedLocationId: userCompanyRoles.assignedLocationId })
          .from(userCompanyRoles)
          .where(and(eq(userCompanyRoles.userId, userId), eq(userCompanyRoles.companyId, companyId)))
          .limit(1);
        locationId = ucr[0]?.assignedLocationId ?? null;
      }

      if (!locationId) return res.status(400).json({ message: "No location found for this user" });

      const [location] = await db
        .select()
        .from(locations)
        .where(and(eq(locations.id, locationId), eq(locations.companyId, companyId)))
        .limit(1);

      if (!location) return res.status(404).json({ message: "Location not found" });

      if (!location.whatsappGroupChatId) {
        return res.status(400).json({ message: "No WhatsApp group configured for this location" });
      }

      const { buffer: pdfBuffer } = await generateStockPdf(companyId, location.name, locationId, location.name);
      const now = new Date();
      const safeLocationName = location.name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
      const fileName = `Stock_${safeLocationName}_${format(now, "yyyyMMdd_HHmm")}.pdf`;
      const caption = "";

      logger.info(`[WA stock upload] chatId=${location.whatsappGroupChatId} file=${fileName} size=${pdfBuffer.length}`);
      const result = await sendWhatsAppFileByUploadPos(location.whatsappGroupChatId, pdfBuffer, fileName, caption);

      if (!result.success) {
        logger.error("[/api/pos/send-stock-pdf]", {
          locationId,
          chatId: location.whatsappGroupChatId,
          error: result.error,
        });
        return res.status(502).json({ message: result.error ?? "Failed to send WhatsApp PDF" });
      }

      res.json({ success: true });
    } catch (error: any) {
      logger.error("[/api/pos/send-stock-pdf]", {
        locationId: req.body.locationId,
        error: error?.message ?? error,
      });
      res.status(500).json({ message: error.message });
    }
  });

  // ── POS Send Invoice to WhatsApp ──────────────────────────────────────────
  app.post("/api/pos/send-invoice-whatsapp", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { voucherId } = req.body;
      if (!voucherId) return res.status(400).json({ message: "voucherId is required" });

      // Fetch the voucher
      const [voucher] = await db
        .select()
        .from(vouchers)
        .where(and(eq(vouchers.id, parseInt(voucherId)), eq(vouchers.companyId, companyId)))
        .limit(1);

      if (!voucher) return res.status(404).json({ message: "Voucher not found" });

      // POS users can only send invoices for vouchers from their own shifts
      if (req.user?.role === "POS" && voucher.shiftId) {
        const [shift] = await db
          .select({ userId: posShifts.userId })
          .from(posShifts)
          .where(eq(posShifts.id, voucher.shiftId))
          .limit(1);
        if (!shift || shift.userId !== req.user.id) {
          return res.status(403).json({ message: "Access denied" });
        }
      }

      // Fetch the location for this voucher
      const locationId = voucher.locationId;
      if (!locationId) return res.status(400).json({ message: "Voucher has no location" });

      const [location] = await db
        .select()
        .from(locations)
        .where(and(eq(locations.id, locationId), eq(locations.companyId, companyId)))
        .limit(1);

      if (!location) return res.status(404).json({ message: "Location not found" });
      if (!location.whatsappGroupChatId) {
        return res.status(400).json({ message: "WhatsApp group not configured for this location" });
      }

      const senderName = req.user?.username || "POS";
      const waVis = await getErpExportVisibility(req);
      // P/L columns (CONFIG / P/L BALE / TOTAL P/L) auto-hide inside the PDF generator
      // when no item has a configured price. Gate on hideSelling || hideCost here to
      // match every other invoice-PDF call site (posPrintRoutes.ts, importRoutes.ts) —
      // do NOT gate on hideSalesProfitCost, which is a separate, unrelated flag.
      const hideProfitCols = waVis.hideSelling || waVis.hideCost;
      const pdfBuffer = await generateInvoicePdf(parseInt(voucherId), companyId, senderName, { hideProfitCols });
      const safeDate = (voucher.voucherDate ?? getClientDate(req)).replace(/[^0-9-]/g, "");
      const safeLoc = (location.name ?? "").replace(/[^\w\s.()\-]/g, "_").trim();

      // For credit sales, resolve customer name for the filename
      let customerNameForFile2: string | null = null;
      if (voucher.isCreditSale) {
        const [custEntry2] = await db
          .select({ name: ledgerAccounts.name })
          .from(voucherEntries)
          .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, voucherEntries.ledgerAccountId))
          .where(and(eq(voucherEntries.voucherId, voucher.id), sql`${voucherEntries.debitAmount}::numeric > 0`))
          .limit(1);
        customerNameForFile2 = custEntry2?.name || null;
      }

      const rawFileName2 = customerNameForFile2
        ? `${customerNameForFile2} Invoice ${safeLoc} ${safeDate}`
        : `${safeLoc} Invoice ${safeDate}`;
      const fileName =
        rawFileName2
          .replace(/[^\w\s.()\-]/g, "_")
          .replace(/\s+/g, " ")
          .trim() + ".pdf";
      const caption = "";

      logger.info(
        `[WA invoice upload] chatId=${location.whatsappGroupChatId} file=${fileName} size=${pdfBuffer.length}`
      );
      const result = await sendWhatsAppFileByUploadPos(location.whatsappGroupChatId, pdfBuffer, fileName, caption);
      if (!result.success) {
        return res.status(502).json({ message: result.error ?? "Failed to send WhatsApp PDF" });
      }

      logger.info("WhatsApp invoice send succeeded", { module: "pos", action: "sendInvoiceWhatsApp", userId: (req as any).user?.id, companyId: req.session.currentCompanyId, voucherId });
      res.json({ success: true, message: "Invoice PDF sent to WhatsApp" });
    } catch (error: any) {
      logger.error("WhatsApp invoice send failed", { module: "pos", action: "sendInvoiceWhatsApp", userId: (req as any).user?.id, companyId: req.session.currentCompanyId, error });
      logger.error("[/api/pos/send-invoice-whatsapp]", { error: error });
      res.status(500).json({ message: error.message });
    }
  });
}
