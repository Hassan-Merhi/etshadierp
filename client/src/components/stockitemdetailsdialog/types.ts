/**
 * Types for the StockItemDetailsDialog page.
 *
 * Extracted from StockItemDetailsDialog.tsx during the Phase 4 god-file split.
 */

export interface StockItemDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stockItemId: number;
  stockItemName: string;
}

export interface StockItem {
  id: number;
  code: string;
  name: string;
  barcode: string | null;
  uom: string;
  stockGroupId: number | null;
  gradeId: number | null;
  categoryId: number | null;
  sellingPrice: string;
  active: boolean;
}

export interface StockGroup {
  id: number;
  code: string;
  name: string;
}

export interface StockGrade {
  id: number;
  name: string;
  active: boolean;
}

export interface StockCategory {
  id: number;
  name: string;
  active: boolean;
}

export interface Transaction {
  id: number;
  type: "transfer" | "adjustment";
  voucherId: number;
  voucherNumber: string;
  voucherDate: string;
  quantity: string;
  rate: string;
  totalAmount: string;
  stockItemId: number;
  notes: string | null;
}

export interface CodeAlias {
  id: number;
  stockItemId: number;
  companyId: number;
  aliasCode: string;
  description: string | null;
  createdAt: string;
}
