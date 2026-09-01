/**
 * sendRevisedTransferWhatsApp.ts
 * Fire-and-forget helper: build the revised transfer image (shows before/change/after)
 * and send it to the transfer WhatsApp group configured in Settings → Stock
 * Transfers for the POS source (assigned) location.
 */

import { db } from "../db";
import { getErrorMessage } from "../lib/httpHandlers";
import { logger } from "../lib/logger";
import { locations, companies, stockItems } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { generateRevisedTransferImageBuffer } from "./generateTransferImage";
import { sendWhatsAppFileToChatIdPos, sendWhatsAppTextToChatIdPos } from "../services/whatsappService";
import { format } from "date-fns";

export interface RevisedTransferWAItem {
  stockItemId: number;
  stockItemName: string | null;
  originalQuantity: number;
  delta: number;
  newQuantity: number;
}

export interface SendRevisedTransferWAOptions {
  sourceLocationId: number;
  sourceLocationName: string;
  /** Kept for image/context logging only. It must never choose the recipient. */
  destinationLocationId?: number;
  destLocationName: string;
  items: RevisedTransferWAItem[];
  voucherNumber: string;
  voucherDate: string;
}

/**
 * Generate and send the revised stock transfer image.
 *
 * A POS revision belongs to the POS user/source location. The immutable
 * revision route enforces that every submitted sourceLocationId equals the POS
 * user's assigned location. The recipient is that location's transfer WhatsApp
 * group from Settings → Stock Transfers (locations.transferWaGroupChatId),
 * with the company-level transfer group as fallback — the same routing as
 * transfer creation.
 *
 * IMPORTANT: the transfer destination must never choose the recipient here.
 * If neither the location nor the company has a transfer group configured we
 * skip rather than falling back to a POS or destination chat.
 *
 * Designed to be called fire-and-forget — never throws.
 */
export async function sendRevisedTransferWhatsApp(opts: SendRevisedTransferWAOptions): Promise<void> {
  const {
    sourceLocationId,
    sourceLocationName,
    destinationLocationId,
    destLocationName,
    items,
    voucherNumber,
    voucherDate,
  } = opts;

  logger.info(
    `[RevisedTransferWA] Starting for ${voucherNumber} → sourceLocId=${sourceLocationId}, destLocId=${destinationLocationId ?? "unknown"}, items=${items.length}`
  );

  if (!items || items.length === 0) {
    logger.warn(`[RevisedTransferWA] No items for ${voucherNumber} — skipping`);
    return;
  }

  if (!Number.isInteger(sourceLocationId) || sourceLocationId <= 0) {
    logger.warn(`[RevisedTransferWA] Invalid POS source location for ${voucherNumber} — skipping`);
    return;
  }

  const [sourceLocation] = await db
    .select({
      id: locations.id,
      name: locations.name,
      companyId: locations.companyId,
      transferWaGroupChatId: locations.transferWaGroupChatId,
    })
    .from(locations)
    .where(eq(locations.id, sourceLocationId))
    .limit(1);

  if (!sourceLocation) {
    logger.warn(`[RevisedTransferWA] Source location ${sourceLocationId} not found for ${voucherNumber} — skipping`);
    return;
  }

  // Settings → Stock Transfers group for the POS source location, falling back
  // to the company-level transfer group — the same routing as transfer creation.
  let chatId = sourceLocation.transferWaGroupChatId?.trim() || null;
  let routingSource = "location transfer group";
  if (!chatId && sourceLocation.companyId) {
    const [company] = await db
      .select({ transferWaGroupChatId: companies.transferWaGroupChatId })
      .from(companies)
      .where(eq(companies.id, sourceLocation.companyId))
      .limit(1);
    chatId = company?.transferWaGroupChatId?.trim() || null;
    routingSource = "company transfer group";
  }

  if (!chatId) {
    logger.info(
      `[RevisedTransferWA] No transfer WhatsApp group configured for source location ${sourceLocationId} (${sourceLocation.name}) or its company for ${voucherNumber} — skipping without fallback`
    );
    return;
  }

  logger.info(
    `[RevisedTransferWA] Routing ${voucherNumber} to ${routingSource} ${chatId} for location ${sourceLocationId} (${sourceLocation.name})`
  );

  const uniqueIds = [...new Set(items.map((i) => i.stockItemId).filter((id) => id > 0))];
  const itemRows =
    uniqueIds.length > 0
      ? await db
          .select({ id: stockItems.id, name: stockItems.name, uom: stockItems.uom })
          .from(stockItems)
          .where(inArray(stockItems.id, uniqueIds))
      : [];
  const itemMap = new Map(itemRows.map((r) => [r.id, r]));

  const imageItems = items.map((i) => {
    const si = itemMap.get(i.stockItemId);
    return {
      name: i.stockItemName || si?.name || `Item #${i.stockItemId}`,
      uom: si?.uom ?? "",
      before: i.originalQuantity,
      delta: i.delta,
      after: i.newQuantity,
    };
  });

  let displayDate = voucherDate;
  try {
    displayDate = format(new Date(voucherDate), "dd MMM yyyy");
  } catch {
    /* keep raw */
  }

  const caption = [
    `*Stock Transfer Revision*`,
    `${displayDate}  •  ${sourceLocationName} → ${destLocationName}`,
    ...imageItems.map((i) => `• ${i.name}: ${i.before} → ${i.after} ${i.uom} (${i.delta >= 0 ? "+" : ""}${i.delta})`),
  ].join("\n");

  let pngBuffer: Buffer | null = null;
  try {
    logger.info(`[RevisedTransferWA] Generating revised PNG for ${voucherNumber}...`);
    pngBuffer = await generateRevisedTransferImageBuffer({
      voucherNumber,
      date: displayDate,
      sourceLocationName,
      destLocationName,
      items: imageItems,
    });
    logger.info(`[RevisedTransferWA] PNG generated (${pngBuffer.length} bytes).`);
  } catch (imgErr: unknown) {
    logger.warn(
      `[RevisedTransferWA] Image generation failed for ${voucherNumber} — falling back to text. Error: ${getErrorMessage(imgErr)}`
    );
  }

  const safeVoucher = voucherNumber.replace(/[^a-zA-Z0-9_-]/g, "_");
  const fileName = `Revised_Transfer_${safeVoucher}.png`;

  let imageSent = false;
  if (pngBuffer) {
    const result = await sendWhatsAppFileToChatIdPos(chatId, pngBuffer, fileName, "", "image/png");
    if (result.success) {
      imageSent = true;
      logger.info(
        `[RevisedTransferWA] Sent ${voucherNumber} revised image to ${routingSource} ${chatId} (location ${sourceLocationId})`
      );
    } else {
      logger.warn(`[RevisedTransferWA] Image send failed for ${voucherNumber} → ${chatId}: ${result.error}`);
    }
  }

  if (!imageSent) {
    const textResult = await sendWhatsAppTextToChatIdPos(chatId, caption);
    if (textResult.success) {
      logger.info(
        `[RevisedTransferWA] Text fallback sent for ${voucherNumber} → ${routingSource} ${chatId} (location ${sourceLocationId})`
      );
    } else {
      logger.warn(`[RevisedTransferWA] Text fallback failed for ${voucherNumber} → ${chatId}: ${textResult.error}`);
    }
  }
}
