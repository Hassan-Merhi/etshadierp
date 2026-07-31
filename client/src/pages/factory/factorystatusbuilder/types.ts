/**
 * Types for the FactoryStatusBuilder page.
 *
 * Extracted from FactoryStatusBuilder.tsx during the Phase 4 god-file split.
 */

export type CellValue = number | string | null;

export interface CellLink {
  type: "status_builder_cell";
  sourceSheetId: string;
  sourceRowId: string;
  sourceColumnId: string;
}

export interface Cell {
  value: CellValue;
  link?: CellLink | null;
}

export interface ColumnDef {
  id: string;
  label: string;
}

export interface SheetRow {
  id: string;
  label: string;
  cells: Cell[];
}

export interface StatusBuilderSheet {
  id: number | null;
  stableId: string;
  name: string;
  columns: ColumnDef[];
  rows: SheetRow[];
  lockedColumns: number[];
  dirty: boolean;
  footerMode: "diff" | "total";
}

export interface ApiSheet {
  id: number;
  companyId: number;
  name: string;
  orderIndex: number;
  columns: any[];
  rows: any[];
  updatedAt: string;
}

export interface LinkDialogState {
  open: boolean;
  targetRowIdx: number;
  targetColIdx: number;
  sourceSheetId: string;
  sourceRowId: string;
  sourceColId: string;
}

// ── Utilities ─────────────────────────────────────────────────────────────────
