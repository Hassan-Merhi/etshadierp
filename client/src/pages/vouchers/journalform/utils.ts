/**
 * Pure helpers and lookup tables for the JournalForm page.
 *
 * Extracted from JournalForm.tsx during the Phase 4 god-file split.
 */
import { z } from "zod";

export const journalEntrySchema = z.object({
  type: z.enum(["DR", "CR"]),
  accountType: z.enum(["ledger", "bank", "supplier", "employee", "fixedAsset", "customer", "factorySupplier"]),
  accountId: z.number().min(1, "Please select an account"),
  accountName: z.string(),
  amount: z
    .string()
    .min(1, "Amount required")
    .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, { message: "Amount must be a positive number" }),
  narration: z.string().optional(),
});

export const journalFormSchema = z.object({
  voucherDate: z.date(),
  entries: z.array(journalEntrySchema).min(1, "Add at least one entry"),
  notes: z.string().optional(),
  optional: z.boolean().default(false),
});
