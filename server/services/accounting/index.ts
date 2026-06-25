/**
 * Central Accounting Service — Phase 10
 *
 * Re-exports all shared accounting helpers.
 * Import from here to get the full accounting service surface:
 *
 *   import { insertVoucherWithEntriesTx } from "@/services/accounting";
 *
 * See docs/accounting-engine-audit.md for the full flow map and risk levels.
 */

export type { VoucherInsertFields, VoucherEntryInsertFields, VoucherWithEntries } from "./accountingTypes";

export { insertVoucherWithEntriesTx, insertVoucherWithEntries } from "./voucherPostingService";
