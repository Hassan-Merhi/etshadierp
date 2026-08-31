import type { Location } from "../pos-components/posTypes";

export interface GoldenCoastPhase6SaleRequest {
  locationId: number;
  saleDate: string;
  customerName: string;
  clientRequestId: string;
  notes?: string;
  lines: Array<{
    stockItemId: number;
    qty: string;
    unitPriceUsd: string;
    description?: string;
  }>;
}

/**
 * Converts the shared POS sale model into the strict Phase 6 contract.
 * Payment-account fields are intentionally not included: Phase 6 owns the
 * canonical GC Sales Cash posting and rejects sale-side overrides.
 */
export function buildGoldenCoastPhase6SaleRequest(
  saleData: any,
  clientRequestId: string
): GoldenCoastPhase6SaleRequest {
  return {
    locationId: Number(saleData.locationId),
    saleDate: saleData.voucherDate,
    customerName: (saleData.notes || "").trim() || "Walk-in Customer",
    clientRequestId,
    notes: saleData.notes || undefined,
    lines: saleData.items.map((item: any) => ({
      stockItemId: Number(item.stockItemId),
      qty: String(item.quantity),
      unitPriceUsd: Number(item.rate).toFixed(2),
      description: item.stockItemName || undefined,
    })),
  };
}

/** Stable client-side key for the financial payload, excluding request identity. */
export function goldenCoastPhase6SaleFingerprint(request: GoldenCoastPhase6SaleRequest): string {
  const { clientRequestId: _clientRequestId, ...financialRequest } = request;
  return JSON.stringify(financialRequest);
}

/**
 * Adapts Phase 6's revenue/COGS/deduction response back to the shape consumed
 * by the existing receipt, print, WhatsApp, and cache-invalidation flows.
 */
export function normalizeGoldenCoastPhase6Sale(
  raw: any,
  saleData: any,
  activeLocation: Location | null
) {
  const revenuePosting = (raw.postings || []).find((posting: any) => posting.role === "revenue");
  const revenueVoucher = revenuePosting?.voucher;
  if (!revenueVoucher?.id) {
    throw new Error("Golden Coast sale was posted without a revenue voucher");
  }

  const phase6Lines = Array.isArray(raw.lines) ? raw.lines : [];
  const items = saleData.items.map((item: any) => {
    const line = phase6Lines.find(
      (candidate: any) => Number(candidate.stockItemId) === Number(item.stockItemId)
    );
    const quantity = String(line?.qty ?? item.quantity);
    const rate = String(line?.unitPriceUsd ?? Number(item.rate).toFixed(2));
    const amount = line?.revenueUsd ?? (Number(quantity) * Number(rate)).toFixed(2);
    return {
      stockItemId: item.stockItemId,
      stockItemName: item.stockItemName || `Stock item #${item.stockItemId}`,
      stockItemCode: item.stockItemCode || "",
      quantity,
      rate,
      rateUSD: rate,
      sellingPrice: rate,
      configuredPrice: item.configuredPrice,
      amount: String(amount),
    };
  });
  const localTotal = items.reduce((sum: number, item: any) => sum + Number(item.amount || 0), 0);

  return {
    voucher: {
      ...revenueVoucher,
      description: revenueVoucher.description ?? saleData.notes,
    },
    location: activeLocation,
    items,
    grandTotal: Number(raw.revenueUsd ?? localTotal).toFixed(2),
    voucherNumber: revenueVoucher.voucherNumber,
    saleDate: saleData.voucherDate,
    isCreditSale: false,
    customer: {
      id: null,
      code: null,
      name: (saleData.notes || "").trim() || "Walk-in Customer",
    },
    phase6: {
      replayed: raw.replayed === true,
      cogsUsd: raw.cogsUsd,
      grossProfitUsd: raw.grossProfitUsd,
      specialLocationDeductionUsd: raw.specialLocationDeductionUsd,
    },
  };
}