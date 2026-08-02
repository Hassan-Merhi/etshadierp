/**
 * Types for the StockAdjustmentForm page.
 *
 * Extracted from StockAdjustmentForm.tsx during the Phase 4 god-file split.
 */
import { z } from "zod";
import { stockAdjustmentFormSchema } from "./utils";

export interface StockItem {
  id: number;
  code: string;
  name: string;
  uom: string;
}

export interface Location {
  id: number;
  code?: string;
  name: string;
}

export type StockAdjustmentFormData = z.infer<typeof stockAdjustmentFormSchema>;

export interface StockAdjustmentFormProps {
  voucherIdToEdit: number | null;
  isPOS: boolean;
}
