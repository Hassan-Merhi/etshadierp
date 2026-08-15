/**
 * Types for the FactoryDispatchBatchDetail page.
 *
 * Extracted from FactoryDispatchBatchDetail.tsx during the Phase 4 god-file split.
 */

export interface BatchDetail {
  batch: {
    id: number;
    batchNumber: string;
    batchDate: string;
    status: string;
    currency: string;
    priceMode: string;
    destination: string | null;
    notes: string | null;
    customerId: number;
    proformaId: number | null;
    finalOrderId: number | null;
  };
  customerName: string | null;
  proforma: { id: number; name: string; status: string } | null;
  proformaLines: { id: number; articleCode: string; productName: string; quantity: number; pricePerBale: string }[];
  rides: {
    id: number;
    rideNumber: number;
    truckPlate: string | null;
    driverName: string | null;
    destination: string | null;
    notes: string | null;
    status: string;
    loadedAt: string | null;
    dispatchedAt: string | null;
    reopenedAt: string | null;
    reopenReason: string | null;
    createdBy: string | null;
    createdAt: string;
    baleCount: number | string;
    totalWeightKg: string;
    totalAmount: string;
  }[];
  articleTotals: {
    articleCode: string;
    productName: string;
    scannedQty: number | string;
    scannedWeightKg: string;
    scannedAmount: string;
  }[];
  finalInvoice: { id: number; invoiceNumber: string | null; grandTotal: string } | null;
}

export interface InvoicePreview {
  batch: any;
  customer: any;
  proforma: any;
  proformaProgress: {
    articleCode: string;
    productName: string;
    proformaQty: number;
    proformaPrice: string;
    scannedQty: number;
    remaining: number;
    totalAmount: string;
  }[];
  rides: {
    id: number;
    rideNumber: number;
    truckPlate: string | null;
    status: string;
    baleCount: number | string;
    totalWeightKg: string;
    totalAmount: string;
  }[];
  articleLines: {
    articleCode: string;
    productName: string;
    qty: number | string;
    totalWeightKg: string;
    totalAmount: string;
  }[];
  totals: { totalBales: number | string; totalWeightKg: string; grandTotal: string };
  loadingRides: number;
  dispatchedRides: number;
  canGenerate: boolean;
  blockers: string[];
}
