/**
 * sendRevisedTransferWhatsApp.ts
 * Fire-and-forget helper: build the revised transfer image (shows before/change/after)
 * and send it to the same WA groups as the original transfer.
 */

import { db } from "../db";
import { stockItems, locations, companies } from "@shared/schema";
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

  const caption = [
    `*Stock Transfer Revision*`,
    `${displayDate}  •  ${sourceLocationName} → ${destLocationName}`,
    ...imageItems.map((i) => `• ${i.name}: ${i.before} → ${i.after} ${i.uom} (${i.delta >= 0 ? "+" : ""}${i.delta})`),
  ].join("\n");

  // Try to generate PNG; fall back to text if Puppeteer/Chromium is unavailable
  let pngBuffer: Buffer | null = null;
  try {
    console.log(`[RevisedTransferWA] Generating revised PNG for ${voucherNumber}...`);
    pngBuffer = await generateRevisedTransferImageBuffer({
      voucherNumber,
      date: displayDate,
      sourceLocationName,
      destLocationName,
      items: imageItems,
    });
    console.log(`[RevisedTransferWA] PNG generated (${pngBuffer.length} bytes).`);
  } catch (imgErr: any) {
    console.warn(`[RevisedTransferWA] Image generation failed for ${voucherNumber} — falling back to text. Error: ${imgErr?.message}`);
  }

  const safeVoucher = voucherNumber.replace(/[^a-zA-Z0-9_-]/g, "_");
  const fileName = `Revised_Transfer_${safeVoucher}.png`;

  for (const chatId of chatIds) {
    if (pngBuffer) {
      const result = await sendWhatsAppFileToChatIdPos(chatId, pngBuffer, fileName, "", "image/png");
      if (result.success) {
        console.log(`[RevisedTransferWA] Sent ${voucherNumber} revised image to group ${chatId}`);
      } else {
        console.warn(`[RevisedTransferWA] Image send failed for ${voucherNumber} → ${chatId}: ${result.error}`);
      }
    }
    // Always send the text message (in addition to the image, or as the only message if image failed)
    const textResult = await sendWhatsAppTextToChatIdPos(chatId, caption);
    if (textResult.success) {
      console.log(`[RevisedTransferWA] Text message sent for ${voucherNumber} → ${chatId}`);
    } else {
      console.warn(`[RevisedTransferWA] Text send failed for ${voucherNumber} → ${chatId}: ${textResult.error}`);
    }
  }
}
