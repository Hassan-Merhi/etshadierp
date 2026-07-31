/**
 * Pure helpers and lookup tables for the FactoryStockAllocationV5 page.
 *
 * Extracted from FactoryStockAllocationV5.tsx during the Phase 4 god-file split.
 */

export const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  LOADING: "Loading",
  PENDING_VERIFICATION: "Verified",
  VERIFIED: "Verified",
  FINALIZED: "Finalized",
  CANCELLED: "Cancelled",
};

/* ═══════════════════════════════════════════════════════════════════════════ */
