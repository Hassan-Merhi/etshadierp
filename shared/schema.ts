import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, integer, decimal, date, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Companies table - represents different business entities
export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCompanySchema = createInsertSchema(companies).omit({
  id: true,
  createdAt: true,
}).extend({
  code: z.string().min(1, "Code is required"),
  name: z.string().min(1, "Name is required"),
});

export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companies.$inferSelect;

// User-Company-Role junction table - allows users to have different roles in different companies
export const userCompanyRoles = pgTable("user_company_roles", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  companyId: integer("company_id").notNull(),
  role: text("role").notNull(),
  assignedLocationId: integer("assigned_location_id"),
  cashAccountId: integer("cash_account_id"),
  posStation: integer("pos_station"),
  canSellNegativeStock: boolean("can_sell_negative_stock").notNull().default(false),
  canEditDaybook: boolean("can_edit_daybook").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUserCompanyRoleSchema = createInsertSchema(userCompanyRoles).omit({
  id: true,
  createdAt: true,
}).extend({
  userId: z.string().min(1, "User ID is required"),
  companyId: z.number().min(1, "Company ID is required"),
  role: z.enum(["Admin", "Owner", "Manager", "POS1", "POS2", "POS3", "POS4", "POS5", "POS6"]),
});

export type InsertUserCompanyRole = z.infer<typeof insertUserCompanyRoleSchema>;
export type UserCompanyRole = typeof userCompanyRoles.$inferSelect;

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
}).extend({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(4, "Password must be at least 4 characters"),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const locations = pgTable("locations", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: text("name").notNull(),
  city: text("city"),
  state: text("state"),
  country: text("country"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertLocationSchema = createInsertSchema(locations).omit({
  id: true,
  createdAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  code: z.string().optional(),
  name: z.string().min(1, "Name is required"),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
});

export type InsertLocation = z.infer<typeof insertLocationSchema>;
export type Location = typeof locations.$inferSelect;

export const ledgerAccounts = pgTable("ledger_accounts", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  code: varchar("code", { length: 50 }).notNull(),
  name: text("name").notNull(),
  accountType: text("account_type").notNull(),
  subType: text("sub_type"),
  parentId: integer("parent_id"),
  openingBalance: decimal("opening_balance", { precision: 15, scale: 2 }).default("0"),
  openingBalanceSide: text("opening_balance_side"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniqueCompanyCode: uniqueIndex("ledger_accounts_company_code_unique").on(t.companyId, t.code),
}));

export const insertLedgerAccountSchema = createInsertSchema(ledgerAccounts).omit({
  id: true,
  createdAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  code: z.string().optional(),
  name: z.string().min(1, "Name is required").refine(val => val.trim().length > 0, "Name cannot be only whitespace"),
  accountType: z.enum(["Asset", "Liability", "Equity", "Income", "Expense", "Bank", "Cash", "Indirect Expense", "Direct Expense", "Government Taxes", "Loans", "Duty Agent", "Transporter Agent", "Accounts Payable", "Profit"]),
  subType: z.string().optional(),
  openingBalance: z.string().optional(),
  openingBalanceSide: z.enum(["Dr", "Cr"]).optional(),
  parentId: z.number().optional(),
});

export const updateLedgerAccountSchema = insertLedgerAccountSchema.partial().extend({
  id: z.number().min(1, "Account ID is required"),
}).required({ id: true });

export type InsertLedgerAccount = z.infer<typeof insertLedgerAccountSchema>;
export type UpdateLedgerAccount = z.infer<typeof updateLedgerAccountSchema>;
export type LedgerAccount = typeof ledgerAccounts.$inferSelect;

export const employees = pgTable("employees", {
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
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertEmployeeSchema = createInsertSchema(employees).omit({
  id: true,
  createdAt: true,
  currentBalance: true,
  totalDeposits: true,
  totalWithdrawals: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  code: z.string().optional(),
  firstName: z.string().min(1, "First name is required").refine(val => val.trim().length > 0, "First name cannot be only whitespace"),
  lastName: z.string().min(1, "Last name is required").refine(val => val.trim().length > 0, "Last name cannot be only whitespace"),
  email: z.string().email("Invalid email format").optional().or(z.literal("")),
  joinDate: z.string().min(1, "Starting date is required").refine(
    (val) => {
      const regex = /^\d{4}-\d{2}-\d{2}$/;
      if (!regex.test(val)) return false;
      const date = new Date(val);
      return !isNaN(date.getTime()) && val === date.toISOString().split('T')[0];
    },
    "Date must be a valid date in YYYY-MM-DD format"
  ),
  employeeType: z.enum(["Employee", "Worker"]),
});

export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Employee = typeof employees.$inferSelect;

export const employeeGroups = pgTable("employee_groups", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertEmployeeGroupSchema = createInsertSchema(employeeGroups).omit({
  id: true,
  createdAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  name: z.string().min(1, "Group name is required").refine(val => val.trim().length > 0, "Group name cannot be only whitespace"),
  description: z.string().optional(),
});

export type InsertEmployeeGroup = z.infer<typeof insertEmployeeGroupSchema>;
export type EmployeeGroup = typeof employeeGroups.$inferSelect;

export const employeeGroupMembers = pgTable("employee_group_members", {
  id: serial("id").primaryKey(),
  employeeGroupId: integer("employee_group_id").notNull(),
  employeeId: integer("employee_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertEmployeeGroupMemberSchema = createInsertSchema(employeeGroupMembers).omit({
  id: true,
  createdAt: true,
}).extend({
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
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSupplierSchema = createInsertSchema(suppliers).omit({
  id: true,
  createdAt: true,
}).extend({
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

export const stockGroups = pgTable("stock_groups", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  code: varchar("code", { length: 50 }).notNull(),
  name: text("name").notNull(),
  parentId: integer("parent_id"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniqueCompanyCode: uniqueIndex("stock_groups_company_code_unique").on(t.companyId, t.code),
}));

export const insertStockGroupSchema = createInsertSchema(stockGroups).omit({
  id: true,
  createdAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  code: z.string().min(1, "Code is required"),
  name: z.string().min(1, "Name is required"),
});

export type InsertStockGroup = z.infer<typeof insertStockGroupSchema>;
export type StockGroup = typeof stockGroups.$inferSelect;

export const stockItems = pgTable("stock_items", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  code: varchar("code", { length: 50 }).notNull(),
  name: text("name").notNull(),
  stockGroupId: integer("stock_group_id"),
  uom: text("uom").notNull(),
  openingQty: decimal("opening_qty", { precision: 15, scale: 3 }).default("0"),
  openingRate: decimal("opening_rate", { precision: 15, scale: 2 }).default("0"),
  openingValue: decimal("opening_value", { precision: 15, scale: 2 }).default("0"),
  reorderLevel: decimal("reorder_level", { precision: 15, scale: 3 }).default("0"),
  sellingPrice: decimal("selling_price", { precision: 15, scale: 2 }).default("0"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniqueCompanyCode: uniqueIndex("stock_items_company_code_unique").on(t.companyId, t.code),
}));

export const insertStockItemSchema = createInsertSchema(stockItems).omit({
  id: true,
  createdAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  code: z.string().min(1, "Code is required"),
  name: z.string().min(1, "Name is required"),
  uom: z.string().min(1, "Unit of measure is required"),
});

export type InsertStockItem = z.infer<typeof insertStockItemSchema>;
export type StockItem = typeof stockItems.$inferSelect;

export const stockItemCodeAliases = pgTable("stock_item_code_aliases", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  stockItemId: integer("stock_item_id").notNull(),
  aliasCode: varchar("alias_code", { length: 50 }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniqueCompanyAlias: uniqueIndex("stock_item_code_aliases_company_alias_unique").on(t.companyId, t.aliasCode),
}));

export const insertStockItemCodeAliasSchema = createInsertSchema(stockItemCodeAliases).omit({
  id: true,
  createdAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  stockItemId: z.number().min(1, "Stock item is required"),
  aliasCode: z.string().min(1, "Alias code is required"),
  description: z.string().optional(),
});

export type InsertStockItemCodeAlias = z.infer<typeof insertStockItemCodeAliasSchema>;
export type StockItemCodeAlias = typeof stockItemCodeAliases.$inferSelect;

export const bankAccounts = pgTable("bank_accounts", {
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
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertBankAccountSchema = createInsertSchema(bankAccounts).omit({
  id: true,
  createdAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  code: z.string().min(1, "Code is required"),
  name: z.string().min(1, "Name is required"),
  bankName: z.string().min(1, "Bank name is required"),
  accountNumber: z.string().min(1, "Account number is required"),
  openingBalanceSide: z.enum(["Dr", "Cr"]).optional(),
});

export type InsertBankAccount = z.infer<typeof insertBankAccountSchema>;
export type BankAccount = typeof bankAccounts.$inferSelect;

export const fixedAssets = pgTable("fixed_assets", {
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
});

export const insertFixedAssetSchema = createInsertSchema(fixedAssets).omit({
  id: true,
  createdAt: true,
}).extend({
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

export const containers = pgTable("containers", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  containerNumber: varchar("container_number", { length: 100 }).notNull().unique(),
  supplierId: integer("supplier_id").notNull(),
  status: text("status").notNull().default("OTW"),
  importDate: date("import_date").notNull(),
  itemsTotal: decimal("items_total", { precision: 15, scale: 2 }).default("0"),
  chargesTotal: decimal("charges_total", { precision: 15, scale: 2 }).default("0"),
  grandTotal: decimal("grand_total", { precision: 15, scale: 2 }).default("0"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertContainerSchema = createInsertSchema(containers).omit({
  id: true,
  createdAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  containerNumber: z.string().min(1, "Container number is required"),
  supplierId: z.number().min(1, "Supplier is required"),
  importDate: z.string().min(1, "Import date is required"),
});

export type InsertContainer = z.infer<typeof insertContainerSchema>;
export type Container = typeof containers.$inferSelect;

export const purchaseOrders = pgTable("purchase_orders", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  poNumber: varchar("po_number", { length: 100 }).notNull(),
  containerId: integer("container_id").notNull(),
  supplierId: integer("supplier_id").notNull(),
  voucherId: integer("voucher_id"),
  currency: text("currency").notNull().default("USD"),
  itemsTotal: decimal("items_total", { precision: 15, scale: 2 }).default("0"),
  status: text("status").notNull().default("Open"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrders).omit({
  id: true,
  createdAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  poNumber: z.string().min(1, "PO number is required"),
  containerId: z.number().min(1, "Container is required"),
  supplierId: z.number().min(1, "Supplier is required"),
});

export type InsertPurchaseOrder = z.infer<typeof insertPurchaseOrderSchema>;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;

export const poLineItems = pgTable("po_line_items", {
  id: serial("id").primaryKey(),
  poId: integer("po_id").notNull(),
  stockItemId: integer("stock_item_id").notNull(),
  itemName: text("item_name").notNull(),
  quantity: decimal("quantity", { precision: 15, scale: 3 }).notNull(),
  rate: decimal("rate", { precision: 15, scale: 2 }).notNull(),
  lineTotal: decimal("line_total", { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPOLineItemSchema = createInsertSchema(poLineItems).omit({
  id: true,
  createdAt: true,
}).extend({
  poId: z.number().min(1, "PO is required"),
  stockItemId: z.number().min(1, "Stock item is required"),
  itemName: z.string().min(1, "Item name is required"),
  quantity: z.string().min(1, "Quantity is required"),
  rate: z.string().min(1, "Rate is required"),
  lineTotal: z.string().min(1, "Line total is required"),
});

export type InsertPOLineItem = z.infer<typeof insertPOLineItemSchema>;
export type POLineItem = typeof poLineItems.$inferSelect;

export const containerCharges = pgTable("container_charges", {
  id: serial("id").primaryKey(),
  containerId: integer("container_id").notNull(),
  chargeType: text("charge_type").notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  ledgerAccountId: integer("ledger_account_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertContainerChargeSchema = createInsertSchema(containerCharges).omit({
  id: true,
  createdAt: true,
}).extend({
  containerId: z.number().min(1, "Container is required"),
  chargeType: z.string().min(1, "Charge type is required"),
  amount: z.string().min(1, "Amount is required"),
});

export type InsertContainerCharge = z.infer<typeof insertContainerChargeSchema>;
export type ContainerCharge = typeof containerCharges.$inferSelect;

export const importLogs = pgTable("import_logs", {
  id: serial("id").primaryKey(),
  fileName: text("file_name").notNull(),
  fileHash: text("file_hash").notNull().unique(),
  rowCount: integer("row_count").notNull(),
  containerId: integer("container_id"),
  status: text("status").notNull(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertImportLogSchema = createInsertSchema(importLogs).omit({
  id: true,
  createdAt: true,
}).extend({
  fileName: z.string().min(1, "File name is required"),
  fileHash: z.string().min(1, "File hash is required"),
  rowCount: z.number().min(0, "Row count must be non-negative"),
  status: z.enum(["Success", "Failed", "Pending"]),
});

export type InsertImportLog = z.infer<typeof insertImportLogSchema>;
export type ImportLog = typeof importLogs.$inferSelect;

export const inventory = pgTable("inventory", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  locationId: integer("location_id").notNull(),
  stockItemId: integer("stock_item_id").notNull(),
  quantity: decimal("quantity", { precision: 15, scale: 3 }).notNull().default("0"),
  averageRate: decimal("average_rate", { precision: 15, scale: 2 }).notNull().default("0"),
  totalValue: decimal("total_value", { precision: 15, scale: 2 }).notNull().default("0"),
  lastUpdated: timestamp("last_updated").notNull().defaultNow(),
});

export const insertInventorySchema = createInsertSchema(inventory).omit({
  id: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  locationId: z.number().min(1, "Location is required"),
  stockItemId: z.number().min(1, "Stock item is required"),
  quantity: z.string(),
  averageRate: z.string(),
  totalValue: z.string(),
});

export type InsertInventory = z.infer<typeof insertInventorySchema>;
export type Inventory = typeof inventory.$inferSelect;

export const containerOffloads = pgTable("container_offloads", {
  id: serial("id").primaryKey(),
  containerId: integer("container_id").notNull(),
  locationId: integer("location_id").notNull(),
  duties: decimal("duties", { precision: 15, scale: 2 }).notNull().default("0"),
  officeCharges: decimal("office_charges", { precision: 15, scale: 2 }).notNull().default("0"),
  transferCharges: decimal("transfer_charges", { precision: 15, scale: 2 }).notNull().default("0"),
  transportFees: decimal("transport_fees", { precision: 15, scale: 2 }).notNull().default("0"),
  totalCharges: decimal("total_charges", { precision: 15, scale: 2 }).notNull().default("0"),
  totalBales: decimal("total_bales", { precision: 15, scale: 3 }).notNull(),
  additionalCostPerBale: decimal("additional_cost_per_bale", { precision: 15, scale: 2 }).notNull(),
  offloadedAt: timestamp("offloaded_at").notNull().defaultNow(),
});

export const insertContainerOffloadSchema = createInsertSchema(containerOffloads).omit({
  id: true,
  offloadedAt: true,
  totalCharges: true,
  totalBales: true,
  additionalCostPerBale: true,
}).extend({
  containerId: z.number().min(1, "Container is required"),
  locationId: z.number().min(1, "Location is required"),
  duties: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Duties must be a valid non-negative number"),
  officeCharges: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Office charges must be a valid non-negative number"),
  transferCharges: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Transfer charges must be a valid non-negative number"),
  transportFees: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Transport fees must be a valid non-negative number"),
});

export const offloadRequestSchema = insertContainerOffloadSchema.omit({
  containerId: true,
}).extend({
  dutiesAccountId: z.number().nullable().optional(),
  officeChargesAccountId: z.number().nullable().optional(),
  officeChargesCashAccountId: z.number().nullable().optional(),
  transportAccountId: z.number().nullable().optional(),
  additionalCharges: z.array(z.object({
    description: z.string().min(1, "Description is required"),
    amount: z.number().min(0, "Amount must be non-negative"),
    ledgerAccountId: z.number().min(1, "Ledger account is required"),
  })).optional(),
});

export type InsertContainerOffload = z.infer<typeof insertContainerOffloadSchema>;
export type ContainerOffload = typeof containerOffloads.$inferSelect;
export type OffloadRequest = z.infer<typeof offloadRequestSchema>;

export const vouchers = pgTable("vouchers", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  locationId: integer("location_id"),
  voucherNumber: varchar("voucher_number", { length: 100 }).notNull().unique(),
  voucherType: text("voucher_type").notNull(),
  voucherDate: date("voucher_date").notNull(),
  description: text("description"),
  totalAmount: decimal("total_amount", { precision: 15, scale: 2 }).notNull(),
  optional: boolean("optional").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertVoucherSchema = createInsertSchema(vouchers).omit({
  id: true,
  createdAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  locationId: z.number().optional(),
  voucherNumber: z.string().min(1, "Voucher number is required"),
  voucherType: z.enum(["Payment", "Receipt", "Journal", "Sales", "Purchase", "Contra", "Stock Transfer"]),
  voucherDate: z.string().min(1, "Voucher date is required"),
  totalAmount: z.string().min(1, "Total amount is required"),
  optional: z.boolean().optional().default(false),
});

export type InsertVoucher = z.infer<typeof insertVoucherSchema>;
export type Voucher = typeof vouchers.$inferSelect;

export const voucherEntries = pgTable("voucher_entries", {
  id: serial("id").primaryKey(),
  voucherId: integer("voucher_id").notNull(),
  ledgerAccountId: integer("ledger_account_id"),
  bankAccountId: integer("bank_account_id"),
  fixedAssetId: integer("fixed_asset_id"),
  supplierId: integer("supplier_id"),
  employeeId: integer("employee_id"),
  debitAmount: decimal("debit_amount", { precision: 15, scale: 2 }).default("0"),
  creditAmount: decimal("credit_amount", { precision: 15, scale: 2 }).default("0"),
  narration: text("narration"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertVoucherEntrySchema = createInsertSchema(voucherEntries).omit({
  id: true,
  createdAt: true,
}).extend({
  voucherId: z.number().min(1, "Voucher is required"),
  ledgerAccountId: z.number().optional(),
  bankAccountId: z.number().optional(),
  fixedAssetId: z.number().optional(),
  supplierId: z.number().optional(),
  employeeId: z.number().optional(),
  debitAmount: z.string().optional(),
  creditAmount: z.string().optional(),
});

export type InsertVoucherEntry = z.infer<typeof insertVoucherEntrySchema>;
export type VoucherEntry = typeof voucherEntries.$inferSelect;

// Fiscal Period Closures
export const fiscalPeriodClosures = pgTable("fiscal_period_closures", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
  periodStartDate: date("period_start_date").notNull(),
  periodEndDate: date("period_end_date").notNull(),
  closureDate: timestamp("closure_date").notNull().defaultNow(),
  closedByUserId: varchar("closed_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  closingVoucherId: integer("closing_voucher_id").notNull().unique().references(() => vouchers.id, { onDelete: "restrict" }),
  retainedEarningsAccountId: integer("retained_earnings_account_id").notNull().references(() => ledgerAccounts.id, { onDelete: "restrict" }),
  totalIncome: decimal("total_income", { precision: 15, scale: 2 }).notNull(),
  totalExpense: decimal("total_expense", { precision: 15, scale: 2 }).notNull(),
  netIncome: decimal("net_income", { precision: 15, scale: 2 }).notNull(),
  status: text("status").notNull().default("CLOSED"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniqueCompanyPeriod: uniqueIndex("fiscal_closures_company_period_unique").on(t.companyId, t.periodEndDate),
}));

export const insertFiscalPeriodClosureSchema = createInsertSchema(fiscalPeriodClosures).omit({
  id: true,
  createdAt: true,
  closureDate: true,
}).extend({
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

// Stock Transfer Vouchers
export const stockTransferVouchers = pgTable("stock_transfer_vouchers", {
  id: serial("id").primaryKey(),
  voucherId: integer("voucher_id").notNull(),
  sourceLocationId: integer("source_location_id").notNull(),
  destinationLocationId: integer("destination_location_id").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertStockTransferVoucherSchema = createInsertSchema(stockTransferVouchers).omit({
  id: true,
  createdAt: true,
}).extend({
  voucherId: z.number().min(1, "Voucher is required"),
  sourceLocationId: z.number().min(1, "Source location is required"),
  destinationLocationId: z.number().min(1, "Destination location is required"),
});

export type InsertStockTransferVoucher = z.infer<typeof insertStockTransferVoucherSchema>;
export type StockTransferVoucher = typeof stockTransferVouchers.$inferSelect;

// Stock Transfer Items
export const stockTransferItems = pgTable("stock_transfer_items", {
  id: serial("id").primaryKey(),
  transferId: integer("transfer_id").notNull(),
  stockItemId: integer("stock_item_id").notNull(),
  quantity: decimal("quantity", { precision: 15, scale: 3 }).notNull(),
  rate: decimal("rate", { precision: 15, scale: 2 }).notNull(),
  totalAmount: decimal("total_amount", { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertStockTransferItemSchema = createInsertSchema(stockTransferItems).omit({
  id: true,
  createdAt: true,
  totalAmount: true,
}).extend({
  transferId: z.number().min(1, "Transfer is required"),
  stockItemId: z.number().min(1, "Stock item is required"),
  quantity: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Quantity must be positive"),
  rate: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Rate must be non-negative"),
});

export type InsertStockTransferItem = z.infer<typeof insertStockTransferItemSchema>;
export type StockTransferItem = typeof stockTransferItems.$inferSelect;

// Stock Adjustment Vouchers (Production/Consumption)
export const stockAdjustmentVouchers = pgTable("stock_adjustment_vouchers", {
  id: serial("id").primaryKey(),
  voucherId: integer("voucher_id").notNull(),
  locationId: integer("location_id").notNull(),
  adjustmentType: text("adjustment_type").notNull(), // "Production" or "Consumption"
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertStockAdjustmentVoucherSchema = createInsertSchema(stockAdjustmentVouchers).omit({
  id: true,
  createdAt: true,
}).extend({
  voucherId: z.number().min(1, "Voucher is required"),
  locationId: z.number().min(1, "Location is required"),
  adjustmentType: z.enum(["Production", "Consumption", "Mixed"]),
});

export type InsertStockAdjustmentVoucher = z.infer<typeof insertStockAdjustmentVoucherSchema>;
export type StockAdjustmentVoucher = typeof stockAdjustmentVouchers.$inferSelect;

// Stock Adjustment Items
export const stockAdjustmentItems = pgTable("stock_adjustment_items", {
  id: serial("id").primaryKey(),
  adjustmentId: integer("adjustment_id").notNull(),
  stockItemId: integer("stock_item_id").notNull(),
  quantity: decimal("quantity", { precision: 15, scale: 3 }).notNull(), // Positive for production, negative for consumption
  rate: decimal("rate", { precision: 15, scale: 2 }).notNull(),
  totalAmount: decimal("total_amount", { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertStockAdjustmentItemSchema = createInsertSchema(stockAdjustmentItems).omit({
  id: true,
  createdAt: true,
  totalAmount: true,
}).extend({
  adjustmentId: z.number().min(1, "Adjustment is required"),
  stockItemId: z.number().min(1, "Stock item is required"),
  quantity: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) !== 0, "Quantity cannot be zero"),
  rate: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Rate must be non-negative"),
});

export type InsertStockAdjustmentItem = z.infer<typeof insertStockAdjustmentItemSchema>;
export type StockAdjustmentItem = typeof stockAdjustmentItems.$inferSelect;

// Sales Items - tracks item-level details for POS sales
export const salesItems = pgTable("sales_items", {
  id: serial("id").primaryKey(),
  voucherId: integer("voucher_id").notNull(),
  stockItemId: integer("stock_item_id").notNull(),
  quantity: decimal("quantity", { precision: 15, scale: 3 }).notNull(),
  sellingPrice: decimal("selling_price", { precision: 15, scale: 2 }).notNull(),
  costPrice: decimal("cost_price", { precision: 15, scale: 2 }).notNull(),
  totalSales: decimal("total_sales", { precision: 15, scale: 2 }).notNull(),
  totalCost: decimal("total_cost", { precision: 15, scale: 2 }).notNull(),
  profit: decimal("profit", { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSalesItemSchema = createInsertSchema(salesItems).omit({
  id: true,
  createdAt: true,
}).extend({
  voucherId: z.number().min(1, "Voucher is required"),
  stockItemId: z.number().min(1, "Stock item is required"),
  quantity: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Quantity must be positive"),
  sellingPrice: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Selling price must be non-negative"),
  costPrice: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Cost price must be non-negative"),
  totalSales: z.string(),
  totalCost: z.string(),
  profit: z.string(),
});

export type InsertSalesItem = z.infer<typeof insertSalesItemSchema>;
export type SalesItem = typeof salesItems.$inferSelect;

// Draft POS Sales - stores unsaved POS transactions for later completion
export const draftPosSales = pgTable("draft_pos_sales", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  locationId: integer("location_id").notNull(),
  paymentAccountType: text("payment_account_type"), // "bank", "cash", or "credit"
  paymentAccountId: integer("payment_account_id"),
  isCreditSale: boolean("is_credit_sale").default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertDraftPosSaleSchema = createInsertSchema(draftPosSales).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  userId: z.string().min(1, "User is required"),
  locationId: z.number().min(1, "Location is required"),
  paymentAccountType: z.enum(["bank", "cash", "credit"]).optional(),
  paymentAccountId: z.number().optional(),
  isCreditSale: z.boolean().optional(),
  notes: z.string().optional(),
});

export type InsertDraftPosSale = z.infer<typeof insertDraftPosSaleSchema>;
export type DraftPosSale = typeof draftPosSales.$inferSelect;

// Draft POS Sale Items - line items for draft sales
export const draftPosSaleItems = pgTable("draft_pos_sale_items", {
  id: serial("id").primaryKey(),
  draftId: integer("draft_id").notNull(),
  stockItemId: integer("stock_item_id").notNull(),
  quantity: decimal("quantity", { precision: 15, scale: 3 }).notNull(),
  rate: decimal("rate", { precision: 15, scale: 2 }).notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertDraftPosSaleItemSchema = createInsertSchema(draftPosSaleItems).omit({
  id: true,
  createdAt: true,
}).extend({
  draftId: z.number().min(1, "Draft is required"),
  stockItemId: z.number().min(1, "Stock item is required"),
  quantity: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Quantity must be positive"),
  rate: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Rate must be non-negative"),
  amount: z.string(),
});

export type InsertDraftPosSaleItem = z.infer<typeof insertDraftPosSaleItemSchema>;
export type DraftPosSaleItem = typeof draftPosSaleItems.$inferSelect;

// Customers - similar to suppliers but for container sales
export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  ledgerAccountId: integer("ledger_account_id"),
  code: varchar("code", { length: 50 }).notNull(),
  legalName: text("legal_name").notNull(),
  phone: text("phone"),
  openingBalance: decimal("opening_balance", { precision: 15, scale: 2 }).default("0"),
  openingBalanceSide: varchar("opening_balance_side", { length: 2 }).default("Dr"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniqueCompanyCode: uniqueIndex("customers_company_code_unique").on(t.companyId, t.code),
}));

export const insertCustomerSchema = createInsertSchema(customers).omit({
  id: true,
  createdAt: true,
  code: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  legalName: z.string().min(1, "Legal name is required"),
  openingBalance: z.string().optional(),
  openingBalanceSide: z.enum(["Dr", "Cr"]).optional(),
  ledgerAccountId: z.number().optional(),
});

export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Customer = typeof customers.$inferSelect;

// Container Sales - tracks when containers are sold to customers
export const containerSales = pgTable("container_sales", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  containerId: integer("container_id").notNull(),
  customerId: integer("customer_id").notNull(),
  saleDate: date("sale_date").notNull(),
  containerCost: decimal("container_cost", { precision: 15, scale: 2 }).notNull(),
  commission: decimal("commission", { precision: 15, scale: 2 }).notNull(),
  commissionAccountId: integer("commission_account_id"),
  totalAmount: decimal("total_amount", { precision: 15, scale: 2 }).notNull(),
  voucherId: integer("voucher_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertContainerSaleSchema = createInsertSchema(containerSales).omit({
  id: true,
  createdAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  containerId: z.number().min(1, "Container is required"),
  customerId: z.number().min(1, "Customer is required"),
  saleDate: z.string().min(1, "Sale date is required"),
  containerCost: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Container cost must be non-negative"),
  commission: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Commission must be non-negative"),
  commissionAccountId: z.number().optional(),
  totalAmount: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Total amount must be positive"),
});

export type InsertContainerSale = z.infer<typeof insertContainerSaleSchema>;
export type ContainerSale = typeof containerSales.$inferSelect;

// Inter-Company Transfers - move money between companies owned by same person
export const interCompanyTransfers = pgTable("inter_company_transfers", {
  id: serial("id").primaryKey(),
  transferType: text("transfer_type").notNull(),
  fromCompanyId: integer("from_company_id").notNull(),
  toCompanyId: integer("to_company_id").notNull(),
  transferDate: date("transfer_date").notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  fromLedgerAccountId: integer("from_ledger_account_id").notNull(),
  toLedgerAccountId: integer("to_ledger_account_id").notNull(),
  fromVoucherId: integer("from_voucher_id"),
  toVoucherId: integer("to_voucher_id"),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertInterCompanyTransferSchema = createInsertSchema(interCompanyTransfers).omit({
  id: true,
  createdAt: true,
}).extend({
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

// Salary Advances - track advances given to employees
export const salaryAdvances = pgTable("salary_advances", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  employeeId: integer("employee_id").notNull(),
  advanceDate: date("advance_date").notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  remainingBalance: decimal("remaining_balance", { precision: 15, scale: 2 }).notNull(),
  voucherId: integer("voucher_id"),
  notes: text("notes"),
  fullyPaid: boolean("fully_paid").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSalaryAdvanceSchema = createInsertSchema(salaryAdvances).omit({
  id: true,
  createdAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  employeeId: z.number().min(1, "Employee is required"),
  advanceDate: z.string().min(1, "Advance date is required"),
  amount: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Amount must be positive"),
  remainingBalance: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Remaining balance must be non-negative"),
});

export type InsertSalaryAdvance = z.infer<typeof insertSalaryAdvanceSchema>;
export type SalaryAdvance = typeof salaryAdvances.$inferSelect;

// Salary Advance Deductions - track deductions from employee salary
export const salaryAdvanceDeductions = pgTable("salary_advance_deductions", {
  id: serial("id").primaryKey(),
  salaryAdvanceId: integer("salary_advance_id").notNull(),
  payrollMonth: text("payroll_month").notNull(),
  deductionAmount: decimal("deduction_amount", { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSalaryAdvanceDeductionSchema = createInsertSchema(salaryAdvanceDeductions).omit({
  id: true,
  createdAt: true,
}).extend({
  salaryAdvanceId: z.number().min(1, "Salary advance is required"),
  payrollMonth: z.string().min(1, "Payroll month is required"),
  deductionAmount: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Deduction amount must be positive"),
});

export type InsertSalaryAdvanceDeduction = z.infer<typeof insertSalaryAdvanceDeductionSchema>;
export type SalaryAdvanceDeduction = typeof salaryAdvanceDeductions.$inferSelect;

// Dashboard Cash Accounts - user-selected accounts to display in dashboard cash section
export const dashboardCashAccounts = pgTable("dashboard_cash_accounts", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  accountType: text("account_type").notNull(),
  accountId: integer("account_id").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertDashboardCashAccountSchema = createInsertSchema(dashboardCashAccounts).omit({
  id: true,
  createdAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  accountType: z.enum(["ledger", "bank"]),
  accountId: z.number().min(1, "Account is required"),
  displayOrder: z.number().optional(),
});

export type InsertDashboardCashAccount = z.infer<typeof insertDashboardCashAccountSchema>;
export type DashboardCashAccount = typeof dashboardCashAccounts.$inferSelect;

// Company Settings - stores company-specific configuration like logos
export const companySettings = pgTable("company_settings", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().unique(),
  logoUrl: text("logo_url"),
  logoFileName: text("logo_file_name"),
  logoUpdatedAt: timestamp("logo_updated_at"),
  invoiceFooter: text("invoice_footer"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCompanySettingsSchema = createInsertSchema(companySettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  logoUrl: z.string().optional(),
  logoFileName: z.string().optional(),
  invoiceFooter: z.string().optional(),
});

export type InsertCompanySettings = z.infer<typeof insertCompanySettingsSchema>;
export type CompanySettings = typeof companySettings.$inferSelect;

// Bales - tracks factory bales for clothing grading/sorting business
export const bales = pgTable("bales", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  containerId: integer("container_id"),
  barcode: varchar("barcode", { length: 100 }).notNull(),
  category: text("category").notNull(),
  grade: text("grade").notNull(),
  origin: text("origin").notNull(),
  weight: decimal("weight", { precision: 10, scale: 3 }).notNull(),
  datePressed: date("date_pressed").notNull(),
  price: decimal("price", { precision: 12, scale: 2 }),
  currency: varchar("currency", { length: 3 }).default("USD"),
  soldAt: timestamp("sold_at"),
  soldVoucherId: integer("sold_voucher_id"),
  status: text("status").notNull().default("AVAILABLE"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  uniqueCompanyBarcode: uniqueIndex("bales_company_barcode_unique").on(t.companyId, t.barcode),
}));

export const insertBaleSchema = createInsertSchema(bales).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  containerId: z.number().optional(),
  barcode: z.string().min(1, "Barcode is required"),
  category: z.string().min(1, "Category is required"),
  grade: z.enum(["A", "B", "C"]),
  origin: z.enum(["EU", "AUS", "USA"]),
  weight: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Weight must be positive"),
  datePressed: z.string().min(1, "Date pressed is required"),
  price: z.string().optional(),
  currency: z.string().length(3).optional(),
  status: z.enum(["AVAILABLE", "HOLD", "SOLD"]).optional(),
});

export type InsertBale = z.infer<typeof insertBaleSchema>;
export type Bale = typeof bales.$inferSelect;
