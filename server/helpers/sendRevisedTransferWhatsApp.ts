/**
 * sendRevisedTransferWhatsApp.ts
 * Fire-and-forget helper: build the revised transfer image (shows before/change/after)
 * and send it to the WhatsApp group assigned to the transfer destination.
 */

import { db } from "../db";
import { getErrorMessage } from "../lib/httpHandlers";
import { logger } from "../lib/logger";
import { companies, locations, stockItems } from "@shared/schema";
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
  destinationLocationId: number;
  destLocationName: string;
  items: RevisedTransferWAItem[];
  voucherNumber: string;
  voucherDate: string;
}

/**
 * Generate and send the revised stock transfer image.
 *
 * POS revisions follow the same routing rule as the original stock transfer:
 *   1. destination location's transfer WhatsApp group
 *      (locations.transferWaGroupChatId — Settings → Stock Transfers — WhatsApp)
 *   2. destination company's configured fallback transfer group when the
 *      destination has no location-specific assignment.
 *
 * This deliberately does NOT use locations.whatsappGroupChatId (the normal POS
 * stock/invoice group), because the destination mapping shown in Settings is the
 * authoritative route for stock-transfer and stock-transfer-revision images.
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
    `[RevisedTransferWA] Starting for ${voucherNumber} → sourceLocId=${sourceLocationId}, destLocId=${destinationLocationId}, items=${items.length}`
  );

  if (!items || items.length === 0) {
    logger.warn(`[RevisedTransferWA] No items for ${voucherNumber} — skipping`);
    return;
  }

  if (!Number.isInteger(destinationLocationId) || destinationLocationId <= 0) {
    logger.warn(`[RevisedTransferWA] Invalid destination location for ${voucherNumber} — skipping`);
    return;
  }

  const [destination] = await db
    .select({
      id: locations.id,
      name: locations.name,
      companyId: locations.companyId,
      transferWaGroupChatId: locations.transferWaGroupChatId,
    })
    .from(locations)
    .where(eq(locations.id, destinationLocationId))
    .limit(1);

  if (!destination) {
    logger.warn(`[RevisedTransferWA] Destination location ${destinationLocationId} not found for ${voucherNumber} — skipping`);
    return;
  }

  let chatId = destination.transferWaGroupChatId?.trim() || null;
  let routingSource = "destination location";

  if (!chatId && destination.companyId) {
    const [company] = await db
      .select({ transferWaGroupChatId: companies.transferWaGroupChatId })
      .from(companies)
      .where(eq(companies.id, destination.companyId))
      .limit(1);
    chatId = company?.transferWaGroupChatId?.trim() || null;
    routingSource = "company fallback";
  }

  if (!chatId) {
    logger.info(
      `[RevisedTransferWA] No transfer WhatsApp group configured for destination ${destinationLocationId} (${destination.name}) or its company for ${voucherNumber} — skipping`
    );
    return;
  }

  logger.info(
    `[RevisedTransferWA] Routing ${voucherNumber} to ${routingSource} group ${chatId} for destination ${destinationLocationId} (${destination.name})`
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
        `[RevisedTransferWA] Sent ${voucherNumber} revised image to ${routingSource} group ${chatId} (destination ${destinationLocationId})`
      );
    } else {
      logger.warn(`[RevisedTransferWA] Image send failed for ${voucherNumber} → ${chatId}: ${result.error}`);
    }
  }

  if (!imageSent) {
    const textResult = await sendWhatsAppTextToChatIdPos(chatId, caption);
    if (textResult.success) {
      logger.info(
        `[RevisedTransferWA] Text fallback sent for ${voucherNumber} → ${routingSource} group ${chatId} (destination ${destinationLocationId})`
      );
    } else {
      logger.warn(`[RevisedTransferWA] Text fallback failed for ${voucherNumber} → ${chatId}: ${textResult.error}`);
    }
  }
}
