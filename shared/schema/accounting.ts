import {
  pgTable,
  text,
  varchar,
  serial,
  integer,
  decimal,
  date,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const ledgerAccounts = pgTable(
  "ledger_accounts",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    code: varchar("code", { length: 50 }).notNull(),
    name: text("name").notNull(),
    accountType: text("account_type").notNull(),
    subType: text("sub_type"),
    parentId: integer("parent_id"),
    openingBalance: decimal("opening_balance", { precision: 20, scale: 2 }).default("0"),
    openingBalanceSide: text("opening_balance_side"),
    active: boolean("active").notNull().default(true),
    isHidden: boolean("is_hidden").notNull().default(false),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueCompanyCode: uniqueIndex("ledger_accounts_company_code_unique").on(t.companyId, t.code),
    companyDeletedCodeIdx: index("ledger_accounts_company_deleted_code_idx").on(t.companyId, t.deletedAt, t.code),
    companyTypeIdx: index("ledger_accounts_company_type_idx").on(t.companyId, t.accountType),
  })
);

export const insertLedgerAccountSchema = createInsertSchema(ledgerAccounts)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    code: z.string().optional(),
    name: z
      .string()
      .min(1, "Name is required")
      .refine((val) => val.trim().length > 0, "Name cannot be only whitespace"),
    accountType: z.enum([
      "Asset",
      "Liability",
      "Equity",
      "Income",
      "Expense",
      "Bank",
      "Cash",
      "Indirect Expense",
      "Direct Expense",
      "Government Taxes",
      "Loans",
      "Duty Agent",
      "Transporter Agent",
      "Accounts Payable",
      "Profit",
    ]),
    subType: z.string().nullable().optional(),
    openingBalance: z.string().optional(),
    openingBalanceSide: z.enum(["Dr", "Cr"]).optional().or(z.literal("")),
    parentId: z.number().nullable().optional(),
  });

export const updateLedgerAccountSchema = insertLedgerAccountSchema
  .partial()
  .extend({
    id: z.number().min(1, "Account ID is required"),
  })
  .required({ id: true });

export type InsertLedgerAccount = z.infer<typeof insertLedgerAccountSchema>;
export type UpdateLedgerAccount = z.infer<typeof updateLedgerAccountSchema>;
export type LedgerAccount = typeof ledgerAccounts.$inferSelect;

export const bankAccounts = pgTable(
  "bank_accounts",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    code: varchar("code", { length: 50 }).notNull().unique(),
    name: text("name").notNull(),
    bankName: text("bank_name").notNull(),
    accountNumber: text("account_number").notNull(),
    routingCode: text("routing_code"),
    linkedLedgerId: integer("linked_ledger_id"),
    openingBalance: decimal("opening_balance", { precision: 15, scale: 2 }).default("0"),
    openingBalanceSide: text("opening_balance_side"),
    active: boolean("active").notNull().default(true),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("bank_accounts_company_idx").on(t.companyId),
  })
);

export const insertBankAccountSchema = createInsertSchema(bankAccounts)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    code: z.string().min(1, "Code is required"),
    name: z.string().min(1, "Name is required"),
    bankName: z.string().min(1, "Bank name is required"),
    accountNumber: z.string().min(1, "Account number is required"),
    openingBalanceSide: z.enum(["Dr", "Cr"]).optional().or(z.literal("")),
  });

export type InsertBankAccount = z.infer<typeof insertBankAccountSchema>;
export type BankAccount = typeof bankAccounts.$inferSelect;

export const fixedAssets = pgTable(
  "fixed_assets",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    code: varchar("code", { length: 50 }).notNull().unique(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    purchaseDate: date("purchase_date").notNull(),
    purchaseAmount: decimal("purchase_amount", { precision: 15, scale: 2 }).notNull(),
    depreciationMethod: text("depreciation_method").notNull().default("None"),
    usefulLife: integer("useful_life"),
    openingBalance: decimal("opening_balance", { precision: 15, scale: 2 }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("fixed_assets_company_idx").on(t.companyId),
  })
);

export const insertFixedAssetSchema = createInsertSchema(fixedAssets)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    code: z.string().min(1, "Code is required"),
    name: z.string().min(1, "Name is required"),
    category: z.string().min(1, "Category is required"),
    purchaseDate: z.string().min(1, "Purchase date is required"),
    purchaseAmount: z.string().min(1, "Purchase amount is required"),
    depreciationMethod: z.enum(["None", "StraightLine", "Declining"]),
  });

export type InsertFixedAsset = z.infer<typeof insertFixedAssetSchema>;
export type FixedAsset = typeof fixedAssets.$inferSelect;
