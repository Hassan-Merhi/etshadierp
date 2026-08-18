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
    // A supplied clientSaleId remains the stable cross-retry identity. Legacy
    // callers that do not send one still need a non-empty posting source; their
    // generated voucherNumber is unique for this request and does not pretend to
    // provide retry idempotency that the caller did not request.
    infrastructurePostingIdentity("pos-sale", clientSaleId || voucherNumber, "sales-voucher"),
    params
  );

  return txVoucher;
}