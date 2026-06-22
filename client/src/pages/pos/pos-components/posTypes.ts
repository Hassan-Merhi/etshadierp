export interface SaleRow {
  id: string;
  itemName: string;
  stockItemCode?: string;
  quantity: number;
  rate: number;
  rateUSD: number; // Canonical USD rate for storage (never converted)
  amount: number;
  stockItemId?: number;
  salesItemId?: number; // Original sales item ID for edit mode
  configuredPrice?: number; // Configured selling price for P/L calculation (USD)
}

export interface InventoryItem {
  code: string;
  name: string;
  stock: number;
  price: number;
  configuredPrice: number; // Configured selling price (for P/L)
  stockItemId: number;
}

export interface APIInventoryItem {
  inventoryId: number;
  locationId: number;
  stockItemId: number;
  quantity: string;
  averageRate: string;
  totalValue: string;
  lastSellingPrice?: string;
  stockItemCode: string;
  stockItemName: string;
  stockItemUom: string;
  stockGroupId: number | null;
  stockGroupName: string | null;
  stockGroupCode: string | null;
}

export interface Location {
  id: number;
  code: string;
  name: string;
  city: string | null;
  state: string | null;
  country: string | null;
  cashAccountId?: number;
  cashAccountName?: string;
}
