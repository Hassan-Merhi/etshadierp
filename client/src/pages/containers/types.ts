import type { Container } from "@shared/schema";

export interface SoldContainer {
  containerId: number;
  containerNumber: string;
  supplierId: number;
  status: string;
  importDate: string;
  itemsTotal: string;
  chargesTotal: string;
  grandTotal: string;
  saleId: number;
  customerId: number;
  customerName: string;
  saleDate: string;
  containerCost: string;
  commission: string;
  commissionAccountId: number | null;
  totalAmount: string;
  notes: string | null;
}

export interface TrackingEdit {
  [key: number]: Partial<Container>;
}
