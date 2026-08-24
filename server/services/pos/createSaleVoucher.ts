import type { DbTransaction } from "../../db";
import { randomUUID } from "node:crypto";
import {
  infrastructurePostingIdentity,
  insertInfrastructureVoucherTx,
} from "../accounting/infrastructureVoucherIdentity";
/**
 * server/services/pos/createSaleVoucher.ts
 *
 * PHASE 19 structural split — moved (unchanged) from server/routes/pos/posSalesRoutes.ts.
 * Inserts the Sales voucher row for a POS sale.
 */

export async function insertSaleVoucher(
  tx: DbTransaction,
  params: {
    companyId: number;
    locationId: any;
    locationName: string;
    voucherNumber: string;
    voucherDate: string;
    notes: any;
    isCreditSale: any;
    customerAccountName: string | undefined;
    grandTotal: number;
    effectiveShiftId: number | null;
    clientSaleId: any;
    currency: any;
    exchangeRate: any;
  }
) {
  const {
    companyId,
    locationId,
    locationName,
    voucherNumber,
    voucherDate,
    notes,
    isCreditSale,
    customerAccountName,
    grandTotal,
    effectiveShiftId,
    clientSaleId,
    currency,
    exchangeRate,
  } = params;

  // Modern clients provide clientSaleId as the durable retry identity. Older
  // callers predate that field and are intentionally non-idempotent, but they
  // still need a valid infrastructure posting source. Give those one-shot
  // requests an opaque identity rather than deriving it from the display
  // voucher number (which intentionally contains timestamp/random data).
  const postingIdentity = clientSaleId
    ? infrastructurePostingIdentity("pos-sale", clientSaleId, "sales-voucher")
    : infrastructurePostingIdentity("pos-sale", `legacy-${randomUUID()}`, "sales-voucher");

  const { voucher: txVoucher } = await insertInfrastructureVoucherTx(
    tx,
    {
      companyId,
      locationId,
      locationName,
      voucherNumber,
      voucherType: "Sales",
      voucherDate,
      description:
        notes ||
        (isCreditSale
          ? `Credit Invoice Sale at ${locationName} - ${customerAccountName}`
          : `POS Sale at ${locationName}`),
      totalAmount: grandTotal.toFixed(2),
      shiftId: effectiveShiftId,
      clientSaleId: clientSaleId || null,
      currency: currency || "USD",
      exchangeRate: exchangeRate || null,
      isCreditSale: !!isCreditSale,
    },
    postingIdentity,
    params
  );

  return txVoucher;
}
