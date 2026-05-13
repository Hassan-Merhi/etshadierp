/**
 * sendTransferWhatsApp.ts
 * Fire-and-forget helper: build the transfer image and send it to the
 * destination location's WhatsApp group chat.
 */

import { db } from "../db";
import { stockItems, locations } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { generateTransferImageBuffer } from "./generateTransferImage";
import { sendWhatsAppFileToChatId } from "../services/whatsappService";
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
 * Generate and send the stock transfer image to the destination
 * location's WhatsApp group. Designed to be called fire-and-forget
 * inside setImmediate — never throws to the caller.
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

  // Look up destination location's WA group chat ID
  const [destLoc] = await db
    .select({ whatsappGroupChatId: locations.whatsappGroupChatId })
    .from(locations)
    .where(eq(locations.id, destinationLocationId));

  if (!destLoc?.whatsappGroupChatId) {
    console.log(`[TransferWA] No WA group for destination location ${destinationLocationId} — skipping`);
    return;
  }

  const chatId = destLoc.whatsappGroupChatId;

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

  // Generate the PNG image
  const pngBuffer = await generateTransferImageBuffer({
    voucherNumber,
    date: displayDate,
    sourceLocationName,
    destLocationName,
    items: imageItems,
  });

  // Send to the destination location's WA group
  const safeVoucher = voucherNumber.replace(/[^a-zA-Z0-9_-]/g, "_");
  const fileName = `Transfer_${safeVoucher}.png`;

  const caption = [
    `*Stock Transfer* — ${voucherNumber}`,
    `Date: ${displayDate}`,
    `From: ${sourceLocationName}`,
    `To: ${destLocationName}`,
    `Items: ${items.length}`,
  ].join("\n");

  const result = await sendWhatsAppFileToChatId(chatId, pngBuffer, fileName, caption, "image/png");

  if (result.success) {
    console.log(`[TransferWA] Sent ${voucherNumber} image to group ${chatId} (${destLocationName})`);
  } else {
    console.warn(`[TransferWA] Send failed for ${voucherNumber}: ${result.error}`);
  }
}
