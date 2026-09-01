/**
 * Pure helpers and lookup tables for the StockTransferForm page.
 *
 * Extracted from StockTransferForm.tsx during the Phase 4 god-file split.
 */
import { z } from "zod";

export const stockTransferEntrySchema = z.object({
  sourceLocationId: z.coerce.number(),
  sourceLocationName: z.string(),
  stockItemId: z.coerce.number(),
  stockItemCode: z.string().default(""),
  stockItemName: z.string(),
  quantity: z.string(),
  rate: z.string(),
});

export const stockTransferFormSchema = z.object({
  voucherDate: z.date(),
  destinationLocationId: z.number(),
  entries: z.array(stockTransferEntrySchema),
  notes: z.string().optional(),
  optional: z.boolean().default(false),
});
