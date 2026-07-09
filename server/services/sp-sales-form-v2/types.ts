// ── Public interface ──────────────────────────────────────────────────────────
export interface SpSalesFormV2Params {
  companyId: number;
  locationId?: number;
  fromDate: string;      // YYYY-MM-DD
  toDate: string;        // YYYY-MM-DD
  locationName?: string;
  supplierName?: string;
  cashAccountId?: number; // optional: opening cash from ledger as-of dayBefore(fromDate)
}

// ── Internal types ────────────────────────────────────────────────────────────
export interface DaySale { qty: number; totalSales: number; totalCost: number }
export interface InvEntry {
  stockItemId: number;
  stockItemCode: string;
  stockItemName: string;
  stockGroupName: string;
  stockItemUom: string;
  quantity: number;
  averageRate: number;
  totalValue: number;
}

export interface ItemRow {
  stockItemId  : number;
  itemCode     : string;
  itemName     : string;
  groupName    : string;
  itemUom      : string;
  openQty      : number;
  openRate     : number;
  openValue    : number;
  salesByDate  : Map<string, DaySale>;
  closeQty     : number;
  closeRate    : number;
  closeValue   : number;
  // computed
  totalQty     : number;
  totalSales   : number;
  totalCost    : number;
  avgMonthlyQty: number;
}
