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

/** One selected product plus the quantity and price the user drafted for it. */
export interface SelectedLine {
  product: CustomerLoadingProduct;
  quantity: number;
  rawPrice: string;
  pricePerBale: number;
  priceValid: boolean;
  totalKg: number;
  lineTotal: number;
}

export interface SelectedTotals {
  lines: number;
  quantity: number;
  kg: number;
  amount: number;
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
