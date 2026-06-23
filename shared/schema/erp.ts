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
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { companies, locations } from "./common";
import { ledgerAccounts } from "./accounting";
import { stockGroups, stockItems } from "./inventory";
import { users } from "./users";

export const employees = pgTable(
  "employees",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    code: varchar("code", { length: 50 }).notNull().unique(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    joinDate: date("join_date").notNull(),
    department: text("department"),
    employeeType: text("employee_type").notNull().default("Employee"),
    monthlySalary: decimal("monthly_salary", { precision: 15, scale: 2 }).notNull().default("0"),
    openingBalance: decimal("opening_balance", { precision: 15, scale: 2 }).default("0"),
    currentBalance: decimal("current_balance", { precision: 15, scale: 2 }).notNull().default("0"),
    totalDeposits: decimal("total_deposits", { precision: 15, scale: 2 }).notNull().default("0"),
    totalWithdrawals: decimal("total_withdrawals", { precision: 15, scale: 2 }).notNull().default("0"),
    active: boolean("active").notNull().default(true),
    salesBonusPct: decimal("sales_bonus_pct", { precision: 10, scale: 4 }),
    salesBonusPctSourceCompanyId: integer("sales_bonus_pct_source_company_id").references(() => companies.id),
    salesBonusPctLocationId: integer("sales_bonus_pct_location_id").references(() => locations.id, {
      onDelete: "restrict",
    }),
    balesBonusRate: decimal("bales_bonus_rate", { precision: 10, scale: 4 }),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("employees_company_idx").on(t.companyId),
  })
);

export const insertEmployeeSchema = createInsertSchema(employees)
  .omit({
    id: true,
    createdAt: true,
    currentBalance: true,
    totalDeposits: true,
    totalWithdrawals: true,
  })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    code: z.string().optional(),
    firstName: z
      .string()
      .min(1, "First name is required")
      .refine((val) => val.trim().length > 0, "First name cannot be only whitespace"),
    lastName: z
      .string()
      .min(1, "Last name is required")
      .refine((val) => val.trim().length > 0, "Last name cannot be only whitespace"),
    email: z.string().email("Invalid email format").optional().or(z.literal("")),
    joinDate: z
      .string()
      .min(1, "Starting date is required")
      .refine((val) => {
        const regex = /^\d{4}-\d{2}-\d{2}$/;
        if (!regex.test(val)) return false;
        const d = new Date(val);
        return !isNaN(d.getTime()) && val === d.toISOString().split("T")[0];
      }, "Date must be a valid date in YYYY-MM-DD format"),
    employeeType: z.enum(["Employee", "Worker"]),
  });

export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Employee = typeof employees.$inferSelect;

export const employeeGroups = pgTable(
  "employee_groups",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    groupType: text("group_type").notNull().default("Employee"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("employee_groups_company_idx").on(t.companyId),
  })
);

export const insertEmployeeGroupSchema = createInsertSchema(employeeGroups)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    name: z
      .string()
      .min(1, "Group name is required")
      .refine((val) => val.trim().length > 0, "Group name cannot be only whitespace"),
    description: z.string().optional(),
    groupType: z.enum(["Employee", "Worker"]).default("Employee"),
  });

export type InsertEmployeeGroup = z.infer<typeof insertEmployeeGroupSchema>;
export type EmployeeGroup = typeof employeeGroups.$inferSelect;

export const employeeGroupMembers = pgTable("employee_group_members", {
  id: serial("id").primaryKey(),
  employeeGroupId: integer("employee_group_id").notNull(),
  employeeId: integer("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertEmployeeGroupMemberSchema = createInsertSchema(employeeGroupMembers)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    employeeGroupId: z.number().min(1, "Employee group is required"),
    employeeId: z.number().min(1, "Employee is required"),
  });

export type InsertEmployeeGroupMember = z.infer<typeof insertEmployeeGroupMemberSchema>;
export type EmployeeGroupMember = typeof employeeGroupMembers.$inferSelect;

export const suppliers = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  legalName: text("legal_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  address: text("address"),
  taxId: text("tax_id"),
  paymentTerms: text("payment_terms"),
  openingBalance: decimal("opening_balance", { precision: 15, scale: 2 }).default("0"),
  active: boolean("active").notNull().default(true),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  stockGroupId: integer("stock_group_id").references(() => stockGroups.id, { onDelete: "set null" }),
});

export const insertSupplierSchema = createInsertSchema(suppliers)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    code: z.string().optional(),
    legalName: z.string().min(1, "Legal name is required"),
    email: z.string().email("Invalid email format").optional().or(z.literal("")),
    phone: z.string().optional(),
    address: z.string().optional(),
    taxId: z.string().optional(),
    paymentTerms: z.string().optional(),
    openingBalance: z.string().optional(),
  });

export type InsertSupplier = z.infer<typeof insertSupplierSchema>;
export type Supplier = typeof suppliers.$inferSelect;

export const vouchers = pgTable(
  "vouchers",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    locationId: integer("location_id").references(() => locations.id, { onDelete: "restrict" }),
    locationName: text("location_name"),
    voucherNumber: varchar("voucher_number", { length: 100 }).notNull().unique(),
    voucherType: text("voucher_type").notNull(),
    voucherDate: date("voucher_date").notNull(),
    description: text("description"),
    totalAmount: decimal("total_amount", { precision: 20, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    optional: boolean("optional").notNull().default(false),
    shiftId: integer("shift_id"),
    exchangeRate: decimal("exchange_rate", { precision: 20, scale: 6 }),
    sourceModule: text("source_module").default("ERP"),
    isCreditSale: boolean("is_credit_sale").default(false),
    clientSaleId: varchar("client_sale_id", { length: 36 }),
    deletedAt: timestamp("deleted_at"),
    effectiveDate: date("effective_date"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("vouchers_company_idx").on(t.companyId),
    companyDateIdx: index("vouchers_company_date_idx").on(t.companyId, t.voucherDate),
  })
);

export const insertVoucherSchema = createInsertSchema(vouchers)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    locationId: z.number().optional(),
    locationName: z.string().optional(),
    voucherNumber: z.string().min(1, "Voucher number is required"),
    voucherType: z.enum([
      "Payment",
      "Receipt",
      "Journal",
      "Sales",
      "Purchase",
      "Contra",
      "Stock Transfer",
      "Credit Note",
      "Debit Note",
    ]),
    voucherDate: z.string().min(1, "Voucher date is required"),
    totalAmount: z.string().min(1, "Total amount is required"),
    currency: z.enum(["USD", "CFA"]).default("USD"),
    optional: z.boolean().optional().default(false),
    shiftId: z.number().optional(),
    exchangeRate: z.string().optional(),
    sourceModule: z.enum(["ERP", "FACTORY"]).optional().default("ERP"),
    isCreditSale: z.boolean().optional(),
    effectiveDate: z.string().optional().nullable(),
  });

export type InsertVoucher = z.infer<typeof insertVoucherSchema>;
export type Voucher = typeof vouchers.$inferSelect;

export const customers = pgTable(
  "customers",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    ledgerAccountId: integer("ledger_account_id"),
    code: varchar("code", { length: 50 }).notNull(),
    legalName: text("legal_name").notNull(),
    phone: text("phone"),
    openingBalance: decimal("opening_balance", { precision: 15, scale: 2 }).default("0"),
    openingBalanceSide: varchar("opening_balance_side", { length: 2 }).default("Dr"),
    active: boolean("active").notNull().default(true),
    statementNote: text("statement_note"),
    paymentTermsDays: integer("payment_terms_days"),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueCompanyCode: uniqueIndex("customers_company_code_unique").on(t.companyId, t.code),
  })
);

export const insertCustomerSchema = createInsertSchema(customers)
  .omit({
    id: true,
    createdAt: true,
    code: true,
  })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    legalName: z.string().min(1, "Legal name is required"),
    openingBalance: z.string().optional(),
    openingBalanceSide: z.enum(["Dr", "Cr"]).optional().or(z.literal("")),
    ledgerAccountId: z.number().optional(),
    paymentTermsDays: z.number().int().positive().optional().nullable(),
  });

export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Customer = typeof customers.$inferSelect;

