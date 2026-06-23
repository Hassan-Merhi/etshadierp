import { z } from "zod";

export interface LedgerAccount {
  id: number;
  code: string;
  name: string;
  accountType: string;
}

export interface BankAccount {
  id: number;
  code: string;
  name: string;
  accountNumber: string;
  bankName: string;
}

export interface Supplier {
  id: number;
  code: string;
  legalName: string;
}

export interface Employee {
  id: number;
  code: string;
  firstName: string;
  lastName: string;
}

export interface FixedAsset {
  id: number;
  assetCode: string;
  assetName: string;
}

export const newEntryRowSchema = z.object({
  accountType: z.enum(["ledger", "bank", "supplier", "employee", "fixedAsset"]),
  accountId: z.number().min(1, "Please select an account"),
  accountName: z.string(),
  debitAmount: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, {
    message: "Must be a valid number",
  }),
  creditAmount: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, {
    message: "Must be a valid number",
  }),
  narration: z.string().optional(),
});

export const createVoucherSchema = z
  .object({
    voucherType: z.enum(["Journal", "Payment", "Receipt", "Stock Transfer", "Sales", "Purchase", "Contra"], {
      required_error: "Voucher type is required",
    }),
    voucherDate: z.string().min(1, "Voucher date is required"),
    description: z.string().optional(),
    optional: z.boolean().default(false),
    entries: z.array(newEntryRowSchema).min(2, "At least 2 entries required"),
  })
  .refine(
    (data) => {
      const totalDebits = data.entries.reduce((sum, entry) => sum + parseFloat(entry.debitAmount || "0"), 0);
      const totalCredits = data.entries.reduce((sum, entry) => sum + parseFloat(entry.creditAmount || "0"), 0);
      return Math.abs(totalDebits - totalCredits) < 0.01;
    },
    {
      message: "Total debits must equal total credits",
      path: ["entries"],
    }
  );

export type CreateVoucherForm = z.infer<typeof createVoucherSchema>;
export type EditVoucherForm = CreateVoucherForm;

export interface Voucher {
  id: number;
  voucherNumber: string;
  voucherType: string;
  voucherDate: string;
  description: string | null;
  totalAmount: string;
  optional: boolean;
  createdAt: string;
  locationName?: string;
}

export interface OffloadListItem {
  id: number;
  containerId: number;
  containerNumber: string;
  locationId: number;
  locationName: string | null;
  duties: string;
  officeCharges: string;
  transferCharges: string;
  transportFees: string;
  totalCharges: string;
  totalBales: string;
  additionalCostPerBale: string;
  offloadedAt: string;
  itemsTotal: string;
}

export interface OffloadDetail extends OffloadListItem {
  items: Array<{
    id: number;
    stockItemId: number;
    stockItemName: string | null;
    stockItemCode: string | null;
    quantity: string;
    rate: string;
    totalValue: string;
  }>;
}

export type DaybookRow = { _type: "voucher"; data: Voucher } | { _type: "offload"; data: OffloadListItem };

export interface VoucherEntry {
  id: number;
  voucherId: number;
  accountType: string;
  accountId: number;
  accountCode: string;
  accountName: string;
  debitAmount: string;
  creditAmount: string;
  narration: string | null;
}

export interface ViewVoucherEntry {
  id: number;
  accountName: string;
  debitAmount: string;
  creditAmount: string;
  narration: string | null;
  isStockItem?: boolean;
  stockItemId?: number;
  stockItemCode?: string;
  stockItemName?: string;
  ledgerAccountId?: number;
  bankAccountId?: number;
  employeeId?: number;
  supplierId?: number;
  customerId?: number;
  factorySupplierId?: number;
  isPurchaseItem?: boolean;
  quantity?: string;
  rate?: string;
  totalAmount?: string;
  sellingPrice?: string;
  totalSales?: string;
  costPrice?: string | null;
  profit?: string | null;
  hassansPrice?: string | null;
  hassansProfit?: string | null;
  hassansPercentage?: string | null;
  adjustmentType?: string;
}
