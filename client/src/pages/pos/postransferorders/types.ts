/**
 * Types for the PosTransferOrders page.
 */

export interface PosUser {
  id: number;
  username: string;
  assignedLocationId?: number;
  posStation?: string;
}

export interface PosTransferOrdersProps {
  posUser: PosUser;
}

export interface TransferSummary {
  transferId: number;
  voucherId: number;
  voucherNumber: string;
  voucherDate: string;
  sourceLocationId?: number;
  sourceLocationName: string;
  destinationLocationId: number;
  destinationLocationName: string;
  itemCount: number;
  totalAmount: number;
  stockItemNames: string[];
  inventoryApplied: boolean;
}

export interface TransferDetailItem {
  id: number;
  transferId: number;
  stockItemId: number;
  stockItemName: string;
  sourceLocationId?: number;
  sourceLocationName?: string;
  quantity: string;
}

export interface RevisionItem {
  stockItemId: number;
  stockItemName: string;
  sourceLocationId?: number | null;
  sourceLocationName?: string | null;
  originalQuantity: string;
  delta: string;
  newQuantity: string;
}

export type RevisionStatus = "pending" | "approved" | "rejected" | "superseded";

export interface Revision {
  id: number;
  revisionNumber: number;
  note?: string | null;
  optional: boolean;
  status?: RevisionStatus;
  statusReason?: string | null;
  createdBy?: string | null;
  revisionDate: string;
  createdAt?: string;
  items: RevisionItem[];
}

export interface TransferDetail {
  transferId: number;
  voucherId: number;
  voucherNumber: string;
  voucherDate: string;
  optional: boolean;
  inventoryApplied: boolean;
  sourceLocationId?: number;
  sourceLocationName: string;
  destinationLocationId: number;
  destinationLocationName: string;
  notes?: string;
  items: TransferDetailItem[];
  revisions: Revision[];
}

export interface InventoryItem {
  stockItemId: number;
  name: string;
  stockItemName?: string;
  locationId: number;
  quantity?: string;
}

export interface ExtraItem {
  stockItemId: number;
  stockItemName: string;
  qtyDraft: string;
}

export interface NewTransferItem {
  stockItemId: number;
  stockItemName: string;
  quantity: string;
}