export const voucherEntries = pgTable(
  "voucher_entries",
  {
    id: serial("id").primaryKey(),
    voucherId: integer("voucher_id")
      .notNull()
      .references(() => vouchers.id, { onDelete: "cascade" }),
    ledgerAccountId: integer("ledger_account_id"),
    bankAccountId: integer("bank_account_id"),
    fixedAssetId: integer("fixed_asset_id"),
    supplierId: integer("supplier_id").references(() => suppliers.id, { onDelete: "restrict" }),
    employeeId: integer("employee_id").references(() => employees.id, { onDelete: "restrict" }),
    customerId: integer("customer_id").references(() => customers.id, { onDelete: "restrict" }),
    factorySupplierId: integer("factory_supplier_id"),
    debitAmount: decimal("debit_amount", { precision: 20, scale: 2 }).default("0"),
    creditAmount: decimal("credit_amount", { precision: 20, scale: 2 }).default("0"),
    narration: text("narration"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    voucherIdx: index("voucher_entries_voucher_idx").on(t.voucherId),
    customerIdx: index("voucher_entries_customer_idx").on(t.customerId),
    ledgerAccountIdx: index("voucher_entries_ledger_account_idx").on(t.ledgerAccountId),
    ledgerVoucherIdx: index("voucher_entries_ledger_voucher_idx").on(t.ledgerAccountId, t.voucherId),
  })
);

export const insertVoucherEntrySchema = createInsertSchema(voucherEntries)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    voucherId: z.number().min(1, "Voucher is required"),
    ledgerAccountId: z.number().optional(),
    bankAccountId: z.number().optional(),
    fixedAssetId: z.number().optional(),
    supplierId: z.number().optional(),
    employeeId: z.number().optional(),
    customerId: z.number().optional(),
    factorySupplierId: z.number().optional(),
    debitAmount: z.string().optional(),
    creditAmount: z.string().optional(),
  });

export type InsertVoucherEntry = z.infer<typeof insertVoucherEntrySchema>;
export type VoucherEntry = typeof voucherEntries.$inferSelect;

export const creditNoteItems = pgTable("credit_note_items", {
  id: serial("id").primaryKey(),
  voucherId: integer("voucher_id")
    .notNull()
    .references(() => vouchers.id, { onDelete: "cascade" }),
  stockItemId: integer("stock_item_id")
    .notNull()
    .references(() => stockItems.id, { onDelete: "restrict" }),
  locationId: integer("location_id")
    .notNull()
    .references(() => locations.id, { onDelete: "restrict" }),
  quantity: decimal("quantity", { precision: 15, scale: 3 }).notNull(),
  rate: decimal("rate", { precision: 20, scale: 2 }).notNull(),
  inventoryCost: decimal("inventory_cost", { precision: 20, scale: 2 }).notNull().default("0"),
  totalValue: decimal("total_value", { precision: 20, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCreditNoteItemSchema = createInsertSchema(creditNoteItems)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    voucherId: z.number().min(1, "Voucher is required"),
    stockItemId: z.number().min(1, "Stock item is required"),
    locationId: z.number().min(1, "Location is required"),
    quantity: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Quantity must be positive"),
    rate: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Rate must be non-negative"),
    totalValue: z.string(),
  });

export type InsertCreditNoteItem = z.infer<typeof insertCreditNoteItemSchema>;
export type CreditNoteItem = typeof creditNoteItems.$inferSelect;

export const fiscalPeriodClosures = pgTable(
  "fiscal_period_closures",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    periodStartDate: date("period_start_date").notNull(),
    periodEndDate: date("period_end_date").notNull(),
    closureDate: timestamp("closure_date").notNull().defaultNow(),
    closedByUserId: varchar("closed_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    closingVoucherId: integer("closing_voucher_id")
      .notNull()
      .unique()
      .references(() => vouchers.id, { onDelete: "restrict" }),
    retainedEarningsAccountId: integer("retained_earnings_account_id")
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: "restrict" }),
    totalIncome: decimal("total_income", { precision: 15, scale: 2 }).notNull(),
    totalExpense: decimal("total_expense", { precision: 15, scale: 2 }).notNull(),
    netIncome: decimal("net_income", { precision: 15, scale: 2 }).notNull(),
    status: text("status").notNull().default("CLOSED"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueCompanyPeriod: uniqueIndex("fiscal_closures_company_period_unique").on(t.companyId, t.periodEndDate),
  })
);

export const insertFiscalPeriodClosureSchema = createInsertSchema(fiscalPeriodClosures)
  .omit({
    id: true,
    createdAt: true,
    closureDate: true,
  })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    periodStartDate: z.string().min(1, "Period start date is required"),
    periodEndDate: z.string().min(1, "Period end date is required"),
    closedByUserId: z.string().min(1, "User is required"),
    closingVoucherId: z.number().min(1, "Closing voucher is required"),
    retainedEarningsAccountId: z.number().min(1, "Retained earnings account is required"),
    totalIncome: z.string(),
    totalExpense: z.string(),
    netIncome: z.string(),
    status: z.enum(["CLOSED", "REOPENED"]).optional(),
    notes: z.string().optional(),
  });

export type InsertFiscalPeriodClosure = z.infer<typeof insertFiscalPeriodClosureSchema>;
export type FiscalPeriodClosure = typeof fiscalPeriodClosures.$inferSelect;

export const stockTransferVouchers = pgTable("stock_transfer_vouchers", {
  id: serial("id").primaryKey(),
  voucherId: integer("voucher_id")
    .notNull()
    .references(() => vouchers.id, { onDelete: "restrict" }),
  sourceLocationId: integer("source_location_id").references(() => locations.id, { onDelete: "restrict" }),
  destinationLocationId: integer("destination_location_id")
    .notNull()
    .references(() => locations.id, { onDelete: "restrict" }),
  notes: text("notes"),
  inventoryApplied: boolean("inventory_applied").default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertStockTransferVoucherSchema = createInsertSchema(stockTransferVouchers)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    voucherId: z.number().min(1, "Voucher is required"),
    sourceLocationId: z.number().optional(),
    destinationLocationId: z.number().min(1, "Destination location is required"),
  });

export type InsertStockTransferVoucher = z.infer<typeof insertStockTransferVoucherSchema>;
export type StockTransferVoucher = typeof stockTransferVouchers.$inferSelect;

