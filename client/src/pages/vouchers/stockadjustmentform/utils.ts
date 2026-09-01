/**
 * Pure helpers and lookup tables for the StockAdjustmentForm page.
 *
 * Extracted from StockAdjustmentForm.tsx during the Phase 4 god-file split.
 */
import { z } from "zod";

export const stockAdjustmentEntrySchema = z.object({
  type: z.enum(["CONSUME", "PRODUCE"]),
  stockItemId: z.number().min(1, "Please select a stock item"),
  stockItemCode: z.string().default(""),
  stockItemName: z.string(),
  quantity: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) !== 0, "Quantity cannot be zero"),
  rate: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Rate must be non-negative"),
});

export const stockAdjustmentFormSchema = z.object({
  voucherDate: z.date(),
  locationId: z.number().min(1, "Location required"),
  entries: z.array(stockAdjustmentEntrySchema).min(1, "At least one entry is required"),
  notes: z.string().optional(),
  optional: z.boolean().default(false),
});
