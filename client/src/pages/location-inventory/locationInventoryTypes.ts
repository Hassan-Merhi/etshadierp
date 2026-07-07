export interface Location {
  id: number;
  code: string;
  name: string;
  city: string | null;
  state: string | null;
  country: string | null;
  createdAt?: string;
  supplierPartnerPayableDeductionPerQty?: string | null;
}

export interface InventoryItem {
  inventoryId: number | null;
  locationId: number;
  stockItemId: number;
  quantity: string;
  averageRate: string;
  totalValue: string;
  stockItemCode: string;
  stockItemName: string;
  stockItemUom: string;
  stockGroupId: number | null;
  stockGroupName: string | null;
  stockGroupCode: string | null;
  stockItemActive: boolean | null;
  categoryId?: number | null;
  categoryName?: string | null;
}

export interface StockGroupSummary {
  groupId: number | null;
  groupCode: string | null;
  groupName: string;
  totalQuantity: number;
  totalValue: number;
  averageRate: number;
  itemCount: number;
  items: InventoryItem[];
}
