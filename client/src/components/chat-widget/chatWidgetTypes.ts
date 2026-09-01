export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  message: string;
  createdAt: string;
}

export interface ChatStatus {
  enabled: boolean;
  hasApiKey: boolean;
  isAdminOrOwner: boolean;
}

export interface StockCandidate {
  id: number;
  name: string;
  code?: string;
}

export interface LocationCandidate {
  id: number;
  name: string;
}

export interface StockAdjustmentDraft {
  date: string;
  locationId: number;
  locationName: string;
  locationCandidates?: LocationCandidate[];
  notes: string;
  optional?: boolean;
  items: {
    type: "PRODUCE" | "CONSUME";
    stockItemId: number;
    stockItemName: string;
    quantity: number;
    rate: number;
    candidates?: StockCandidate[];
    currentStock?: number;
    projectedStock?: number;
  }[];
}

export interface VoucherSearchResult {
  id: number;
  voucherNumber: string;
  voucherType: string;
  voucherDate: string;
  description: string | null;
  totalAmount: string;
  optional: boolean;
}

export interface StockItemDraft {
  name: string;
  code: string;
  uom: string;
  stockGroupId: number | null;
  stockGroupName: string;
  groupCandidates: { id: number; name: string }[];
}

export interface PriceUpdateDraft {
  stockItemId: number;
  stockItemName: string;
  stockItemCode: string;
  locationId: number | null;
  locationName: string;
  newPrice: number;
  followerCount: number;
  itemCandidates: { id: number; name: string; code: string }[];
  locationCandidates: { id: number; name: string }[];
  allLocations: { id: number; name: string }[];
}

export interface AccountTransaction {
  voucherId: number;
  voucherNumber: string;
  voucherType: string;
  voucherDate: string;
  description: string | null;
  narration: string | null;
  debitAmount: string;
  creditAmount: string;
  totalAmount?: string;
  balanceAfter?: number;
}

export interface AccountQueryResult {
  queryType: "balance" | "transactions" | "balance_history";
  accountId: number;
  accountName: string;
  balance?: number;
  searchTerm?: string;
  searchAmount?: number;
  targetBalance?: number;
  transactions?: AccountTransaction[];
  matches?: (AccountTransaction & { balanceAfter: number })[];
}

export interface PODraftLine {
  rawName: string;
  rawCode: string;
  stockItemId: number | null;
  stockItemName: string;
  qty: string;
  rate: string;
  lineTotal: string;
  itemName?: string;
}

export interface POImportDraft {
  poNumber: string;
  containerNumber: string;
  importDate: string;
  currency: string;
  supplierId: number | null;
  supplierName: string;
  supplierRaw: string;
  lines: PODraftLine[];
  charges: {
    freight: number;
    surcharge: number;
    fumigation: number;
    documentCharges: number;
    discount: number;
    otherCharges: number;
  };
  itemsTotal: string;
  grandTotal: string;
  unresolvedSupplier: boolean;
  unresolvedItems: { index: number; rawName: string; rawCode: string }[];
  allSuppliers: { id: number; name: string; code: string }[];
  allStockItems: { id: number; name: string; code: string }[];
}

export interface POImportResult {
  success: boolean;
  poId: number;
  poNumber: string;
  containerNumber: string;
  containerId: number;
  supplierId: number;
  lineCount: number;
  itemsTotal: string;
  grandTotal: string;
  crossCompany: boolean;
  availableProformas: { id: number; reference: string }[];
}

export interface VerifyContainerDraft {
  containerNumber: string;
  containerId: number;
  supplierId: number;
  supplierName: string;
  proformas: { id: number; reference: string }[];
}

export interface DataQueryResult {
  queryType: string;
  title: string;
  subtitle?: string;
  stats?: Array<{
    label: string;
    value: string;
    subtext?: string;
    highlight?: "positive" | "negative" | "muted" | "neutral";
  }>;
  table?: {
    headers: string[];
    rows: string[][];
  };
  summary?: string;
  noData?: boolean;
}

export interface FilePatchDraft {
  filePath: string;
  description: string;
  originalContent: string;
  newContent: string;
}

export interface PushResult {
  success: boolean;
  commitHash?: string;
  branch?: string;
  error?: string;
}

export interface ChatResponse {
  response: string;
  suggestions: string[];
  provider?: string;
  voucherDraft?: VoucherDraft | null;
  stockAdjustmentDraft?: StockAdjustmentDraft | null;
  stockTransferDraft?: StockTransferDraft | null;
  /** Multiple per-source drafts for a single "target quantity across several source
   * locations" request (e.g. "410 bales to Kolwezi from Hadi 1,2,3,4"). Only set
   * when more than one source location ended up with eligible items. */
  stockTransferDrafts?: StockTransferDraft[] | null;
  voucherSearchResults?: VoucherSearchResult[] | null;
  stockItemDraft?: StockItemDraft | null;
  priceUpdateDraft?: PriceUpdateDraft | null;
  accountQueryResult?: AccountQueryResult | null;
  verifyContainerDraft?: VerifyContainerDraft | null;
  dataQueryResult?: DataQueryResult | null;
  filePatchDrafts?: FilePatchDraft[] | null;
  readFiles?: string[] | null;
}

export interface VoucherDraft {
  type: "Payment" | "Receipt" | "Journal";
  date: string;
  description: string;
  optional?: boolean;
  entries: {
    accountId: number;
    accountName: string;
    debit: number;
    credit: number;
    balanceBefore?: number;
  }[];
}

export interface StockTransferDraft {
  date: string;
  sourceLocationId: number;
  sourceLocationName: string;
  destinationLocationId: number;
  destinationLocationName: string;
  notes?: string;
  /** True for AI-suggested drafts: created as an optional transfer (no inventory movement) until approved. */
  optional?: boolean;
  analysisSummary?: string;
  analysisDateRange?: { from: string; to: string };
  aggressiveness?: "conservative" | "normal" | "aggressive";
  comparedLocations?: string;
  oldTransferSummary?: string;
  items: {
    stockItemId: number;
    stockItemName: string;
    quantity: number;
    currentStock?: number;
    candidates?: { id: number; name: string; code?: string }[];
    stockItemCode?: string;
    sourceQty?: number;
    destinationQty?: number;
    sourceSalesQty?: number;
    destinationSalesQty?: number;
    sourceSalesRate?: number;
    destinationSalesRate?: number;
    otwQty?: number | null;
    otwDetails?: {
      containerNumber: string;
      quantity: number;
      eta?: string | null;
      trackingStatus?: string | null;
      currentLocation?: string | null;
      shopName?: string | null;
      supplierName?: string | null;
      importDate?: string | null;
      matchType?: "direct" | "unknown" | "other";
    }[];
    otwSummary?: string;
    suggestedQty?: number;
    reason?: string;
    confidence?: number;
    oldTransferSummary?: string;
    previousTransferQty?: number;
    previousTransferCount?: number;
    lastTransferDate?: string;
  }[];
  locationCandidates?: { id: number; name: string }[];
}

export interface AlertDigest {
  lowStock: { id: number; name: string; code: string; qty: number; reorderLevel: number }[];
  openPOs: { id: number; poNumber: string }[];
  overdueCustomers: { customerId: number; name: string; balance: number }[];
  pendingPayrolls: { id: number; periodStart: string; periodEnd: string; status: string }[];
}
