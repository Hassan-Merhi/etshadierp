import type { FactoryContainer } from "@shared/schema";

export interface ContainerWithSupplier extends FactoryContainer {
  supplierName?: string | null;
}

export const OTW_NOTES_KEY = "factory-otw-notes";

export const STATUS_ACTIVE = new Set(["PENDING", "IN_TRANSIT", "ARRIVED", "PARTIALLY_RECEIVED"]);

export const CCY_SYMBOLS: Record<string, string> = {
  USD: "$", EUR: "€", GBP: "£", AUD: "A$", CAD: "C$",
  CHF: "CHF", JPY: "¥", CNY: "¥", AED: "AED", SAR: "SAR", LBP: "LL",
};

export const OTW_STATUS_LABEL: Record<string, string> = {
  PENDING:    "Pending",
  IN_TRANSIT: "In Transit",
  ARRIVED:    "Arrived",
};

export const CONTAINER_STATUS_LABELS: Record<string, string> = {
  PENDING:            "Pending",
  IN_TRANSIT:         "In Transit",
  ARRIVED:            "Arrived",
  OFFLOADED:          "Offloaded",
  PARTIALLY_RECEIVED: "Partially Offloaded",
  RECEIVED:           "Received",
  AVAILABLE:          "Available",
  CLOSED:             "Closed",
  COMPLETED:          "Completed",
};

export function getContainerStatusLabel(status: string): string {
  return CONTAINER_STATUS_LABELS[status] ?? status;
}

export function otwNum(v: string | null | undefined): number {
  if (!v) return 0;
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

export function otwCcySymbol(code: string | null | undefined): string {
  if (!code) return "$";
  return CCY_SYMBOLS[code] || code;
}

export function otwFmtCcy(symbol: string, amount: number): string {
  return `${symbol} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function otwAddToCurrency(map: Record<string, number>, ccy: string, amount: number) {
  if (amount > 0 && ccy) map[ccy] = (map[ccy] || 0) + amount;
}

export function otwContainerByCurrency(c: ContainerWithSupplier): Record<string, number> {
  const amounts: Record<string, number> = {};
  const containerCcy = (c as any).currencyCode || "USD";
  const goodsValue = otwNum((c as any).finalPayableAmount) > 0
    ? otwNum((c as any).finalPayableAmount)
    : otwNum(c.ratePerKg) * otwNum(c.totalKg);
  otwAddToCurrency(amounts, containerCcy, goodsValue);
  otwAddToCurrency(amounts, (c as any).freightCurrencyCode || containerCcy, otwNum((c as any).freight));
  otwAddToCurrency(amounts, (c as any).commissionCurrencyCode || "USD", otwNum((c as any).commissionAmount));
  otwAddToCurrency(amounts, containerCcy, otwNum((c as any).otherCharges));
  otwAddToCurrency(amounts, containerCcy, otwNum((c as any).additionalChargesSum));
  otwAddToCurrency(amounts, containerCcy, otwNum((c as any).preRegisteredChargesSum));
  return amounts;
}

export function otwMergeCurrencyMaps(target: Record<string, number>, source: Record<string, number>) {
  for (const [ccy, amt] of Object.entries(source)) {
    target[ccy] = (target[ccy] || 0) + amt;
  }
}
