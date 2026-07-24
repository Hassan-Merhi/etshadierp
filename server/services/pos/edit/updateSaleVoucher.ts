/**
 * server/services/pos/edit/updateSaleVoucher.ts
 *
 * PHASE 20 structural split — moved (unchanged) from
 * server/routes/pos/posEditSaleRoutes.ts:
 *   - voucher description/total/location/date update
 *
 * Every message, status code, and query is byte-identical to the original —
 * only the code location changed.
 */
import { vouchers } from "@shared/schema";
import { logger } from "../../../lib/logger";
import { eq } from "drizzle-orm";

/** Updates voucher description, total amount, location, and optionally date. */
export async function updateVoucherRecord(
  tx: any,
  params: {
    voucherId: number;
    description: any;
    grandTotal: number;
    locationChanged: boolean;
    targetLocationId: number;
    oldLocationId: number;
    voucherDate: any;
  }
): Promise<void> {
  const { voucherId, description, grandTotal, locationChanged, targetLocationId, oldLocationId, voucherDate } = params;

  const voucherUpdate: any = {
    description: description || null,
    totalAmount: grandTotal.toString(),
  };
  if (locationChanged) {
    voucherUpdate.locationId = targetLocationId;
    logger.info(`[POS Sales Edit] Updated voucher ${voucherId} location from ${oldLocationId} to ${targetLocationId}`);
  }
  if (voucherDate) {
    voucherUpdate.voucherDate = new Date(voucherDate);
  }
  await tx.update(vouchers).set(voucherUpdate).where(eq(vouchers.id, voucherId));
}
