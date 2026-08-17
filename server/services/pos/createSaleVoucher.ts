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
import { vouchers } from "@shared/schema";

export async function insertSaleVoucher(
  tx: any,
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
    // clientSaleId is the caller's stable retry identity. Do not fall back to
    // voucherNumber: POS display voucher numbers intentionally contain
    // Date.now()/randomUUID and would turn a retry into a new posting key.
    infrastructurePostingIdentity("pos-sale", clientSaleId, "sales-voucher"),
    params
  );

  return txVoucher;
}
