/**
 * sendTransferWhatsApp.ts
 * Fire-and-forget helper: build the transfer image and send it to:
 *   1. The destination company's configured transfer WA group (Settings → Transfers WA)
 *   2. The destination location's own WA group (if configured)
 */

import { db } from "../db";
import { stockItems, locations, companies } from "@shared/schema";
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
 * Generate and send the stock transfer image.
 * Sends to:
 *   - The destination company's configured transfer WA group (if set)
 *   - The destination location's own WA group (if set)
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

  console.log(`[TransferWA] Starting for ${voucherNumber} → destLocId=${destinationLocationId}, items=${items.length}`);

  if (!items || items.length === 0) {
    console.warn(`[TransferWA] No items provided for ${voucherNumber} — skipping`);
    return;
  }

  // Collect all target chat IDs (deduped)
  const chatIds = new Set<string>();

  // Look up destination location
  const [destLoc] = await db
    .select({
      companyId:             locations.companyId,
      transferWaGroupChatId: locations.transferWaGroupChatId,
    })
    .from(locations)
    .where(eq(locations.id, destinationLocationId));

  console.log(`[TransferWA] destLoc=${JSON.stringify(destLoc)}`);

  // 1. Per-location transfer WA group (takes priority — location-specific group)
  if (destLoc?.transferWaGroupChatId) {
    console.log(`[TransferWA] location.transferWaGroupChatId=${destLoc.transferWaGroupChatId}`);
    chatIds.add(destLoc.transferWaGroupChatId);
  } else if (destLoc?.companyId) {
    // 2. Fall back to per-company transfer WA group from Settings
    const [company] = await db
      .select({ transferWaGroupChatId: companies.transferWaGroupChatId })
      .from(companies)
      .where(eq(companies.id, destLoc.companyId));
    console.log(`[TransferWA] company.transferWaGroupChatId=${company?.transferWaGroupChatId}`);
    if (company?.transferWaGroupChatId) {
      chatIds.add(company.transferWaGroupChatId);
    }
  }

  if (chatIds.size === 0) {
    console.log(`[TransferWA] No WA groups configured for transfer ${voucherNumber} — skipping`);
    return;
  }

  console.log(`[TransferWA] Sending to ${chatIds.size} group(s): ${[...chatIds].join(", ")}`);

  // Look up stock item names in a single query (guard against empty array)
  const uniqueIds = [...new Set(items.map((i) => i.stockItemId).filter((id) => id > 0))];
  if (uniqueIds.length === 0) {
    console.warn(`[TransferWA] No valid stockItemIds in items for ${voucherNumber} — skipping`);
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
  } catch { /* keep raw string */ }

  console.log(`[TransferWA] Generating PNG for ${voucherNumber}...`);

  // Generate the PNG image once
  const pngBuffer = await generateTransferImageBuffer({
    voucherNumber,
    date: displayDate,
    sourceLocationName,
    destLocationName,
    items: imageItems,
  });

  console.log(`[TransferWA] PNG generated (${pngBuffer.length} bytes). Sending...`);

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
