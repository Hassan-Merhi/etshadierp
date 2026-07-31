/**
 * Types for the FactoryInvoiceLoadingScan page.
 *
 * Extracted from FactoryInvoiceLoadingScan.tsx during the Phase 4 god-file split.
 */

export interface InvoiceSummary {
  id: number;
  customerId: number;
  invoiceNumber: string | null;
  orderDate: string;
  status: string;
  totalQtyBales: number;
  grandTotal: string;
  containerNumber: string | null;
  customerName: string | null;
  customerCode: string | null;
}

export interface LineSummary {
  lineId: number;
  articleCode: string;
  productName: string;
  invoiceQty: number;
  invoiceWeight: number;
  alreadyLoaded: number;
  currentSessionLoaded: number;
  remaining: number;
  pricePerBale: string;
}

export interface SessionSummary {
  id: number;
  status: string;
  truckNo: string | null;
  driverName: string | null;
  notes: string | null;
  startedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  createdByName: string | null;
  totalBales: number;
}

export interface InvoiceBale {
  baleId: number;
  baleReference: string;
  articleCode: string | null;
  productName: string | null;
  weightKg: string;
  loaded: boolean;
  loadedSessionId: number | null;
  loadedAt: string | null;
}

export interface CurrentSessionBale {
  id: number;
  sessionId: number;
  baleId: number;
  baleReference: string;
  articleCode: string | null;
  productName: string | null;
  weightKg: string;
  scannedAt: string;
  scannedByName: string | null;
}

export interface LoadingSummaryResponse {
  invoice: InvoiceSummary;
  lines: LineSummary[];
  totals: { invoiceBales: number; alreadyLoaded: number; remaining: number };
  sessions: SessionSummary[];
  invoiceBales: InvoiceBale[];
  currentSessionBales: CurrentSessionBale[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────
