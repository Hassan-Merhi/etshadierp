/**
 * Pure helpers and lookup tables for the FactoryPendingInvoiceVerify page.
 *
 * Extracted from FactoryPendingInvoiceVerify.tsx during the Phase 4 god-file split.
 */

export /** Strip unnecessary trailing zeros — e.g. 5563.00 → "5563", 15836.28 → "15836.28" */
const fmtNum = (n: number, max = 2) => parseFloat(n.toFixed(max)).toString();
