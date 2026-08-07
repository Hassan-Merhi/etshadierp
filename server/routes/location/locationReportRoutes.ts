import type { Express, NextFunction, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { companies, stockGroups } from "@shared/schema";
import { db, pool } from "../../db";
import { generateStockPdf } from "../../helpers/generateStockPdf";
import { getClientDate } from "../../lib/dateUtils";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { requireExportAccess, requireSensitiveAccess } from "../../lib/permissionMiddleware";
import { storage } from "../../storage";
import { requireAuth, requireNonPOS } from "../../auth";
import { sendWhatsAppFileToChatIdPos } from "../../services/whatsappService";
import { logAudit } from "../_helpers";

const LOCATION_WHATSAPP_PERMISSION = "exp_whatsapp_send";
const requireCostPriceAccess = requireSensitiveAccess("fld_cost_price");
const requireTotalValueAccess = requireSensitiveAccess("fld_total_value");

function parseIncludeCost(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function requireCostReportAccess(req: Request, res: Response, next: NextFunction): void {
  if (!parseIncludeCost(req.body?.includeCost)) {
    next();
    return;
  }

  requireCostPriceAccess(req, res, (error?: unknown) => {
    if (error) {
      next(error);
      return;
    }
    requireTotalValueAccess(req, res, next);
  });
}

function safeFilePart(value: string): string {
  return value.replace(/[^\w\s.\-]/g, "_").replace(/\s+/g, "_");
}

export function registerLocationReportRoutes(app: Express) {
  // Manual Phase-2 delivery: generate the same Godown Summary PDF available from
  // Location Inventory and send it to the location's verified WhatsApp group.
  // Cost-bearing reports additionally require both cost-price and total-value
  // visibility permissions; the no-cost report never exposes those fields.
  app.post(
    "/api/locations/:locationId/send-stock-whatsapp",
    requireAuth,
    requireNonPOS,
    requireExportAccess(LOCATION_WHATSAPP_PERMISSION),
    requireCostReportAccess,
    async (req, res) => {
      try {
        const locationId = Number.parseInt(req.params.locationId, 10);
        if (!Number.isFinite(locationId)) {
          return res.status(400).json({ message: "Invalid location ID" });
        }

        const companyId = req.session.currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });

        const location = await storage.getLocationById(locationId);
        if (!location) return res.status(404).json({ message: "Location not found" });
        if (location.companyId !== companyId) {
          return res.status(403).json({ message: "Access denied" });
        }

        const configResult = await pool.query<{
          whatsapp_group_chat_id: string | null;
          whatsapp_group_name: string | null;
          enabled: boolean;
        }>(
          `SELECT whatsapp_group_chat_id, whatsapp_group_name, enabled
             FROM location_whatsapp_stock_reports
            WHERE location_id = $1 AND company_id = $2`,
          [locationId, companyId]
        );
        const config = configResult.rows[0];
        const chatId = config?.whatsapp_group_chat_id?.trim() || null;

        if (!chatId) {
          return res.status(400).json({
            message: "No WhatsApp group is linked to this location. Link one from Location Inventory first.",
          });
        }
        if (!chatId.endsWith("@g.us")) {
          return res.status(400).json({
            message: "The saved WhatsApp destination is not a verified group. Re-link the location to a group first.",
          });
        }
        if (config.enabled !== true) {
          return res.status(400).json({
            message: "WhatsApp stock reports are disabled for this location. Enable them before sending.",
          });
        }

        const includeCost = parseIncludeCost(req.body?.includeCost);
        const hasGroupFilter = Object.prototype.hasOwnProperty.call(req.body ?? {}, "stockGroupId");
        let stockGroupId: number | null | undefined = undefined;
        let stockGroupName: string | null = null;

        if (hasGroupFilter) {
          const rawGroupId = req.body?.stockGroupId;
          if (rawGroupId === null || rawGroupId === "none") {
            stockGroupId = null;
            stockGroupName = "Unassigned";
          } else {
            const parsedGroupId = Number.parseInt(String(rawGroupId), 10);
            if (!Number.isFinite(parsedGroupId) || parsedGroupId <= 0) {
              return res.status(400).json({ message: "Invalid stock group ID" });
            }

            const [group] = await db
              .select({ id: stockGroups.id, name: stockGroups.name })
              .from(stockGroups)
              .where(and(eq(stockGroups.id, parsedGroupId), eq(stockGroups.companyId, companyId)))
              .limit(1);
            if (!group) {
              return res.status(404).json({ message: "Stock group not found for this company" });
            }
            stockGroupId = group.id;
            stockGroupName = group.name;
          }
        }

        const [company] = await db
          .select({ name: companies.name })
          .from(companies)
          .where(eq(companies.id, companyId))
          .limit(1);
        const companyName = company?.name || "Company";

        const { buffer, pageCount, rowCount } = await generateStockPdf(
          companyId,
          companyName,
          locationId,
          location.name,
          includeCost,
          stockGroupId
        );

        if (rowCount === 0) {
          return res.status(400).json({
            message: stockGroupName
              ? `No non-zero stock items were found in ${stockGroupName} for this location.`
              : "No non-zero stock items were found for this location.",
          });
        }

        // Guard against a PDF layout regression producing an unexpectedly huge
        // attachment. This mirrors the scheduled stock-report safety policy.
        const maxAllowedPages = Math.ceil(rowCount / 20) + 5;
        if (pageCount > maxAllowedPages) {
          logger.error("[LocationStockWhatsApp] PDF safety guard rejected report", {
            companyId,
            locationId,
            pageCount,
            rowCount,
            maxAllowedPages,
          });
          return res.status(500).json({
            message: "The stock PDF failed a layout safety check and was not sent.",
          });
        }

        const safeDate = getClientDate(req).replace(/-/g, "");
        const safeLocation = safeFilePart(location.name);
        const scope = stockGroupName ? `${safeLocation}_${safeFilePart(stockGroupName)}` : `${safeLocation}_Godown`;
        const mode = includeCost ? "with_cost" : "no_cost";
        const fileName = `${scope}_${safeDate}_${mode}.pdf`;
        const reportLabel = stockGroupName ? `${location.name} — ${stockGroupName}` : location.name;
        const caption = `Stock Report — ${reportLabel} — ${includeCost ? "With Cost" : "Without Cost"}`;

        const sendResult = await sendWhatsAppFileToChatIdPos(
          chatId,
          buffer,
          fileName,
          caption,
          "application/pdf"
        );
        if (!sendResult.success) {
          logger.error("[LocationStockWhatsApp] Send failed", {
            companyId,
            locationId,
            chatId,
            fileName,
            includeCost,
            stockGroupId,
            error: sendResult.error,
          });
          return res.status(502).json({ message: sendResult.error || "WhatsApp send failed" });
        }

        try {
          await logAudit({
            userId: req.session.userId!,
            username: (req.session as any).username || "unknown",
            companyId,
            action: "send_location_stock_whatsapp",
            tableName: "location_whatsapp_stock_reports",
            recordId: locationId,
            recordIdentifier: location.name,
            changes: {
              includeCost: { old: null, new: includeCost },
              stockGroupId: { old: null, new: stockGroupId ?? null },
              stockGroupName: { old: null, new: stockGroupName },
              itemCount: { old: null, new: rowCount },
              pageCount: { old: null, new: pageCount },
              whatsappGroupName: { old: null, new: config.whatsapp_group_name ?? null },
              fileName: { old: null, new: fileName },
            },
          });
        } catch {
          // A completed external send must not be reported as failed merely because
          // audit persistence is temporarily unavailable.
        }

        res.json({
          message: `Stock PDF sent to ${config.whatsapp_group_name || "the linked WhatsApp group"}`,
          itemCount: rowCount,
          pageCount,
          includeCost,
          stockGroupId: stockGroupId ?? null,
          stockGroupName,
          fileName,
        });
      } catch (error: unknown) {
        logger.error("[LocationStockWhatsApp] Error", { error });
        res.status(500).json({ message: getErrorMessage(error) });
      }
    }
  );
}