export const stockTransferItems = pgTable("stock_transfer_items", {
  id: serial("id").primaryKey(),
  transferId: integer("transfer_id")
    .notNull()
    .references(() => stockTransferVouchers.id, { onDelete: "restrict" }),
  stockItemId: integer("stock_item_id")
    .notNull()
    .references(() => stockItems.id, { onDelete: "restrict" }),
  sourceLocationId: integer("source_location_id").references(() => locations.id, { onDelete: "restrict" }),
  quantity: decimal("quantity", { precision: 15, scale: 3 }).notNull(),
  rate: decimal("rate", { precision: 15, scale: 2 }).notNull(),
  totalAmount: decimal("total_amount", { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertStockTransferItemSchema = createInsertSchema(stockTransferItems)
  .omit({
    id: true,
    createdAt: true,
    totalAmount: true,
  })
  .extend({
    transferId: z.number().min(1, "Transfer is required"),
    stockItemId: z.number().min(1, "Stock item is required"),
    quantity: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Quantity must be positive"),
    rate: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Rate must be non-negative"),
  });

export type InsertStockTransferItem = z.infer<typeof insertStockTransferItemSchema>;
export type StockTransferItem = typeof stockTransferItems.$inferSelect;

export const stockAdjustmentVouchers = pgTable("stock_adjustment_vouchers", {
  id: serial("id").primaryKey(),
  voucherId: integer("voucher_id")
    .notNull()
    .references(() => vouchers.id, { onDelete: "cascade" }),
  locationId: integer("location_id")
    .notNull()
    .references(() => locations.id, { onDelete: "restrict" }),
  adjustmentType: text("adjustment_type").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertStockAdjustmentVoucherSchema = createInsertSchema(stockAdjustmentVouchers)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    voucherId: z.number().min(1, "Voucher is required"),
    locationId: z.number().min(1, "Location is required"),
    adjustmentType: z.enum(["Production", "Consumption", "Mixed"]),
  });

export type InsertStockAdjustmentVoucher = z.infer<typeof insertStockAdjustmentVoucherSchema>;
export type StockAdjustmentVoucher = typeof stockAdjustmentVouchers.$inferSelect;

export const stockAdjustmentItems = pgTable("stock_adjustment_items", {
  id: serial("id").primaryKey(),
  adjustmentId: integer("adjustment_id")
    .notNull()
    .references(() => stockAdjustmentVouchers.id, { onDelete: "cascade" }),
  stockItemId: integer("stock_item_id")
    .notNull()
    .references(() => stockItems.id, { onDelete: "restrict" }),
  quantity: decimal("quantity", { precision: 15, scale: 3 }).notNull(),
  rate: decimal("rate", { precision: 15, scale: 2 }).notNull(),
  totalAmount: decimal("total_amount", { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertStockAdjustmentItemSchema = createInsertSchema(stockAdjustmentItems)
  .omit({
    id: true,
    createdAt: true,
    totalAmount: true,
  })
  .extend({
    adjustmentId: z.number().min(1, "Adjustment is required"),
    stockItemId: z.number().min(1, "Stock item is required"),
    quantity: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) !== 0, "Quantity cannot be zero"),
    rate: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Rate must be non-negative"),
  });

export type InsertStockAdjustmentItem = z.infer<typeof insertStockAdjustmentItemSchema>;
export type StockAdjustmentItem = typeof stockAdjustmentItems.$inferSelect;

export const stockTransferRevisions = pgTable("stock_transfer_revisions", {
  id: serial("id").primaryKey(),
  transferId: integer("transfer_id").notNull(),
  revisionNumber: integer("revision_number").notNull(),
  note: text("note"),
  optional: boolean("optional").default(false).notNull(),
  revisionDate: timestamp("revision_date").notNull().defaultNow(),
  createdBy: varchar("created_by"),
});

export const stockTransferRevisionItems = pgTable("stock_transfer_revision_items", {
  id: serial("id").primaryKey(),
  revisionId: integer("revision_id").notNull(),
  stockItemId: integer("stock_item_id")
    .notNull()
    .references(() => stockItems.id, { onDelete: "restrict" }),
  stockItemName: text("stock_item_name").notNull(),
  sourceLocationId: integer("source_location_id").references(() => locations.id, { onDelete: "restrict" }),
  sourceLocationName: text("source_location_name"),
  originalQuantity: decimal("original_quantity", { precision: 15, scale: 3 }).notNull(),
  delta: decimal("delta", { precision: 15, scale: 3 }).notNull(),
  newQuantity: decimal("new_quantity", { precision: 15, scale: 3 }).notNull(),
});

export type StockTransferRevision = typeof stockTransferRevisions.$inferSelect;
export type StockTransferRevisionItem = typeof stockTransferRevisionItems.$inferSelect;

export const updateStockTransferItemSchema = z.object({
  sourceLocationId: z.coerce.number().int().positive("Source location must be a positive integer"),
  stockItemId: z.coerce.number().int().positive("Stock item must be a positive integer"),
  quantity: z.coerce
    .number()
    .finite("Quantity must be a finite number")
    .refine((val) => val !== 0, "Quantity cannot be zero"),
  rate: z.coerce.number().nonnegative("Rate must be non-negative").finite("Rate must be a finite number"),
});

export const updateStockTransferSchema = z.object({
  destinationLocationId: z.coerce.number().int().positive("Destination location must be a positive integer"),
  notes: z.string().optional(),
  items: z.array(updateStockTransferItemSchema).min(1, "At least one item is required"),
});

export type UpdateStockTransfer = z.infer<typeof updateStockTransferSchema>;

export const updateStockAdjustmentItemSchema = z.object({
  stockItemId: z.coerce.number().int().positive("Stock item must be a positive integer"),
  quantity: z.coerce
    .number()
    .finite("Quantity must be a finite number")
    .refine((val) => val !== 0, "Quantity cannot be zero"),
  rate: z.coerce.number().nonnegative("Rate must be non-negative").finite("Rate must be a finite number"),
});

export const updateStockAdjustmentSchema = z.object({
  locationId: z.coerce.number().int().positive("Location must be a positive integer"),
  adjustmentType: z.enum(["Production", "Consumption", "Mixed"]),
  notes: z.string().optional(),
  items: z.array(updateStockAdjustmentItemSchema).min(1, "At least one item is required"),
});

export type UpdateStockAdjustment = z.infer<typeof updateStockAdjustmentSchema>;

export const salesItems = pgTable("sales_items", {
  id: serial("id").primaryKey(),
  voucherId: integer("voucher_id")
    .notNull()
    .references(() => vouchers.id, { onDelete: "cascade" }),
  stockItemId: integer("stock_item_id")
    .notNull()
    .references(() => stockItems.id, { onDelete: "restrict" }),
  quantity: decimal("quantity", { precision: 15, scale: 3 }).notNull(),
  sellingPrice: decimal("selling_price", { precision: 15, scale: 6 }).notNull(),
  costPrice: decimal("cost_price", { precision: 15, scale: 2 }).notNull(),
  totalSales: decimal("total_sales", { precision: 15, scale: 2 }).notNull(),
  totalCost: decimal("total_cost", { precision: 15, scale: 2 }).notNull(),
  profit: decimal("profit", { precision: 15, scale: 2 }).notNull(),
  configuredPrice: decimal("configured_price", { precision: 15, scale: 6 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSalesItemSchema = createInsertSchema(salesItems)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    voucherId: z.number().min(1, "Voucher is required"),
    stockItemId: z.number().min(1, "Stock item is required"),
    quantity: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Quantity must be positive"),
    sellingPrice: z
      .string()
      .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Selling price must be non-negative"),
    costPrice: z
      .string()
      .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Cost price must be non-negative"),
    totalSales: z.string(),
    totalCost: z.string(),
    profit: z.string(),
  });

export type InsertSalesItem = z.infer<typeof insertSalesItemSchema>;
export type SalesItem = typeof salesItems.$inferSelect;

export const employeeBaleRates = pgTable(
  "employee_bale_rates",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    locationId: integer("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    rate: decimal("rate", { precision: 10, scale: 4 }).notNull(),
    sourceCompanyId: integer("source_company_id"),
  },
  (t) => ({
    companyIdx: index("employee_bale_rates_company_idx").on(t.companyId),
  })
);
export type EmployeeBaleRate = typeof employeeBaleRates.$inferSelect;

export const employeeBalePctRates = pgTable(
  "employee_bale_pct_rates",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    locationId: integer("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    pct: decimal("pct", { precision: 10, scale: 4 }).notNull(),
    sourceCompanyId: integer("source_company_id"),
  },
  (t) => ({
    companyIdx: index("employee_bale_pct_rates_company_idx").on(t.companyId),
  })
);
export type EmployeeBalePctRate = typeof employeeBalePctRates.$inferSelect;

export const containerSales = pgTable(
  "container_sales",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    containerId: integer("container_id").notNull(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    saleDate: date("sale_date").notNull(),
    containerCost: decimal("container_cost", { precision: 15, scale: 2 }).notNull(),
    commission: decimal("commission", { precision: 15, scale: 2 }).notNull(),
    commissionAccountId: integer("commission_account_id"),
    totalAmount: decimal("total_amount", { precision: 15, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("USD"),
    invoiceNumber: varchar("invoice_number", { length: 100 }),
    paymentStatus: text("payment_status").notNull().default("PENDING"),
    paidAmount: decimal("paid_amount", { precision: 20, scale: 2 }).notNull().default("0"),
    voucherId: integer("voucher_id").references(() => vouchers.id, { onDelete: "restrict" }),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueCompanyContainer: uniqueIndex("container_sales_company_container_unique").on(t.companyId, t.containerId),
  })
);

export const insertContainerSaleSchema = createInsertSchema(containerSales)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    containerId: z.number().min(1, "Container is required"),
    customerId: z.number().min(1, "Customer is required"),
    saleDate: z.string().min(1, "Sale date is required"),
    containerCost: z
      .string()
      .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Container cost must be non-negative"),
    commission: z
      .string()
      .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Commission must be non-negative"),
    commissionAccountId: z.number().optional(),
    totalAmount: z
      .string()
      .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Total amount must be positive"),
    currency: z.string().min(1).default("USD"),
    invoiceNumber: z.string().optional(),
    paymentStatus: z.enum(["PENDING", "PARTIAL", "PAID"]).optional(),
    paidAmount: z.string().optional(),
    voucherId: z.number().optional(),
  });

export type InsertContainerSale = z.infer<typeof insertContainerSaleSchema>;
export type ContainerSale = typeof containerSales.$inferSelect;

export const interCompanyTransfers = pgTable("inter_company_transfers", {
  id: serial("id").primaryKey(),
  transferType: text("transfer_type").notNull(),
  fromCompanyId: integer("from_company_id").notNull(),
  toCompanyId: integer("to_company_id").notNull(),
  transferDate: date("transfer_date").notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  fromLedgerAccountId: integer("from_ledger_account_id").notNull(),
  toLedgerAccountId: integer("to_ledger_account_id").notNull(),
  fromVoucherId: integer("from_voucher_id").references(() => vouchers.id, { onDelete: "restrict" }),
  toVoucherId: integer("to_voucher_id").references(() => vouchers.id, { onDelete: "restrict" }),
  description: text("description"),
  sourcePaymentId: integer("source_payment_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertInterCompanyTransferSchema = createInsertSchema(interCompanyTransfers)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    transferType: z.enum(["Cash", "Loan"]),
    fromCompanyId: z.number().min(1, "From company is required"),
    toCompanyId: z.number().min(1, "To company is required"),
    transferDate: z.string().min(1, "Transfer date is required"),
    amount: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Amount must be positive"),
    fromLedgerAccountId: z.number().min(1, "From account is required"),
    toLedgerAccountId: z.number().min(1, "To account is required"),
  });

export type InsertInterCompanyTransfer = z.infer<typeof insertInterCompanyTransferSchema>;
export type InterCompanyTransfer = typeof interCompanyTransfers.$inferSelect;

export const intercompanyPosConfigs = pgTable("intercompany_pos_configs", {
  id: serial("id").primaryKey(),
  sourceCompanyId: integer("source_company_id").notNull().unique(),
  destCompanyId: integer("dest_company_id").notNull(),
  sourceIntercoAccountId: integer("source_interco_account_id").notNull(),
  destIntercoAccountId: integer("dest_interco_account_id").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  skipSourceVoucher: boolean("skip_source_voucher").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type IntercompanyPosConfig = typeof intercompanyPosConfigs.$inferSelect;

export const intercompanyAccountLinks = pgTable("intercompany_account_links", {
  id: serial("id").primaryKey(),
  label: text("label"),
  sourceCompanyId: integer("source_company_id").notNull(),
  sourceLedgerAccountId: integer("source_ledger_account_id").notNull(),
  destCompanyId: integer("dest_company_id").notNull(),
  destLedgerAccountId: integer("dest_ledger_account_id").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type IntercompanyAccountLink = typeof intercompanyAccountLinks.$inferSelect;
export const insertIntercompanyAccountLinkSchema = createInsertSchema(intercompanyAccountLinks).omit({
  id: true,
  createdAt: true,
});
export type InsertIntercompanyAccountLink = z.infer<typeof insertIntercompanyAccountLinkSchema>;

export const intercompanyLinkRecipients = pgTable("intercompany_link_recipients", {
  id: serial("id").primaryKey(),
  linkId: integer("link_id").notNull(),
  userId: varchar("user_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type IntercompanyLinkRecipient = typeof intercompanyLinkRecipients.$inferSelect;

export const intercompanyPaymentRequests = pgTable("intercompany_payment_requests", {
  id: serial("id").primaryKey(),
  linkId: integer("link_id").notNull(),
  fromCompanyId: integer("from_company_id").notNull(),
  fromVoucherId: integer("from_voucher_id").notNull(),
  fromVoucherNumber: text("from_voucher_number").notNull(),
  fromVoucherDate: date("from_voucher_date").notNull(),
  amount: decimal("amount", { precision: 20, scale: 2 }).notNull(),
  description: text("description"),
  status: text("status").notNull().default("pending"),
  destLedgerAccountId: integer("dest_ledger_account_id"),
  destVoucherId: integer("dest_voucher_id"),
  approvedByUserId: varchar("approved_by_user_id"),
  approvedAt: timestamp("approved_at"),
  dismissNote: text("dismiss_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type IntercompanyPaymentRequest = typeof intercompanyPaymentRequests.$inferSelect;

export const salaryAdvances = pgTable(
  "salary_advances",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    advanceDate: date("advance_date").notNull(),
    amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
    remainingBalance: decimal("remaining_balance", { precision: 15, scale: 2 }).notNull(),
    voucherId: integer("voucher_id").references(() => vouchers.id, { onDelete: "restrict" }),
    notes: text("notes"),
    fullyPaid: boolean("fully_paid").notNull().default(false),
    isOpeningBalance: boolean("is_opening_balance").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("salary_advances_company_idx").on(t.companyId),
  })
);

export const insertSalaryAdvanceSchema = createInsertSchema(salaryAdvances)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    employeeId: z.number().min(1, "Employee is required"),
    advanceDate: z.string().min(1, "Advance date is required"),
    amount: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Amount must be positive"),
    remainingBalance: z
      .string()
      .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Remaining balance must be non-negative"),
    isOpeningBalance: z.boolean().optional().default(false),
  });

export type InsertSalaryAdvance = z.infer<typeof insertSalaryAdvanceSchema>;
export type SalaryAdvance = typeof salaryAdvances.$inferSelect;

export const salaryAdvanceDeductions = pgTable("salary_advance_deductions", {
  id: serial("id").primaryKey(),
  salaryAdvanceId: integer("salary_advance_id")
    .notNull()
    .references(() => salaryAdvances.id, { onDelete: "cascade" }),
  payrollMonth: text("payroll_month").notNull(),
  deductionAmount: decimal("deduction_amount", { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSalaryAdvanceDeductionSchema = createInsertSchema(salaryAdvanceDeductions)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    salaryAdvanceId: z.number().min(1, "Salary advance is required"),
    payrollMonth: z.string().min(1, "Payroll month is required"),
    deductionAmount: z
      .string()
      .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Deduction amount must be positive"),
  });

export type InsertSalaryAdvanceDeduction = z.infer<typeof insertSalaryAdvanceDeductionSchema>;
export type SalaryAdvanceDeduction = typeof salaryAdvanceDeductions.$inferSelect;

export const dashboardCashAccounts = pgTable(
  "dashboard_cash_accounts",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    accountType: text("account_type").notNull(),
    accountId: integer("account_id").notNull(),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("dashboard_cash_accounts_company_idx").on(t.companyId),
  })
);

export const insertDashboardCashAccountSchema = createInsertSchema(dashboardCashAccounts)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    accountType: z.string().min(1),
    accountId: z.number().min(1, "Account is required"),
    displayOrder: z.number().optional(),
  });

export type InsertDashboardCashAccount = z.infer<typeof insertDashboardCashAccountSchema>;
export type DashboardCashAccount = typeof dashboardCashAccounts.$inferSelect;

export const dashboardPayableAccounts = pgTable(
  "dashboard_payable_accounts",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    accountId: integer("account_id").notNull(),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("dashboard_payable_accounts_company_idx").on(t.companyId),
  })
);

export const insertDashboardPayableAccountSchema = createInsertSchema(dashboardPayableAccounts)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    accountId: z.number().min(1, "Account is required"),
    displayOrder: z.number().optional(),
  });

export type InsertDashboardPayableAccount = z.infer<typeof insertDashboardPayableAccountSchema>;
export type DashboardPayableAccount = typeof dashboardPayableAccounts.$inferSelect;

export const customerBalances = pgTable(
  "customer_balances",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    transactionDate: date("transaction_date").notNull(),
    transactionType: text("transaction_type").notNull(),
    referenceId: integer("reference_id"),
    referenceType: text("reference_type"),
    debitAmount: decimal("debit_amount", { precision: 20, scale: 2 }).notNull().default("0"),
    creditAmount: decimal("credit_amount", { precision: 20, scale: 2 }).notNull().default("0"),
    balance: decimal("balance", { precision: 20, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("USD"),
    description: text("description"),
    rowNote: text("row_note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("customer_balances_company_idx").on(t.companyId),
    customerCompanyIdx: index("customer_balances_customer_company_idx").on(t.customerId, t.companyId),
  })
);

export const insertCustomerBalanceSchema = createInsertSchema(customerBalances)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    customerId: z.number().min(1, "Customer is required"),
    transactionDate: z.string().min(1, "Transaction date is required"),
    transactionType: z.enum(["SALE", "PAYMENT", "ADJUSTMENT"]),
    referenceId: z.number().optional(),
    referenceType: z.string().optional(),
    debitAmount: z.string().optional(),
    creditAmount: z.string().optional(),
    balance: z.string().refine((val) => !isNaN(parseFloat(val)), "Balance must be a valid number"),
    currency: z.string().min(1).default("USD"),
    description: z.string().optional(),
  });

export type InsertCustomerBalance = z.infer<typeof insertCustomerBalanceSchema>;
export type CustomerBalance = typeof customerBalances.$inferSelect;

export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id"),
  userId: varchar("user_id"),
  role: text("role"),
  content: text("content"),
  sessionId: varchar("session_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const aiActionLog = pgTable(
  "ai_action_log",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    userId: varchar("user_id").notNull(),
    sessionId: varchar("session_id"),
    prompt: text("prompt"),
    draftJson: jsonb("draft_json"),
    actionType: varchar("action_type", { length: 80 }),
    actionName: varchar("action_name", { length: 120 }),
    inputJson: jsonb("input_json"),
    outputJson: jsonb("output_json"),
    createdRecordId: integer("created_record_id"),
    status: varchar("status", { length: 20 }).default("confirmed"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("ai_action_log_company_idx").on(t.companyId),
    userIdx: index("ai_action_log_user_idx").on(t.userId),
  })
);
export type AiActionLog = typeof aiActionLog.$inferSelect;

export const aiImportJobs = pgTable(
  "ai_import_jobs",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    userId: varchar("user_id").notNull(),
    importType: text("import_type").notNull(),
    originalFileName: text("original_file_name"),
    status: text("status").notNull().default("uploaded"),
    totalRows: integer("total_rows").default(0),
    validRows: integer("valid_rows").default(0),
    warningRows: integer("warning_rows").default(0),
    errorRows: integer("error_rows").default(0),
    confirmedAt: timestamp("confirmed_at"),
    postedAt: timestamp("posted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("ai_import_jobs_company_idx").on(t.companyId),
    userIdx: index("ai_import_jobs_user_idx").on(t.userId),
  })
);
export const insertAiImportJobSchema = createInsertSchema(aiImportJobs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiImportJob = z.infer<typeof insertAiImportJobSchema>;
export type AiImportJob = typeof aiImportJobs.$inferSelect;

export const aiImportRows = pgTable(
  "ai_import_rows",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id").notNull(),
    rowNumber: integer("row_number").notNull(),
    rawData: jsonb("raw_data").notNull(),
    mappedData: jsonb("mapped_data"),
    status: text("status").notNull().default("pending"),
    errors: jsonb("errors").default([]),
    warnings: jsonb("warnings").default([]),
    createdRecordType: text("created_record_type"),
    createdRecordId: integer("created_record_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    jobIdx: index("ai_import_rows_job_idx").on(t.jobId),
  })
);
export const insertAiImportRowSchema = createInsertSchema(aiImportRows).omit({ id: true, createdAt: true });
export type InsertAiImportRow = z.infer<typeof insertAiImportRowSchema>;
export type AiImportRow = typeof aiImportRows.$inferSelect;

export const aiCorrectionMemory = pgTable(
  "ai_correction_memory",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    memoryType: varchar("memory_type", { length: 40 }).notNull(),
    rawValue: text("raw_value").notNull(),
    resolvedType: text("resolved_type"),
    resolvedId: integer("resolved_id"),
    resolvedValue: text("resolved_value"),
    confidence: integer("confidence").notNull().default(100),
    createdBy: varchar("created_by").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("ai_correction_memory_company_idx").on(t.companyId),
    lookupIdx: index("ai_correction_memory_lookup_idx").on(t.companyId, t.memoryType),
  })
);
export const insertAiCorrectionMemorySchema = createInsertSchema(aiCorrectionMemory).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiCorrectionMemory = z.infer<typeof insertAiCorrectionMemorySchema>;
export type AiCorrectionMemory = typeof aiCorrectionMemory.$inferSelect;

export const dashboardAccountSelections = pgTable(
  "dashboard_account_selections",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    selectionType: text("selection_type").notNull(),
    accountIds: integer("account_ids").array().notNull().default([]),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueCompanyType: uniqueIndex("dashboard_account_selections_company_type_unique").on(t.companyId, t.selectionType),
  })
);

export const insertDashboardAccountSelectionSchema = createInsertSchema(dashboardAccountSelections)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    selectionType: z.enum(["availableCash", "cashToPay"]),
    accountIds: z.array(z.number()).default([]),
  });

