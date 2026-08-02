/**
 * Types for the StockTransferOrder page.
 *
 * Extracted from StockTransferOrder.tsx during the Phase 4 god-file split.
 */

export interface LocationData {
  quantity: number;
  rate: number;
  value: number;
}

export interface StockItemData {
  id: number;
  code: string;
  name: string;
  uom: string;
  locationData: Record<number, LocationData>;
}

export interface StockGroupData {
  id: number;
  code: string;
  name: string;
  locationData: Record<number, LocationData>;
  items: StockItemData[];
}

export interface LocationSummaryResponse {
  stockGroups: StockGroupData[];
  grandTotals: Record<number, LocationData>;
  asOfDate: string;
}

export interface Location {
  id: number;
  name: string;
  code: string;
}

export interface OrderItem {
  stockItemId: number;
  stockItemName: string;
  stockItemCode: string;
  uom: string;
  sourceLocationId: number;
  sourceLocationName: string;
  quantity: number;
  availableQty: number;
  rate: number;
}

export interface QuantityPickerState {
  open: boolean;
  stockItem: StockItemData | null;
  locationId: number;
  locationName: string;
  availableQty: number;
}

export interface ImportPreviewRow {
  rawCode: string;
  rawName: string;
  stockItemId: number | null;
  stockItemName: string;
  currentQty: number;
  change: number;
  newQty: number;
  sourceLocationId: number | null;
  sourceLocationName: string;
  status: "ok" | "not_found" | "remove" | "new_item";
}
