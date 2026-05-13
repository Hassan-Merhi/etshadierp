/**
 * sendRevisedTransferWhatsApp.ts
 * Fire-and-forget helper: build the revised transfer image (shows before/change/after)
 * and send it to the same WA groups as the original transfer.
 */

import { db } from "../db";
import { stockItems, locations, companies } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { generateRevisedTransferImageBuffer } from "./generateTransferImage";
import { sendWhatsAppFileToChatId } from "../services/whatsappService";
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
 * Sends to the SOURCE location's WA group (the POS user who submitted the revision).
 * Designed to be called fire-and-forget — never throws.
 */
export async function sendRevisedTransferWhatsApp(opts: SendRevisedTransferWAOptions): Promise<void> {
  const { sourceLocationId, sourceLocationName, destLocationName, items, voucherNumber, voucherDate } = opts;

  console.log(`[RevisedTransferWA] Starting for ${voucherNumber} → srcLocId=${sourceLocationId}, items=${items.length}`);

  if (!items || items.length === 0) {
    console.warn(`[RevisedTransferWA] No items for ${voucherNumber} — skipping`);
    return;
  }

  // Send to the SOURCE location's WA group (the person revising the transfer)
  const chatIds = new Set<string>();

  const [srcLoc] = await db
    .select({ companyId: locations.companyId, transferWaGroupChatId: locations.transferWaGroupChatId })
    .from(locations)
    .where(eq(locations.id, sourceLocationId));

  if (srcLoc?.transferWaGroupChatId) {
    chatIds.add(srcLoc.transferWaGroupChatId);
  } else if (srcLoc?.companyId) {
    const [company] = await db
      .select({ transferWaGroupChatId: companies.transferWaGroupChatId })
      .from(companies)
      .where(eq(companies.id, srcLoc.companyId));
    if (company?.transferWaGroupChatId) chatIds.add(company.transferWaGroupChatId);
  }

  if (chatIds.size === 0) {
    console.log(`[RevisedTransferWA] No WA groups configured for ${voucherNumber} — skipping`);
    return;
  }

  // Look up stock item names
  const uniqueIds = [...new Set(items.map((i) => i.stockItemId).filter((id) => id > 0))];
  const itemRows = uniqueIds.length > 0
    ? await db.select({ id: stockItems.id, name: stockItems.name, uom: stockItems.uom }).from(stockItems).where(inArray(stockItems.id, uniqueIds))
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
  try { displayDate = format(new Date(voucherDate), "dd MMM yyyy"); } catch { /* keep raw */ }

  console.log(`[RevisedTransferWA] Generating revised PNG for ${voucherNumber}...`);

  const pngBuffer = await generateRevisedTransferImageBuffer({
    voucherNumber,
    date: displayDate,
    sourceLocationName,
    destLocationName,
    items: imageItems,
  });

  console.log(`[RevisedTransferWA] PNG generated (${pngBuffer.length} bytes). Sending...`);

  const safeVoucher = voucherNumber.replace(/[^a-zA-Z0-9_-]/g, "_");
  const fileName = `Revised_Transfer_${safeVoucher}.png`;

  for (const chatId of chatIds) {
    const result = await sendWhatsAppFileToChatId(chatId, pngBuffer, fileName, "", "image/png");
    if (result.success) {
      console.log(`[RevisedTransferWA] Sent ${voucherNumber} revised image to group ${chatId}`);
    } else {
      console.warn(`[RevisedTransferWA] Send failed for ${voucherNumber} → ${chatId}: ${result.error}`);
    }
  }
}