export type InsertDashboardAccountSelection = z.infer<typeof insertDashboardAccountSelectionSchema>;
export type DashboardAccountSelection = typeof dashboardAccountSelections.$inferSelect;

export const referenceSequences = pgTable(
  "reference_sequences",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    nextNumber: integer("next_number").notNull().default(1),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueCompanyId: uniqueIndex("reference_sequences_company_unique").on(t.companyId),
  })
);

export type ReferenceSequence = typeof referenceSequences.$inferSelect;

export const baleLabelPrints = pgTable(
  "bale_label_prints",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    productionBaleId: integer("production_bale_id"),
    productId: integer("product_id"),
    articleCode: varchar("article_code", { length: 50 }).notNull(),
    referenceNumber: varchar("reference_number", { length: 100 }).notNull(),
    pieces: integer("pieces").notNull().default(1),
    approxWeightKg: decimal("approx_weight_kg", { precision: 15, scale: 3 }).notNull(),
    printedByUserId: varchar("printed_by_user_id"),
    printedAt: timestamp("printed_at").notNull().defaultNow(),
    scannedByUserId: varchar("scanned_by_user_id"),
    scannedAt: timestamp("scanned_at"),
    customerLogoId: integer("customer_logo_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueReference: uniqueIndex("bale_label_prints_reference_unique").on(t.companyId, t.referenceNumber),
  })
);

