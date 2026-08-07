import { pool } from "../db";
import { generateStockPdf } from "../helpers/generateStockPdf";
import { releaseManagedExportAttachment } from "../helpers/exportAttachmentSource";
import { getErrorMessage } from "../lib/httpHandlers";
import { logger } from "../lib/logger";
import { sendWhatsAppFileToChatIdPos } from "./whatsappService";

export type LocationStockDeliverySource = "manual" | "scheduled" | "retry";
export type LocationStockDeliveryStatus = "running" | "sent" | "failed" | "skipped_empty";

export interface LocationStockDeliveryRequest {
  companyId: number;
  locationId: number;
  includeCost: boolean;
  includeZeroStock?: boolean;
  includeNegativeStock?: boolean;
  stockGroupId?: number | null;
  categoryId?: number | null;
  source: LocationStockDeliverySource;
  initiatedByUserId?: string | null;
  scheduledFor?: string | null;
  retryOfId?: number | null;
  idempotencyKey: string;
  reportDate?: string;
}

export interface LocationStockDeliveryResult {
  deliveryId: number;
  status: LocationStockDeliveryStatus;
  duplicate: boolean;
  itemCount: number | null;
  pageCount: number | null;
  fileName: string | null;
  error: string | null;
  destinationGroupName: string | null;
}

interface DeliveryContext {
  locationName: string;
  companyName: string;
  chatId: string | null;
  groupName: string | null;
  destinationEnabled: boolean;
}

function safeFilePart(value: string): string {
  return value.replace(/[^\w\s.\-]/g, "_").replace(/\s+/g, "_");
}

