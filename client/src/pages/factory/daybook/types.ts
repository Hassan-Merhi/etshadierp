/**
 * Shared types for the Factory Daybook page.
 *
 * Extracted first because type-only moves cannot change runtime behaviour -
 * if this compiles, it is correct.
 */
import type { PeriodFilterValue } from "@/components/ui/period-filter";

export interface DaybookEntry {
  id: number;
  companyId: number;
  txDate: string;
  txType: string;
  referenceId: number | null;
  referenceTable: string | null;
  description: string;
  metaJson: string | null;
  currencyCode: string;
  amountCurrency: string;
  fxRateToUsd: string;
  amountUsd: string;
  optional?: boolean;
  createdAt: string;
  createdBy: number | null;
  voucherNumber?: string;
  effectiveDate?: string | null;
}

export interface BaleMeta {
  id: number;
  ref: string;
  productName: string;
  weightKg: string;
  status: string;
}

// A DisplayEntry is a DaybookEntry augmented with a stable React key and a
// reference back to the original entry (used by the detail panel so it always
// shows all bales, not just the per-bale virtual row).
export type DisplayEntry = DaybookEntry & { _vKey: string; _source: DaybookEntry };

export interface FactoryDaybookUIState {
  periodFilter: PeriodFilterValue;
  txTypeFilter: string;
  currencyFilter: string;
  statusFilter: string;
  searchQuery: string;
  minAmount: string;
  maxAmount: string;
  sortOrder: "asc" | "desc";
  scrollY: number;
}
