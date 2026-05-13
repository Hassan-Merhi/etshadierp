/**
 * sendTransferWhatsApp.ts
 * Fire-and-forget helper: build the transfer image and send it to:
 *   1. The globally-configured transfer WA group (Settings → Stock Transfers WA)
 *   2. The destination location's own WA group (if configured)
 */

import { db } from "../db";
import { stockItems, locations } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { generateTransferImageBuffer } from "./generateTransferImage";
import { sendWhatsAppFileToChatId, getTransferWaGroupChatId } from "../services/whatsappService";
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
 *   - The global transfer WA group configured in Settings (if set)
 *   - The destination location's WA group (if set)
 * Designed to be called fire-and-forget inside setImmediate — never throws.
 */
export async function sendTransferWhatsApp(opts: SendTransferWAOptions): Promise<void> {
  const {
    destinationLocationId,
    sourceLocationName,
    destLocationName,
    items,
    voucherNumber,
    voucherDate,
  } = opts;

  // Collect all target chat IDs (deduped)
  const chatIds = new Set<string>();

  // 1. Global transfer WA group from settings
  const globalSetting = await getTransferWaGroupChatId();
  if (globalSetting?.groupChatId) {
    chatIds.add(globalSetting.groupChatId);
  }

  // 2. Destination location's own WA group
  const [destLoc] = await db
    .select({ whatsappGroupChatId: locations.whatsappGroupChatId })
    .from(locations)
    .where(eq(locations.id, destinationLocationId));

  if (destLoc?.whatsappGroupChatId) {
    chatIds.add(destLoc.whatsappGroupChatId);
  }

  if (chatIds.size === 0) {
    console.log(`[TransferWA] No WA groups configured for transfer ${voucherNumber} — skipping`);
    return;
  }

  // Look up stock item names in a single query
  const uniqueIds = [...new Set(items.map((i) => i.stockItemId))];
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
  } catch { /* keep raw string */ }

  // Generate the PNG image once
  const pngBuffer = await generateTransferImageBuffer({
    voucherNumber,
    date: displayDate,
    sourceLocationName,
    destLocationName,
    items: imageItems,
  });

  const safeVoucher = voucherNumber.replace(/[^a-zA-Z0-9_-]/g, "_");
  const fileName = `Transfer_${safeVoucher}.png`;

  const caption = [
    `*Stock Transfer* — ${voucherNumber}`,
    `Date: ${displayDate}`,
    `From: ${sourceLocationName}`,
    `To: ${destLocationName}`,
    `Items: ${items.length}`,
  ].join("\n");

  // Send to all target groups
  for (const chatId of chatIds) {
    const result = await sendWhatsAppFileToChatId(chatId, pngBuffer, fileName, caption, "image/png");
    if (result.success) {
      console.log(`[TransferWA] Sent ${voucherNumber} image to group ${chatId}`);
    } else {
      console.warn(`[TransferWA] Send failed for ${voucherNumber} → ${chatId}: ${result.error}`);
    }
  }
}
