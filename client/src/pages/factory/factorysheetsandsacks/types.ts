/**
 * Types for the FactorySheetsAndSacks page.
 *
 * Extracted from FactorySheetsAndSacks.tsx during the Phase 4 god-file split.
 */

export interface SheetsAndSacksItem {
  id: number;
  companyId: number;
  type: string;
  name: string;
  size: string | null;
  quantity: string;
  unitPrice: string;
  packQty: number | null;
  pcsPerPack: number | null;
  rowColor: string | null;
  notes: string | null;
  createdAt: string;
}

export interface LogEntry {
  id: number;
  itemId: number;
  itemName: string;
  itemType: string;
  action: "IN" | "OUT" | "ADJUST";
  pieces: number;
  packs: number | null;
  unitPrice: string;
  totalValue: string;
  notes: string | null;
  createdAt: string;
}
