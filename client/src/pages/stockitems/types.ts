/**
 * Types for the StockItems page.
 *
 * Extracted from StockItems.tsx during the Phase 4 god-file split.
 */

export interface Location {
  id: number;
  code: string;
  name: string;
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
  companyId: number;
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

export interface PagedStockItemsResponse {
  data: StockItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