export const insertBaleLabelPrintSchema = createInsertSchema(baleLabelPrints)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    productionBaleId: z.number().optional(),
    productId: z.number().optional(),
    articleCode: z.string().min(1, "Article code is required"),
    referenceNumber: z.string().min(1, "Reference number is required"),
    pieces: z.number().min(1, "Pieces must be at least 1"),
    approxWeightKg: z
      .string()
      .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Weight must be positive"),
    printedByUserId: z.string().optional(),
    printedAt: z.date().optional(),
    scannedByUserId: z.string().optional(),
    scannedAt: z.date().optional(),
    customerLogoId: z.number().optional(),
  });

export type InsertBaleLabelPrint = z.infer<typeof insertBaleLabelPrintSchema>;
export type BaleLabelPrint = typeof baleLabelPrints.$inferSelect;

export const customerLogos = pgTable(
  "customer_logos",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    filePath: varchar("file_path", { length: 500 }).notNull(),
    mimeType: varchar("mime_type", { length: 50 }).notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("customer_logos_company_idx").on(t.companyId),
  })
);

export const insertCustomerLogoSchema = createInsertSchema(customerLogos).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCustomerLogo = z.infer<typeof insertCustomerLogoSchema>;
export type CustomerLogo = typeof customerLogos.$inferSelect;

export const erpUserPageAccess = pgTable(
  "erp_user_page_access",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    userId: varchar("user_id").notNull(),
    pageKey: text("page_key").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueCompanyUserPage: uniqueIndex("erp_user_page_access_unique").on(t.companyId, t.userId, t.pageKey),
  })
);

export const insertErpUserPageAccessSchema = createInsertSchema(erpUserPageAccess).omit({ id: true, createdAt: true });
export type InsertErpUserPageAccess = z.infer<typeof insertErpUserPageAccessSchema>;
export type ErpUserPageAccess = typeof erpUserPageAccess.$inferSelect;

export const supplierProformas = pgTable(
  "supplier_proformas",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    supplierId: integer("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "restrict" }),
    reference: varchar("reference", { length: 200 }).notNull(),
    notes: text("notes"),
    isStarred: boolean("is_starred").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("supplier_proformas_company_idx").on(t.companyId),
  })
);

export const insertSupplierProformaSchema = createInsertSchema(supplierProformas)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    companyId: z.number().min(1),
    supplierId: z.number().min(1),
    reference: z.string().min(1, "Reference is required"),
    notes: z.string().optional(),
  });

