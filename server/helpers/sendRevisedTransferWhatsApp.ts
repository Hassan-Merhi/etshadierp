/**
 * sendRevisedTransferWhatsApp.ts
 * Fire-and-forget helper: build the revised transfer image (shows before/change/after)
 * and send it to the POS user's assigned source-location WhatsApp group.
 */

import { db } from "../db";
import { getErrorMessage } from "../lib/httpHandlers";
import { logger } from "../lib/logger";
import { locations, stockItems } from "@shared/schema";
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
  /**
   * Retained because the revision lifecycle already returns the destination and
   * callers use it for the rendered transfer context. Revision delivery itself
   * is intentionally routed by sourceLocationId so a POS user's revision can
   * never leak into another location's transfer group.
   */
  destinationLocationId?: number;
  destLocationName: string;
  items: RevisedTransferWAItem[];
  voucherNumber: string;
  voucherDate: string;
}

/**
 * Generate and send the revised stock transfer image.
 *
 * POS revisions are owned by the POS user's source location. Send only to that
 * location's normal POS WhatsApp group (locations.whatsapp_group_chat_id), the
 * same assignment used by the POS stock/invoice send routes. Do not fall back
 * to the destination transfer group or a company-wide transfer group: a missing
 * POS group must skip safely rather than send the revision to the wrong chat.
 *
 * Designed to be called fire-and-forget — never throws.
 */
export async function sendRevisedTransferWhatsApp(opts: SendRevisedTransferWAOptions): Promise<void> {
  const { sourceLocationId, sourceLocationName, destLocationName, items, voucherNumber, voucherDate } = opts;

  logger.info(
    `[RevisedTransferWA] Starting for ${voucherNumber} → sourceLocId=${sourceLocationId}, destLocId=${opts.destinationLocationId ?? "unknown"}, items=${items.length}`
  );

  if (!items || items.length === 0) {
    logger.warn(`[RevisedTransferWA] No items for ${voucherNumber} — skipping`);
    return;
  }

  if (!Number.isInteger(sourceLocationId) || sourceLocationId <= 0) {
    logger.warn(`[RevisedTransferWA] Invalid POS source location for ${voucherNumber} — skipping`);
    return;
  }

  const [sourceLoc] = await db
    .select({
      id: locations.id,
      name: locations.name,
      whatsappGroupChatId: locations.whatsappGroupChatId,
    })
    .from(locations)
    .where(eq(locations.id, sourceLocationId))
    .limit(1);

  if (!sourceLoc) {
    logger.warn(`[RevisedTransferWA] Source location ${sourceLocationId} not found for ${voucherNumber} — skipping`);
    return;
  }

  const chatId = sourceLoc.whatsappGroupChatId?.trim() || null;
  if (!chatId) {
    logger.info(
      `[RevisedTransferWA] No POS WhatsApp group assigned to source location ${sourceLocationId} (${sourceLoc.name}) for ${voucherNumber} — skipping`
    );
    return;
  }

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
        `[RevisedTransferWA] Sent ${voucherNumber} revised image to POS source group ${chatId} (location ${sourceLocationId})`
      );
    } else {
      logger.warn(`[RevisedTransferWA] Image send failed for ${voucherNumber} → ${chatId}: ${result.error}`);
    }
  }

  if (!imageSent) {
    const textResult = await sendWhatsAppTextToChatIdPos(chatId, caption);
    if (textResult.success) {
      logger.info(
        `[RevisedTransferWA] Text fallback sent for ${voucherNumber} → POS source group ${chatId} (location ${sourceLocationId})`
      );
    } else {
      logger.warn(`[RevisedTransferWA] Text fallback failed for ${voucherNumber} → ${chatId}: ${textResult.error}`);
    }
  }
}
