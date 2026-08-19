export interface CustomerOption {
  id: number;
  legalName: string;
  code?: string | null;
}

export interface CustomerLoadingProduct {
  id: number;
  code: string;
  articleCode: string | null;
  name: string;
  nameAr: string | null;
  categoryId: number | null;
  categoryName: string | null;
  categoryNameAr: string | null;
  weightPerBaleKg: string | null;
  sellingPrice: string | null;
  productionPrice: string | null;
  active: boolean;
  totalBalesLoaded: number;
  totalKgLoaded: number;
  loadingCount: number;
  lastLoadedAt: string | null;
  loadingStatus: "LOADED" | "NEVER_LOADED";
}

export interface CustomerLoadingResponse {
  customer: { id: number; legalName: string };
  summary: {
    totalProducts: number;
    loadedProducts: number;
    neverLoadedProducts: number;
    productCoveragePct: number;
    totalBalesLoaded: number;
    totalKgLoaded: number;
  };
  products: CustomerLoadingProduct[];
}

export interface HistoryRow {
  sessionId: number;
  invoiceId: number;
  status: string;
  truckNo: string | null;
  driverName: string | null;
  startedAt: string | null;
  completedAt: string | null;
  balesLoaded: number;
  kgLoaded: number;
  lastScanAt: string | null;
}

export interface HistoryResponse {
  customer: { id: number; legalName: string };
  product: { id: number; code: string; articleCode: string | null; name: string };
  history: HistoryRow[];
}

export type LoadingFilter = "ALL" | "LOADED" | "NEVER_LOADED";
export type AvailableZeroFilter = "SHOW_ZERO" | "HIDE_ZERO";
export type AvailableNegativeFilter = "SHOW_NEGATIVE" | "HIDE_NEGATIVE";
export type ColumnKey =
  | "articleCode"
  | "product"
  | "arabicName"
  | "category"
  | "weight"
  | "sellPrice"
  | "availableStock"
  | "status"
  | "totalLoaded"
  | "totalKg"
  | "lastLoaded"
  | "qty";

export const PAGE_SIZE = 75;
export const COLUMN_OPTIONS: Array<{ key: ColumnKey; label: string }> = [
  { key: "articleCode", label: "Article Code" },
  { key: "product", label: "Product" },
  { key: "arabicName", label: "Arabic Name" },
  { key: "category", label: "Category" },
  { key: "weight", label: "Wt/Bale" },
  { key: "sellPrice", label: "Sell Price" },
  { key: "availableStock", label: "Available Stock" },
  { key: "status", label: "Status" },
  { key: "totalLoaded", label: "Total Loaded" },
  { key: "totalKg", label: "Total KG" },
  { key: "lastLoaded", label: "Last Loaded" },
  { key: "qty", label: "Qty" },
];

export async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || "Request failed");
  return payload as T;
}

export function formatNumber(value: number, maximumFractionDigits = 0) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value || 0);
}

export function formatMoney(value: number | string | null) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount);
}

export function formatDate(value: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "2-digit" }).format(date);
}

export function formatDateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