export type InsertSupplierProforma = z.infer<typeof insertSupplierProformaSchema>;
export type SupplierProforma = typeof supplierProformas.$inferSelect;

export const supplierProformaLines = pgTable("supplier_proforma_lines", {
  id: serial("id").primaryKey(),
  proformaId: integer("proforma_id").notNull(),
  barcode: varchar("barcode", { length: 200 }).notNull(),
  itemName: text("item_name").notNull(),
  qty: integer("qty").notNull().default(0),
  weightPerBale: decimal("weight_per_bale", { precision: 15, scale: 3 }).default("0"),
  pricePerBale: decimal("price_per_bale", { precision: 15, scale: 2 }).default("0"),
});

export const insertSupplierProformaLineSchema = createInsertSchema(supplierProformaLines)
  .omit({ id: true })
  .extend({
    proformaId: z.number().min(1),
    barcode: z.string().min(1, "Barcode is required"),
    itemName: z.string().min(1, "Item name is required"),
    qty: z.number().min(0),
    weightPerBale: z.string().optional(),
    pricePerBale: z.string().optional(),
  });

export type InsertSupplierProformaLine = z.infer<typeof insertSupplierProformaLineSchema>;
export type SupplierProformaLine = typeof supplierProformaLines.$inferSelect;

export const supplierContainerLoadedItems = pgTable("supplier_container_loaded_items", {
  id: serial("id").primaryKey(),
  containerId: integer("container_id").notNull(),
  barcode: varchar("barcode", { length: 200 }).notNull(),
  itemName: text("item_name"),
  qty: integer("qty").notNull().default(0),
  weightPerBale: decimal("weight_per_bale", { precision: 15, scale: 3 }),
  pricePerBale: decimal("price_per_bale", { precision: 15, scale: 2 }),
});

export const insertSupplierContainerLoadedItemSchema = createInsertSchema(supplierContainerLoadedItems)
  .omit({ id: true })
  .extend({
    containerId: z.number().min(1),
    barcode: z.string().min(1, "Barcode is required"),
    itemName: z.string().optional(),
    qty: z.number().min(0),
    weightPerBale: z.string().optional(),
    pricePerBale: z.string().optional(),
  });

export type InsertSupplierContainerLoadedItem = z.infer<typeof insertSupplierContainerLoadedItemSchema>;
export type SupplierContainerLoadedItem = typeof supplierContainerLoadedItems.$inferSelect;

export const fileFolders = pgTable(
  "file_folders",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("file_folders_company_idx").on(t.companyId),
  })
);
export const insertFileFolderSchema = createInsertSchema(fileFolders).omit({ id: true, createdAt: true });
export type InsertFileFolder = z.infer<typeof insertFileFolderSchema>;
export type FileFolder = typeof fileFolders.$inferSelect;

export const storedFiles = pgTable(
  "stored_files",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    folderId: integer("folder_id"),
    fileName: text("file_name").notNull(),
    displayName: text("display_name"),
    fileType: text("file_type").notNull(),
    fileSize: integer("file_size").notNull(),
    fileData: text("file_data").notNull(),
    description: text("description"),
    uploadedBy: varchar("uploaded_by"),
    uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("stored_files_company_idx").on(t.companyId),
  })
);

export const insertStoredFileSchema = createInsertSchema(storedFiles)
  .omit({ id: true, uploadedAt: true })
  .extend({
    companyId: z.number().min(1),
    fileName: z.string().min(1),
    fileType: z.string().min(1),
    fileSize: z.number().min(0),
    fileData: z.string().min(1),
    description: z.string().optional(),
    uploadedBy: z.string().optional().nullable(),
    folderId: z.number().optional().nullable(),
    displayName: z.string().optional().nullable(),
  });

export type InsertStoredFile = z.infer<typeof insertStoredFileSchema>;
export type StoredFile = typeof storedFiles.$inferSelect;

export const spreadsheets = pgTable(
  "spreadsheets",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    name: text("name").notNull().default("Untitled Spreadsheet"),
    data: jsonb("data").notNull().default([]),
    createdBy: text("created_by"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("spreadsheets_company_idx").on(t.companyId),
  })
);

export const insertSpreadsheetSchema = createInsertSchema(spreadsheets)
  .omit({ id: true, updatedAt: true })
  .extend({
    companyId: z.number().min(1),
    name: z.string().min(1).default("Untitled Spreadsheet"),
    data: z.any().default([]),
    createdBy: z.string().optional(),
  });

export type InsertSpreadsheet = z.infer<typeof insertSpreadsheetSchema>;
export type Spreadsheet = typeof spreadsheets.$inferSelect;

export const liveSpreadsheets = pgTable(
  "live_spreadsheets",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    name: text("name").notNull(),
    url: text("url").notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("live_spreadsheets_company_idx").on(t.companyId),
  })
);

export const insertLiveSpreadsheetSchema = createInsertSchema(liveSpreadsheets)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    companyId: z.number().min(1),
    name: z.string().min(1, "Name is required"),
    url: z.string().url("Must be a valid URL"),
    description: z.string().optional(),
    isActive: z.boolean().default(true),
  });

export type InsertLiveSpreadsheet = z.infer<typeof insertLiveSpreadsheetSchema>;
export type LiveSpreadsheet = typeof liveSpreadsheets.$inferSelect;

export const erpWorkerDocs = pgTable(
  "erp_worker_docs",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    fileName: text("file_name").notNull(),
    fileType: text("file_type").notNull(),
    fileSize: integer("file_size").notNull(),
    fileData: text("file_data").notNull(),
    description: text("description"),
    uploadedBy: text("uploaded_by"),
    uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("erp_worker_docs_company_idx").on(t.companyId),
  })
);

export const insertErpWorkerDocSchema = createInsertSchema(erpWorkerDocs)
  .omit({ id: true, uploadedAt: true })
  .extend({
    companyId: z.number().min(1),
    employeeId: z.number().min(1),
    fileName: z.string().min(1),
    fileType: z.string().min(1),
    fileSize: z.number().min(0),
    fileData: z.string().min(1),
    description: z.string().optional(),
    uploadedBy: z.string().optional(),
  });

export type InsertErpWorkerDoc = z.infer<typeof insertErpWorkerDocSchema>;
export type ErpWorkerDoc = typeof erpWorkerDocs.$inferSelect;

export const erpPayrollRuns = pgTable(
  "erp_payroll_runs",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    status: text("status").notNull().default("DRAFT"),
    date: text("date").notNull(),
    notes: text("notes"),
    paymentAccountId: integer("payment_account_id"),
    paidAt: text("paid_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => ({
    companyIdx: index("erp_payroll_runs_company_idx").on(t.companyId),
  })
);

export const insertErpPayrollRunSchema = createInsertSchema(erpPayrollRuns).omit({ id: true });
export type InsertErpPayrollRun = z.infer<typeof insertErpPayrollRunSchema>;
export type ErpPayrollRun = typeof erpPayrollRuns.$inferSelect;

export const erpPayrollRunItems = pgTable("erp_payroll_run_items", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull(),
  employeeId: integer("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "restrict" }),
  employeeName: text("employee_name").notNull(),
  groupName: text("group_name"),
  baseSalary: decimal("base_salary", { precision: 18, scale: 2 }).notNull(),
  deduction: decimal("deduction", { precision: 18, scale: 2 }).notNull().default("0"),
  netPay: decimal("net_pay", { precision: 18, scale: 2 }).notNull(),
});

export const insertErpPayrollRunItemSchema = createInsertSchema(erpPayrollRunItems).omit({ id: true });
export type InsertErpPayrollRunItem = z.infer<typeof insertErpPayrollRunItemSchema>;
export type ErpPayrollRunItem = typeof erpPayrollRunItems.$inferSelect;

export const wasteDispatches = pgTable(
  "waste_dispatches",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    locationId: integer("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    voucherId: integer("voucher_id").references(() => vouchers.id, { onDelete: "restrict" }),
    dispatchNumber: text("dispatch_number").notNull(),
    dispatchDate: date("dispatch_date").notNull(),
    notes: text("notes"),
    totalAmount: decimal("total_amount", { precision: 15, scale: 2 }).notNull().default("0"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("waste_dispatches_company_idx").on(t.companyId),
  })
);

export const insertWasteDispatchSchema = createInsertSchema(wasteDispatches).omit({ id: true, createdAt: true });
export type InsertWasteDispatch = z.infer<typeof insertWasteDispatchSchema>;
export type WasteDispatch = typeof wasteDispatches.$inferSelect;

