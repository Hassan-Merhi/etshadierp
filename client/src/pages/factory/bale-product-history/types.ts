export interface MonthlyBaleData {
  month: number;
  monthName: string;
  baleCount: number;
  balesIn: number;
  balesOut: number;
  balesPending: number;
  balesNet: number;
  totalWeight: number;
  totalWeightOut: number;
  totalWeightNet: number;
  totalCost: number;
  totalSellingValue: number;
}

export interface BaleProductHistoryResponse {
  product: {
    id: number;
    name: string;
    articleCode: string;
    weightPerBaleKg: number;
    sellingPrice: string;
  };
  location: {
    id: number;
    name: string;
  };
  year: number;
  monthlyData: MonthlyBaleData[];
  grandTotal: {
    baleCount: number;
    balesIn: number;
    balesOut: number;
    balesPending: number;
    balesNet: number;
    totalWeight: number;
    totalWeightOut: number;
    totalWeightNet: number;
    totalCost: number;
    totalSellingValue: number;
  };
}

export interface BaleItem {
  id: number;
  baleCode: string;
  referenceNumber: string;
  weightKg: number | string;
  costPerKg: number | string;
  totalCost: number | string;
  status: string;
  createdAt: string;
  isInLoadingOrder?: boolean;
}

export interface BaleDetailResponse {
  bales: BaleItem[];
  sellingPrice?: string;
}