function normalizeReportDate(value?: string): string {
  const raw = value || new Date().toISOString().slice(0, 10);
  return raw.replace(/[^0-9]/g, "").slice(0, 8) || new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

async function loadDeliveryContext(companyId: number, locationId: number): Promise<DeliveryContext> {
  const result = await pool.query<{
    location_name: string;
    company_name: string;
    whatsapp_group_chat_id: string | null;
    whatsapp_group_name: string | null;
    destination_enabled: boolean | null;
  }>(
    `SELECT l.name AS location_name,
            c.name AS company_name,
            d.whatsapp_group_chat_id,
            d.whatsapp_group_name,
            d.enabled AS destination_enabled
       FROM locations l
       JOIN companies c ON c.id = l.company_id
       LEFT JOIN location_whatsapp_stock_reports d
         ON d.location_id = l.id AND d.company_id = l.company_id
      WHERE l.id = $1 AND l.company_id = $2
      LIMIT 1`,
    [locationId, companyId]
  );
  const row = result.rows[0];
  if (!row) throw new Error("Location not found for the active company");
  return {
    locationName: row.location_name,
    companyName: row.company_name,
    chatId: row.whatsapp_group_chat_id?.trim() || null,
    groupName: row.whatsapp_group_name ?? null,
    destinationEnabled: row.destination_enabled === true,
  };
}

async function claimDelivery(
  request: LocationStockDeliveryRequest,
  context: DeliveryContext
): Promise<{ id: number; duplicate: boolean; existing?: LocationStockDeliveryResult }> {
  const stockGroupUnassigned = request.stockGroupId === null;
  const storedStockGroupId = typeof request.stockGroupId === "number" ? request.stockGroupId : null;
  const result = await pool.query<{ id: string | number }>(
    `INSERT INTO location_whatsapp_stock_deliveries (
        company_id, location_id, source, retry_of_id, idempotency_key, status,
        include_cost, include_zero_stock, include_negative_stock,
        stock_group_id, stock_group_unassigned, category_id,
        initiated_by_user_id, scheduled_for,
        destination_chat_id, destination_group_name, started_at
      ) VALUES ($1,$2,$3,$4,$5,'running',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now())
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id`,
    [
      request.companyId,
      request.locationId,
      request.source,
      request.retryOfId ?? null,
      request.idempotencyKey,
      request.includeCost,
      request.includeZeroStock === true,
      request.includeNegativeStock !== false,
      storedStockGroupId,
      stockGroupUnassigned,
      request.categoryId ?? null,
      request.initiatedByUserId ?? null,
      request.scheduledFor ?? null,
      context.chatId,
      context.groupName,
    ]
  );

  if (result.rows.length) return { id: Number(result.rows[0].id), duplicate: false };

  const existing = await pool.query<{
    id: string | number;
    status: LocationStockDeliveryStatus;
    item_count: number | null;
    page_count: number | null;
    file_name: string | null;
    error: string | null;
    destination_group_name: string | null;
  }>(
    `SELECT id, status, item_count, page_count, file_name, error, destination_group_name
       FROM location_whatsapp_stock_deliveries
      WHERE idempotency_key = $1
      LIMIT 1`,
    [request.idempotencyKey]
  );
  const row = existing.rows[0];
  if (!row) throw new Error("Could not claim WhatsApp delivery");
  return {
    id: Number(row.id),
    duplicate: true,
    existing: {
      deliveryId: Number(row.id),
      status: row.status,
      duplicate: true,
      itemCount: row.item_count,
      pageCount: row.page_count,
      fileName: row.file_name,
      error: row.error,
      destinationGroupName: row.destination_group_name,
    },
  };
}

async function completeDelivery(
  deliveryId: number,
  status: Exclude<LocationStockDeliveryStatus, "running">,
  details: {
    error?: string | null;
    itemCount?: number | null;
    pageCount?: number | null;
    fileName?: string | null;
    reportGenerated?: boolean;
  } = {}
): Promise<void> {
  await pool.query(
    `UPDATE location_whatsapp_stock_deliveries
        SET status = $2,
            error = $3,
            item_count = COALESCE($4::integer, item_count),
            page_count = COALESCE($5::integer, page_count),
            file_name = COALESCE($6::text, file_name),
            report_generated_at = CASE WHEN $7::boolean THEN COALESCE(report_generated_at, now()) ELSE report_generated_at END,
            completed_at = now()
      WHERE id = $1`,
    [
      deliveryId,
      status,
      details.error ? details.error.slice(0, 1000) : null,
      details.itemCount ?? null,
      details.pageCount ?? null,
      details.fileName ?? null,
      details.reportGenerated === true,
    ]
  );
}

async function updateGeneratedMetadata(
  deliveryId: number,
  itemCount: number,
  pageCount: number,
  fileName: string
): Promise<void> {
  await pool.query(
    `UPDATE location_whatsapp_stock_deliveries
        SET report_generated_at = now(), item_count = $2, page_count = $3, file_name = $4
      WHERE id = $1`,
    [deliveryId, itemCount, pageCount, fileName]
  );
}

export async function deliverLocationStockWhatsApp(
  request: LocationStockDeliveryRequest
): Promise<LocationStockDeliveryResult> {
  const context = await loadDeliveryContext(request.companyId, request.locationId);
  const claimed = await claimDelivery(request, context);
  if (claimed.duplicate && claimed.existing) return claimed.existing;
  const deliveryId = claimed.id;

  try {
    if (!context.chatId) {
      const error = "No WhatsApp group is linked to this location";
      await completeDelivery(deliveryId, "failed", { error });
      return { deliveryId, status: "failed", duplicate: false, itemCount: null, pageCount: null, fileName: null, error, destinationGroupName: context.groupName };
    }
    if (!context.chatId.endsWith("@g.us")) {
      const error = "The linked WhatsApp destination is not a valid group";
      await completeDelivery(deliveryId, "failed", { error });
      return { deliveryId, status: "failed", duplicate: false, itemCount: null, pageCount: null, fileName: null, error, destinationGroupName: context.groupName };
    }
    if (!context.destinationEnabled) {
      const error = "WhatsApp stock reports are disabled for this location";
      await completeDelivery(deliveryId, "failed", { error });
      return { deliveryId, status: "failed", duplicate: false, itemCount: null, pageCount: null, fileName: null, error, destinationGroupName: context.groupName };
    }

    const { buffer, pageCount, rowCount } = await generateStockPdf(
      request.companyId,
      context.companyName,
      request.locationId,
      context.locationName,
      request.includeCost,
      request.stockGroupId,
      {
        includeZeroStock: request.includeZeroStock === true,
        includeNegativeStock: request.includeNegativeStock !== false,
        categoryId: request.categoryId ?? null,
      }
    );

    const safeLocation = safeFilePart(context.locationName);
    const mode = request.includeCost ? "with_cost" : "no_cost";
    const fileName = `${safeLocation}_Godown_${normalizeReportDate(request.reportDate)}_${mode}.pdf`;

    try {
      await updateGeneratedMetadata(deliveryId, rowCount, pageCount, fileName);

      if (rowCount === 0) {
        await completeDelivery(deliveryId, "skipped_empty", {
          itemCount: 0,
          pageCount,
          fileName,
          reportGenerated: true,
        });
        return {
          deliveryId,
          status: "skipped_empty",
          duplicate: false,
          itemCount: 0,
          pageCount,
          fileName,
          error: null,
          destinationGroupName: context.groupName,
        };
      }

      const maxAllowedPages = Math.ceil(rowCount / 20) + 5;
      if (pageCount > maxAllowedPages) {
        const error = `PDF safety guard rejected ${pageCount} pages for ${rowCount} rows`;
        await completeDelivery(deliveryId, "failed", {
          error,
          itemCount: rowCount,
          pageCount,
          fileName,
          reportGenerated: true,
        });
        return {
          deliveryId,
          status: "failed",
          duplicate: false,
          itemCount: rowCount,
          pageCount,
          fileName,
          error,
          destinationGroupName: context.groupName,
        };
      }

      const caption = `Stock Report — ${context.locationName} — ${request.includeCost ? "With Cost" : "Without Cost"}`;
      const sendResult = await sendWhatsAppFileToChatIdPos(
        context.chatId,
        buffer,
        fileName,
        caption,
        "application/pdf"
      );
      if (!sendResult.success) {
        const error = sendResult.error || "WhatsApp send failed";
        await completeDelivery(deliveryId, "failed", {
          error,
          itemCount: rowCount,
          pageCount,
          fileName,
          reportGenerated: true,
        });
        return {
          deliveryId,
          status: "failed",
          duplicate: false,
          itemCount: rowCount,
          pageCount,
          fileName,
          error,
          destinationGroupName: context.groupName,
        };
      }

      await completeDelivery(deliveryId, "sent", {
        itemCount: rowCount,
        pageCount,
        fileName,
        reportGenerated: true,
      });
      logger.info("[LocationStockWhatsAppDelivery] sent", {
        deliveryId,
        companyId: request.companyId,
        locationId: request.locationId,
        source: request.source,
        includeCost: request.includeCost,
        rowCount,
        pageCount,
        groupName: context.groupName,
      });
      return {
        deliveryId,
        status: "sent",
        duplicate: false,
        itemCount: rowCount,
        pageCount,
        fileName,
        error: null,
        destinationGroupName: context.groupName,
      };
    } finally {
      await releaseManagedExportAttachment(buffer);
    }
  } catch (error: unknown) {
    const message = getErrorMessage(error) || "WhatsApp stock report failed";
    await completeDelivery(deliveryId, "failed", { error: message }).catch(() => undefined);
    logger.error("[LocationStockWhatsAppDelivery] failed", {
      deliveryId,
      companyId: request.companyId,
      locationId: request.locationId,
      source: request.source,
      error,
    });
    return {
      deliveryId,
      status: "failed",
      duplicate: false,
      itemCount: null,
      pageCount: null,
      fileName: null,
      error: message,
      destinationGroupName: context.groupName,
    };
  }
}