export const wasteDispatchItems = pgTable("waste_dispatch_items", {
  id: serial("id").primaryKey(),
  dispatchId: integer("dispatch_id").notNull(),
  stockItemId: integer("stock_item_id")
    .notNull()
    .references(() => stockItems.id, { onDelete: "restrict" }),
  quantity: decimal("quantity", { precision: 15, scale: 3 }).notNull(),
  rate: decimal("rate", { precision: 15, scale: 2 }).notNull(),
  totalAmount: decimal("total_amount", { precision: 15, scale: 2 }).notNull(),
});

export const insertWasteDispatchItemSchema = createInsertSchema(wasteDispatchItems).omit({ id: true });
export type InsertWasteDispatchItem = z.infer<typeof insertWasteDispatchItemSchema>;
export type WasteDispatchItem = typeof wasteDispatchItems.$inferSelect;

export const agentAccounts = pgTable(
  "agent_accounts",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    accountId: varchar("account_id", { length: 50 }).notNull(),
    accountType: varchar("account_type", { length: 50 }).notNull(),
    accountName: varchar("account_name", { length: 300 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("agent_accounts_company_account_unique").on(t.companyId, t.accountId),
  })
);

export const insertAgentAccountSchema = createInsertSchema(agentAccounts).omit({ id: true, createdAt: true });
export type InsertAgentAccount = z.infer<typeof insertAgentAccountSchema>;
export type AgentAccount = typeof agentAccounts.$inferSelect;

export const freightAccounts = pgTable(
  "freight_accounts",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    accountId: varchar("account_id", { length: 50 }).notNull(),
    accountType: varchar("account_type", { length: 50 }).notNull(),
    accountName: varchar("account_name", { length: 300 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("freight_accounts_company_account_unique").on(t.companyId, t.accountId),
  })
);

export const insertFreightAccountSchema = createInsertSchema(freightAccounts).omit({ id: true, createdAt: true });
export type InsertFreightAccount = z.infer<typeof insertFreightAccountSchema>;
export type FreightAccount = typeof freightAccounts.$inferSelect;

export const snapshotPinnedAccounts = pgTable(
  "snapshot_pinned_accounts",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    cardKey: varchar("card_key", { length: 50 }).notNull(),
    accountId: varchar("account_id", { length: 50 }).notNull(),
    accountType: varchar("account_type", { length: 50 }).notNull(),
    accountName: varchar("account_name", { length: 300 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("snapshot_pinned_accounts_unique").on(t.companyId, t.cardKey, t.accountId),
  })
);

export const insertSnapshotPinnedAccountSchema = createInsertSchema(snapshotPinnedAccounts).omit({
  id: true,
  createdAt: true,
});
export type InsertSnapshotPinnedAccount = z.infer<typeof insertSnapshotPinnedAccountSchema>;
export type SnapshotPinnedAccount = typeof snapshotPinnedAccounts.$inferSelect;

export const proformaStockReservations = pgTable(
  "proforma_stock_reservations",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    proformaId: integer("proforma_id").notNull(),
    articleCode: varchar("article_code", { length: 50 }).notNull(),
    reservedQty: integer("reserved_qty").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("proforma_stock_reservations_unique").on(t.companyId, t.proformaId, t.articleCode),
  })
);

export const insertProformaStockReservationSchema = createInsertSchema(proformaStockReservations).omit({
  id: true,
  createdAt: true,
});
export type InsertProformaStockReservation = z.infer<typeof insertProformaStockReservationSchema>;
export type ProformaStockReservation = typeof proformaStockReservations.$inferSelect;

export const locationPriceGroups = pgTable(
  "location_price_groups",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    masterLocationId: integer("master_location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    followerLocationId: integer("follower_location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("location_price_groups_company_idx").on(t.companyId),
  })
);

export const insertLocationPriceGroupSchema = createInsertSchema(locationPriceGroups).omit({
  id: true,
  createdAt: true,
});
export type LocationPriceGroup = typeof locationPriceGroups.$inferSelect;
export type InsertLocationPriceGroup = z.infer<typeof insertLocationPriceGroupSchema>;

export const statusBuilderSheets = pgTable(
  "status_builder_sheets",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    name: text("name").notNull(),
    orderIndex: integer("order_index").notNull().default(0),
    columns: jsonb("columns").notNull().default([]),
    rows: jsonb("rows").notNull().default([]),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("status_builder_sheets_company_idx").on(t.companyId),
  })
);

export const insertStatusBuilderSheetSchema = createInsertSchema(statusBuilderSheets).omit({
  id: true,
  updatedAt: true,
});
export type StatusBuilderSheet = typeof statusBuilderSheets.$inferSelect;
export type InsertStatusBuilderSheet = z.infer<typeof insertStatusBuilderSheetSchema>;

export const statusReportTemplates = pgTable(
  "status_report_templates",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    name: text("name").notNull().default("Default Template"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("srtemplate_company_idx").on(t.companyId),
  })
);
export const insertStatusReportTemplateSchema = createInsertSchema(statusReportTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type StatusReportTemplate = typeof statusReportTemplates.$inferSelect;
export type InsertStatusReportTemplate = z.infer<typeof insertStatusReportTemplateSchema>;

export const statusMetrics = pgTable(
  "status_metrics",
  {
    id: serial("id").primaryKey(),
    templateId: integer("template_id").notNull(),
    name: text("name").notNull(),
    beforeSourceType: text("before_source_type").notNull().default("manual"),
    sourceType: text("source_type").notNull().default("manual"),
    sourceField: text("source_field").notNull().default("quantity"),
    operation: text("operation").notNull().default("sum"),
    filtersJson: jsonb("filters_json").default({}),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    templateIdx: index("smetric_template_idx").on(t.templateId),
  })
);
export const insertStatusMetricSchema = createInsertSchema(statusMetrics).omit({ id: true, createdAt: true });
export type StatusMetric = typeof statusMetrics.$inferSelect;
export type InsertStatusMetric = z.infer<typeof insertStatusMetricSchema>;

export const statusReportRuns = pgTable(
  "status_report_runs",
  {
    id: serial("id").primaryKey(),
    templateId: integer("template_id").notNull(),
    companyId: integer("company_id").notNull(),
    runDate: varchar("run_date", { length: 10 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueRun: uniqueIndex("srrun_unique").on(t.templateId, t.runDate),
    companyIdx: index("srrun_company_idx").on(t.companyId),
  })
);
export const insertStatusReportRunSchema = createInsertSchema(statusReportRuns).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type StatusReportRun = typeof statusReportRuns.$inferSelect;
export type InsertStatusReportRun = z.infer<typeof insertStatusReportRunSchema>;

export const statusMetricValues = pgTable(
  "status_metric_values",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id").notNull(),
    metricId: integer("metric_id").notNull(),
    beforeValue: decimal("before_value", { precision: 20, scale: 4 }).notNull().default("0"),
    linkedValue: decimal("linked_value", { precision: 20, scale: 4 }).notNull().default("0"),
    manualAdjustment: decimal("manual_adjustment", { precision: 20, scale: 4 }).notNull().default("0"),
    difference: decimal("difference", { precision: 20, scale: 4 }).notNull().default("0"),
    finalTotal: decimal("final_total", { precision: 20, scale: 4 }).notNull().default("0"),
    warningsJson: jsonb("warnings_json").default([]),
    lastRefreshed: timestamp("last_refreshed"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueRunMetric: uniqueIndex("smvalue_unique").on(t.runId, t.metricId),
    runIdx: index("smvalue_run_idx").on(t.runId),
  })
);
export const insertStatusMetricValueSchema = createInsertSchema(statusMetricValues).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type StatusMetricValue = typeof statusMetricValues.$inferSelect;
export type InsertStatusMetricValue = z.infer<typeof insertStatusMetricValueSchema>;

