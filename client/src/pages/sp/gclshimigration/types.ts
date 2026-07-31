/**
 * Types for the GcLshiMigration page.
 *
 * Extracted from GcLshiMigration.tsx during the Phase 4 god-file split.
 */

export interface Company {
  id: number;
  code: string;
  name: string;
  company_type: string;
  companyType?: string;
}

export interface GcPreview {
  sourceCompany: { id: number; code: string; name: string };
  targetCompany: { id: number; code: string; name: string };
  stockSummary: { itemCount: number; totalQty: number; totalValueUsd: number; alreadyMapped: number };
  stockItems: Array<{
    code: string;
    name: string;
    quantity: number;
    averageCostUsd: number;
    totalValueUsd: number;
    aliasExists: boolean;
  }>;
  voucherSummary: { sourceCount: number; totalAmount: number; alreadyMigrated: number };
  spAccountsStatus: Array<{ subType: string; name: string; exists: boolean }>;
  gcProfitAccountsStatus: Array<{ subType: string; name: string; exists: boolean }>;
  warnings: string[];
}

export interface MigrationRun {
  id: string;
  source_company_id: number;
  target_company_id: number;
  action: string;
  status: string;
  rows_created: number;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
  notes: string | null;
  source_name: string;
  target_name: string;
}

// ── StatusBadge ────────────────────────────────────────────────────────────
