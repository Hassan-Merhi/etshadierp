import type { BaleLabelPrint, BaleProduct } from "@shared/schema";

export type SearchMode = "reference" | "article";

export interface ArticleLookupResult {
  product: BaleProduct | null;
  labelPrints: BaleLabelPrint[];
}

export interface ReferenceLookupResult {
  labelPrint: BaleLabelPrint | null;
  product: BaleProduct | null;
  baleInfo: {
    id: number;
    baleCode: string;
    status: string;
    weightKg: string;
    costPerKg: string;
    totalCost: string;
    productName: string | null;
    grade: string | null;
    stockEntryDate: string | null;
    pressedAt: string | null;
    finalizedAt: string | null;
    workerName: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    deletedAt: string | null;
  } | null;
  locationInfo: { id: number; name: string; city: string | null; state: string | null } | null;
  pressingBatch: {
    id: number;
    status: string;
    expectedCount: number;
    finalizedAt: string | null;
    notes: string | null;
  } | null;
  mixBatch: {
    id: number;
    batchCode: string;
    batchNumber: string | null;
    name: string | null;
    batchDate: string | null;
    totalWeightKg: string;
    costPerKg: string;
    status: string;
    operatorUser: string | null;
  } | null;
  containers_used: Array<{
    id: number;
    containerNumber: string;
    origin: string | null;
    arrivalDate: string | null;
    status: string;
    supplierName: string | null;
    weightKgUsed: string | null;
    currencyCode: string;
    ratePerKg: string | null;
  }>;
  loadedOnOrder: {
    orderId: number;
    invoiceNumber: string | null;
    orderDate: string;
    status: string;
    containerNumber: string | null;
    shippingCompany: string | null;
    containerNotes: string | null;
    loadingStartedAt: string | null;
    loadingFinalizedAt: string | null;
    grandTotal: string;
    totalQtyBales: number;
    customerName: string | null;
    priceUsed: string;
    baleWeight: string;
    scannedBy: string | null;
  } | null;
  auditHistory: Array<{
    id: number;
    action: string;
    username: string;
    changes: Record<string, { old: unknown; new: unknown }> | null;
    createdAt: string;
  }>;
}