export const stockItemMergeLogs = pgTable(
  "stock_item_merge_logs",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    keptItemId: integer("kept_item_id").notNull(),
    keptItemCode: varchar("kept_item_code", { length: 50 }).notNull(),
    keptItemName: text("kept_item_name").notNull(),
    mergedItemId: integer("merged_item_id").notNull(),
    mergedItemCode: varchar("merged_item_code", { length: 50 }).notNull(),
    mergedItemName: text("merged_item_name").notNull(),
    snapshotBefore: jsonb("snapshot_before").notNull().$type<Record<string, unknown>>(),
    snapshotAfter: jsonb("snapshot_after").notNull().$type<Record<string, unknown>>(),
    mergedByUserId: integer("merged_by_user_id").notNull(),
    mergedAt: timestamp("merged_at").notNull().defaultNow(),
    notes: text("notes"),
  },
  (t) => ({
    companyIdx: index("stock_item_merge_logs_company_idx").on(t.companyId),
  })
);

export const insertStockItemMergeLogSchema = createInsertSchema(stockItemMergeLogs).omit({ id: true, mergedAt: true });
export type InsertStockItemMergeLog = z.infer<typeof insertStockItemMergeLogSchema>;
export type StockItemMergeLog = typeof stockItemMergeLogs.$inferSelect;

export const aiCompanySnapshots = pgTable(
  "ai_company_snapshots",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    snapshotType: varchar("snapshot_type", { length: 60 }).notNull(),
    data: jsonb("data").notNull().default({}),
    calculatedAt: timestamp("calculated_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (t) => ({
    companyTypeUniq: uniqueIndex("ai_snapshots_company_type_unique").on(t.companyId, t.snapshotType),
    expiresIdx: index("ai_snapshots_expires_idx").on(t.expiresAt),
  })
);

export type AiCompanySnapshot = typeof aiCompanySnapshots.$inferSelect;

export const aiAgentTasks = pgTable(
  "ai_agent_tasks",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    userId: varchar("user_id", { length: 100 }).notNull(),
    taskType: varchar("task_type", { length: 80 }).notNull().default("general"),
    userInstruction: text("user_instruction").notNull(),
    status: varchar("status", { length: 30 }).notNull().default("planned"),
    planJson: jsonb("plan_json"),
    resultJson: jsonb("result_json"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("ai_agent_tasks_company_idx").on(t.companyId),
    statusIdx: index("ai_agent_tasks_status_idx").on(t.status),
  })
);

export type AiAgentTask = typeof aiAgentTasks.$inferSelect;

export const aiAgentApprovals = pgTable(
  "ai_agent_approvals",
  {
    id: serial("id").primaryKey(),
    taskId: integer("task_id").notNull(),
    companyId: integer("company_id").notNull(),
    userId: varchar("user_id", { length: 100 }).notNull(),
    actionType: varchar("action_type", { length: 80 }).notNull(),
    actionLabel: text("action_label").notNull(),
    payloadJson: jsonb("payload_json"),
    previewJson: jsonb("preview_json"),
    status: varchar("status", { length: 30 }).notNull().default("pending"),
    approvedBy: varchar("approved_by", { length: 100 }),
    approvedAt: timestamp("approved_at"),
    postedAt: timestamp("posted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    taskIdx: index("ai_agent_approvals_task_idx").on(t.taskId),
    companyIdx: index("ai_agent_approvals_company_idx").on(t.companyId),
  })
);

export type AiAgentApproval = typeof aiAgentApprovals.$inferSelect;

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    requestedByUserId: varchar("requested_by_user_id", { length: 100 }).notNull(),
    requestedByUsername: text("requested_by_username").notNull(),
    actionType: text("action_type").notNull(),
    targetTable: text("target_table"),
    targetRecordId: integer("target_record_id"),
    targetIdentifier: text("target_identifier"),
    payload: jsonb("payload"),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    amountValue: decimal("amount_value", { precision: 20, scale: 2 }),
    status: text("status").notNull().default("pending"),
    requestedAt: timestamp("requested_at").notNull().defaultNow(),
    reviewedByUserId: varchar("reviewed_by_user_id", { length: 100 }),
    reviewedByUsername: text("reviewed_by_username"),
    reviewedAt: timestamp("reviewed_at"),
    reviewerNote: text("reviewer_note"),
    executedAt: timestamp("executed_at"),
  },
  (t) => ({
    companyIdx: index("approval_requests_company_idx").on(t.companyId),
    statusIdx: index("approval_requests_status_idx").on(t.status),
  })
);

export type ApprovalRequest = typeof approvalRequests.$inferSelect;
export const insertApprovalRequestSchema = createInsertSchema(approvalRequests).omit({ id: true, requestedAt: true });
export type InsertApprovalRequest = z.infer<typeof insertApprovalRequestSchema>;

export const businessAlerts = pgTable(
  "business_alerts",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    alertType: text("alert_type").notNull(),
    severity: text("severity").notNull().default("warning"),
    title: text("title").notNull(),
    message: text("message").notNull(),
    targetTable: text("target_table"),
    targetRecordId: integer("target_record_id"),
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at"),
    dismissedBy: varchar("dismissed_by", { length: 100 }),
    metadata: jsonb("metadata"),
  },
  (t) => ({
    companyIdx: index("business_alerts_company_idx").on(t.companyId),
    statusIdx: index("business_alerts_status_idx").on(t.status),
  })
);

export type BusinessAlert = typeof businessAlerts.$inferSelect;

export const labelDesignColors = pgTable("label_design_colors", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  label: text("label").notNull(),
  colorHex: text("color_hex").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  imageData: text("image_data"),
  imageUpdatedAt: timestamp("image_updated_at"),
});

export type LabelDesignColor = typeof labelDesignColors.$inferSelect;
export const insertLabelDesignColorSchema = createInsertSchema(labelDesignColors).omit({ id: true, createdAt: true });
export type InsertLabelDesignColor = z.infer<typeof insertLabelDesignColorSchema>;

export const codePatchHistory = pgTable(
  "code_patch_history",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    filePath: text("file_path").notNull(),
    description: text("description"),
    originalContent: text("original_content"),
    newContent: text("new_content"),
    appliedByUserId: text("applied_by_user_id"),
    appliedAt: timestamp("applied_at").notNull().defaultNow(),
    commitHash: text("commit_hash"),
    revertedAt: timestamp("reverted_at"),
  },
  (t) => ({
    companyIdx: index("code_patch_history_company_idx").on(t.companyId),
  })
);

export type CodePatchHistory = typeof codePatchHistory.$inferSelect;
export const insertCodePatchHistorySchema = createInsertSchema(codePatchHistory).omit({ id: true, appliedAt: true });
export type InsertCodePatchHistory = z.infer<typeof insertCodePatchHistorySchema>;

export const importBatches = pgTable(
  "import_batches",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    importType: text("import_type").notNull(),
    fileName: text("file_name").notNull(),
    fileSize: integer("file_size"),
    uploadedByUserId: varchar("uploaded_by_user_id", { length: 100 }).notNull(),
    uploadedByUsername: text("uploaded_by_username").notNull(),
    status: text("status").notNull().default("applied"),
    totalRows: integer("total_rows").notNull().default(0),
    validRows: integer("valid_rows").notNull().default(0),
    invalidRows: integer("invalid_rows").notNull().default(0),
    createdRecords: jsonb("created_records"),
    updatedRecords: jsonb("updated_records"),
    errorSummary: jsonb("error_summary"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    appliedAt: timestamp("applied_at"),
    rolledBackAt: timestamp("rolled_back_at"),
  },
  (t) => ({
    companyIdx: index("import_batches_company_idx").on(t.companyId),
  })
);

export const supplierProfitPoOverrides = pgTable(
  "supplier_profit_po_overrides",
  {
    id: serial("id").primaryKey(),
    supplierId: integer("supplier_id").notNull(),
    stockItemId: integer("stock_item_id").notNull(),
    poPrice: decimal("po_price", { precision: 20, scale: 4 }),
    avgPrice: decimal("avg_price", { precision: 20, scale: 4 }),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("supplier_profit_po_overrides_uniq").on(t.supplierId, t.stockItemId),
  })
);

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  recipientUserId: varchar("recipient_user_id").notNull(),
  eventType: text("event_type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  triggeredByUserId: varchar("triggered_by_user_id"),
  companyId: integer("company_id"),
  isRead: boolean("is_read").notNull().default(false),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type Notification = typeof notifications.$inferSelect;

export const notificationRules = pgTable("notification_rules", {
  id: serial("id").primaryKey(),
  eventType: text("event_type").notNull(),
  recipientUserId: varchar("recipient_user_id").notNull(),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type NotificationRule = typeof notificationRules.$inferSelect;
