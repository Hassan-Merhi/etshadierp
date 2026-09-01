/**
 * Types for the POSPriceList page.
 *
 * Extracted from POSPriceList.tsx during the Phase 4 god-file split.
 */

export interface Location {
  id: number;
  code: string;
  name: string;
  active?: boolean;
}

export interface PriceListItem {
  stockItemId: number;
  code: string;
  name: string;
  stockGroupName: string;
  baseSellingPrice: string | null;
  hasCustomPrice: boolean;
  sellingPrice: string | null;
  quantity: string;
  costPrice?: string | null;
  offloadingCost?: string | null;
}

export interface MasterItem {
  stockItemId: number;
  code: string;
  name: string;
  stockGroupName: string;
  baseSellingPrice: string | null;
  masterPrices: Record<number, string>;
  costPrice?: string | null;
  offloadingCost?: string | null;
}

export interface MasterPriceListResponse {
  masters: { id: number; name: string }[];
  items: MasterItem[];
}

export interface POSPriceListProps {
  posUser?: unknown;
}
