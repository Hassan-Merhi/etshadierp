// Retired compatibility boundary. All report endpoints have been migrated to
// focused modules (reportsLedgerRoutes, reportsVoucherDetailRoutes, etc.).
// This file is intentionally empty — it exists only so architecture-guard tests
// can verify the boundary call order in reportsRoutes.ts.
import type { Express } from "express";

export function registerReportsRoutes(_app: Express): void {
  // No HTTP handlers — migration complete.
}
