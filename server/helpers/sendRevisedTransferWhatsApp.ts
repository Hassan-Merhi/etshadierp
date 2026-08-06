/**
 * sendRevisedTransferWhatsApp.ts
 * Fire-and-forget helper: build the revised transfer image (shows before/change/after)
 * and send it to the same WA group used for the original transfer.
 */

import { db } from "../db";
import { getErrorMessage } from "../lib/httpHandlers";
import { logger } from "../lib/logger";
import { companies, locations, stockItems, stockTransferVouchers, vouchers } from "@shared/schema";
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
  destLocationName: string;
  items: RevisedTransferWAItem[];
  voucherNumber: string;
  voucherDate: string;
}

/**
 * Generate and send the revised stock transfer image.
 * Routes to the transfer destination's WA group, matching the original transfer.
 * The source location is retained only as a compatibility fallback when the
 * transfer cannot be resolved from the voucher number.
 * Designed to be called fire-and-forget — never throws.
 */
export async function sendRevisedTransferWhatsApp(opts: SendRevisedTransferWAOptions): Promise<void> {
  const { sourceLocationId, sourceLocationName, destLocationName, items, voucherNumber, voucherDate } = opts;

  logger.info(
    `[RevisedTransferWA] Starting for ${voucherNumber} → fallbackSrcLocId=${sourceLocationId}, items=${items.length}`
  );

  if (!items || items.length === 0) {
    logger.warn(`[RevisedTransferWA] No items for ${voucherNumber} — skipping`);
    return;
  }

  const [transferTarget] = await db
    .select({ destinationLocationId: stockTransferVouchers.destinationLocationId })
    .from(stockTransferVouchers)
    .innerJoin(vouchers, eq(vouchers.id, stockTransferVouchers.voucherId))
    .where(eq(vouchers.voucherNumber, voucherNumber))
    .limit(1);

  const targetLocationId = transferTarget?.destinationLocationId ?? sourceLocationId;
  if (!transferTarget?.destinationLocationId) {
    logger.warn(
      `[RevisedTransferWA] Could not resolve destination for ${voucherNumber}; using source location ${sourceLocationId} as fallback`
    );
  }

  const chatIds = new Set<string>();
  const [targetLoc] = await db
    .select({ companyId: locations.companyId, transferWaGroupChatId: locations.transferWaGroupChatId })
    .from(locations)
    .where(eq(locations.id, targetLocationId));

  if (targetLoc?.transferWaGroupChatId) {
    chatIds.add(targetLoc.transferWaGroupChatId);
  } else if (targetLoc?.companyId) {
    const [company] = await db
      .select({ transferWaGroupChatId: companies.transferWaGroupChatId })
      .from(companies)
      .where(eq(companies.id, targetLoc.companyId));
    if (company?.transferWaGroupChatId) chatIds.add(company.transferWaGroupChatId);
  }

  if (chatIds.size === 0) {
    logger.info(
      `[RevisedTransferWA] No WA group configured for destination location ${targetLocationId} (${voucherNumber}) — skipping`
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

  for (const chatId of chatIds) {
    let imageSent = false;
    if (pngBuffer) {
      const result = await sendWhatsAppFileToChatIdPos(chatId, pngBuffer, fileName, "", "image/png");
      if (result.success) {
        imageSent = true;
        logger.info(`[RevisedTransferWA] Sent ${voucherNumber} revised image to destination group ${chatId}`);
      } else {
        logger.warn(`[RevisedTransferWA] Image send failed for ${voucherNumber} → ${chatId}: ${result.error}`);
      }
    }
    if (!imageSent) {
      const textResult = await sendWhatsAppTextToChatIdPos(chatId, caption);
      if (textResult.success) {
        logger.info(`[RevisedTransferWA] Text fallback sent for ${voucherNumber} → ${chatId}`);
      } else {
        logger.warn(`[RevisedTransferWA] Text fallback failed for ${voucherNumber} → ${chatId}: ${textResult.error}`);
      }
    }
  }
}
