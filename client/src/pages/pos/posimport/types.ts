/**
 * Types for the POS Import page.
 *
 * Extracted from POSImport.tsx during the god-file split; shapes are
 * unchanged.
 */

export interface Location {
  id: number;
  name: string;
}

export interface LedgerAccount {
  id: number;
  code: string;
  name: string;
  accountType: string;
}

export interface Customer {
  id: number;
  legalName: string;
}
