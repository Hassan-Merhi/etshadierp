/**
 * sendTransferWhatsApp.ts
 * Fire-and-forget helper: build the transfer image and send it to:
 *   1. The destination company's configured transfer WA group (Settings → Transfers WA)
 *   2. The destination location's own WA group (if configured)
 */

import { db } from "../db";
import { logger } from "../lib/logger";
import { stockItems, locations, companies } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { generateTransferImageBuffer } from "./generateTransferImage";
import { sendWhatsAppFileToChatIdPos, sendWhatsAppTextToChatIdPos } from "../services/whatsappService";
import { format } from "date-fns";

export interface TransferWAItem {
  stockItemId: number;
  quantity: number;
}

export interface SendTransferWAOptions {
  destinationLocationId: number;
  sourceLocationName: string;
  destLocationName: string;
  items: TransferWAItem[];
  voucherNumber: string;
  voucherDate: string;
}

/**
 * Generate and send the stock transfer image.
 * Sends to:
 *   - The destination company's configured transfer WA group (if set)
 *   - The destination location's own WA group (if set)
 * Designed to be called fire-and-forget inside setImmediate — never throws.
 */
export async function sendTransferWhatsApp(opts: SendTransferWAOptions): Promise<void> {
  const { destinationLocationId, sourceLocationName, destLocationName, items, voucherNumber, voucherDate } = opts;

  logger.info(`[TransferWA] Starting for ${voucherNumber} → destLocId=${destinationLocationId}, items=${items.length}`);

  if (!items || items.length === 0) {
    logger.warn(`[TransferWA] No items provided for ${voucherNumber} — skipping`);
    return;
  }

  // Collect all target chat IDs (deduped)
  const chatIds = new Set<string>();

  // Look up destination location
  const [destLoc] = await db
    .select({
      companyId: locations.companyId,
      transferWaGroupChatId: locations.transferWaGroupChatId,
    })
    .from(locations)
    .where(eq(locations.id, destinationLocationId));

  logger.info(`[TransferWA] destLoc=${JSON.stringify(destLoc)}`);

  // 1. Per-location transfer WA group (takes priority — location-specific group)
  if (destLoc?.transferWaGroupChatId) {
    logger.info(`[TransferWA] location.transferWaGroupChatId=${destLoc.transferWaGroupChatId}`);
    chatIds.add(destLoc.transferWaGroupChatId);
  } else if (destLoc?.companyId) {
    // 2. Fall back to per-company transfer WA group from Settings
    const [company] = await db
      .select({ transferWaGroupChatId: companies.transferWaGroupChatId })
      .from(companies)
      .where(eq(companies.id, destLoc.companyId));
    logger.info(`[TransferWA] company.transferWaGroupChatId=${company?.transferWaGroupChatId}`);
    if (company?.transferWaGroupChatId) {
      chatIds.add(company.transferWaGroupChatId);
    }
  }

  if (chatIds.size === 0) {
    logger.info(`[TransferWA] No WA groups configured for transfer ${voucherNumber} — skipping`);
    return;
  }

  logger.info(`[TransferWA] Sending to ${chatIds.size} group(s): ${[...chatIds].join(", ")}`);

  // Look up stock item names in a single query (guard against empty array)
  const uniqueIds = [...new Set(items.map((i) => i.stockItemId).filter((id) => id > 0))];
  if (uniqueIds.length === 0) {
    logger.warn(`[TransferWA] No valid stockItemIds in items for ${voucherNumber} — skipping`);
    return;
  }

  const itemRows = await db
    .select({ id: stockItems.id, name: stockItems.name, uom: stockItems.uom })
    .from(stockItems)
    .where(inArray(stockItems.id, uniqueIds));

  const itemMap = new Map(itemRows.map((r) => [r.id, r]));

  const imageItems = items.map((i) => {
    const si = itemMap.get(i.stockItemId);
    return {
      name: si?.name ?? `Item #${i.stockItemId}`,
      quantity: i.quantity,
      uom: si?.uom ?? "",
    };
  });

  // Format date for display
  let displayDate = voucherDate;
  try {
    displayDate = format(new Date(voucherDate), "dd MMM yyyy");
  } catch {
    /* keep raw string */
  }

  const caption = [
    `*Stock Transfer*`,
    `${displayDate}  •  ${sourceLocationName} → ${destLocationName}`,
    `${items.length} item${items.length !== 1 ? "s" : ""}`,
    ...imageItems.map((i) => `• ${i.name}: ${i.quantity} ${i.uom}`),
  ].join("\n");

  // Try to generate PNG; fall back to text if Puppeteer/Chromium is unavailable
  let pngBuffer: Buffer | null = null;
  try {
    logger.info(`[TransferWA] Generating PNG for ${voucherNumber}...`);
    pngBuffer = await generateTransferImageBuffer({
      voucherNumber,
      date: displayDate,
      sourceLocationName,
      destLocationName,
      items: imageItems,
    });
    logger.info(`[TransferWA] PNG generated (${pngBuffer.length} bytes).`);
  } catch (imgErr: any) {
    logger.warn(
      `[TransferWA] Image generation failed for ${voucherNumber} — falling back to text. Error: ${imgErr?.message}`
    );
  }

  const safeVoucher = voucherNumber.replace(/[^a-zA-Z0-9_-]/g, "_");
  const fileName = `Transfer_${safeVoucher}.png`;

  // Send to all target groups
  for (const chatId of chatIds) {
    if (pngBuffer) {
      const result = await sendWhatsAppFileToChatIdPos(chatId, pngBuffer, fileName, "", "image/png");
      if (result.success) {
        logger.info(`[TransferWA] Sent ${voucherNumber} image to group ${chatId}`);
      } else {
        logger.warn(
          `[TransferWA] Image send failed for ${voucherNumber} → ${chatId}: ${result.error} — trying text fallback`
        );
        const textResult = await sendWhatsAppTextToChatIdPos(chatId, caption);
        if (textResult.success) {
          logger.info(`[TransferWA] Text fallback sent for ${voucherNumber} → ${chatId}`);
        } else {
          logger.warn(`[TransferWA] Text fallback also failed for ${voucherNumber} → ${chatId}: ${textResult.error}`);
        }
      }
    } else {
      const textResult = await sendWhatsAppTextToChatIdPos(chatId, caption);
      if (textResult.success) {
        logger.info(`[TransferWA] Text message sent for ${voucherNumber} → ${chatId}`);
      } else {
        logger.warn(`[TransferWA] Text send failed for ${voucherNumber} → ${chatId}: ${textResult.error}`);
      }
    }
  }
}
