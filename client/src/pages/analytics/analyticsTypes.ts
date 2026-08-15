export interface Account {
  id: string;
  accountId: number;
  type: string;
  code: string;
  name: string;
  accountType?: string;
  subType?: string;
  balance: number;
  balanceSide: string | null;
  active: boolean;
  parentId?: number;
  customerId?: number;
}

export interface LocationSales {
  locationId: number;
  locationName: string;
  locationCode: string;
  totalSales: number;
  totalTransactions: number;
  totalQuantity: number;
}

export interface POSTransaction {
  id: number;
  voucherNumber: string;
  voucherDate: string;
  createdAt: string;
  description: string | null;
  customerName: string | null;
  cashAccountName: string | null;
  totalAmount: number;
  totalQuantity: number;
  itemCount: number;
  items: any[];
}

export interface StockLocation {
  locationId: number;
  locationName: string;
  quantity: number;
  averageRate: number;
  totalValue: number;
}

export interface StockMovementItem {
  stockItemId: number;
  stockItemCode: string;
  stockItemName: string;
  locations: StockLocation[];
  totalQuantity: number;
  totalValue: number;
}

export interface StockMovementData {
  items: StockMovementItem[];
  summary: {
    totalItems: number;
    grandTotalQuantity: number;
    grandTotalValue: number;
  };
  filters: {
    startDate: string | null;
    endDate: string | null;
    locationId: string | null;
    stockGroupId: string | null;
  };
}

export interface ReportContainer {
  id: number;
  containerNumber: string;
  supplierName: string;
  status: string;
  importDate: string | null;
  offloadDate: string | null;
  itemsTotal: string;
  chargesTotal: string;
  grandTotal: string;
  companyId: number;
  companyName: string;
}

export interface ContainerData {
  containers: ReportContainer[];
  summary: {
    totalContainers: number;
    totalItemsTotal: number;
    totalChargesTotal: number;
    totalGrandTotal: number;
  };
  filters: {
    startDate: string | null;
    endDate: string | null;
    supplierId: string | null;
    status: string | null;
  };
}

export interface Location {
  id: number;
  code: string;
  name: string;
}

export interface StockGroup {
  id: number;
  code: string;
  name: string;
}

export interface Supplier {
  id: number;
  code: string;
  name: string;
}

export interface OpeningStockGroup {
  id: number;
  code: string;
  name: string;
  opening: {
    quantity: number;
    rate: number;
    value: number;
  };
  closing: {
    quantity: number;
    rate: number;
    value: number;
  };
  itemCount: number;
}

export interface OpeningStockItem {
  id: number;
  code: string;
  name: string;
  uom: string;
  opening: {
    quantity: number;
    rate: number;
    value: number;
  };
  closing: {
    quantity: number;
    rate: number;
    value: number;
  };
}

export interface OpeningStockSummaryData {
  stockGroups: OpeningStockGroup[];
  grandTotal: {
    opening: { quantity: number; value: number };
    closing: { quantity: number; value: number };
  };
  filters: {
    locationId: string | null;
  };
  notes?: {
    opening: string;
    closing: string;
  };
}

export interface OpeningStockItemsData {
  items: OpeningStockItem[];
  totals: {
    opening: { quantity: number; value: number };
    closing: { quantity: number; value: number };
  };
}

export interface NetProfitAccount {
  id: number;
  code: string;
  name: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface NetProfitStatementData {
  netPosition: number;
  openingBalancesNet?: number | null;
  leftPane: {
    openingStock: {
      value: number;
    };
    purchaseAccounts: {
      total: number;
      accounts: NetProfitAccount[];
      count: number;
    };
    directExpenses: {
      total: number;
      accounts: NetProfitAccount[];
      count: number;
    };
    tradingTotal: number;
    grossProfit: number;
    indirectExpenses: {
      total: number;
      accounts: NetProfitAccount[];
      count: number;
    };
    netProfit: number;
  };
  rightPane?: {
    salesAccounts: {
      total: number;
    };
    directIncomes: {
      total: number;
      accounts: NetProfitAccount[];
      count: number;
    };
    closingStock: {
      value: number;
    };
    tradingTotal: number;
    grossProfitBf: number;
    indirectIncomes: {
      total: number;
      accounts: NetProfitAccount[];
      count: number;
    };
    total: number;
  };
}

export function formatSmartNumber(num: number | string | null | undefined): string {
  if (num === null || num === undefined) return "";
  const value = typeof num === "string" ? parseFloat(num) : num;
  if (isNaN(value)) return "";
  const isWholeNumber = value % 1 === 0;
  if (isWholeNumber) {
    return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
