import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, integer, decimal, date, boolean, timestamp, uniqueIndex, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Companies table - represents different business entities
export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: text("name").notNull(),
  companyType: text("company_type").notNull().default("erp"),
  active: boolean("active").notNull().default(true),
  baseCurrency: varchar("base_currency", { length: 10 }).default("USD"),
  displayCurrency: varchar("display_currency", { length: 10 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCompanySchema = createInsertSchema(companies).omit({
  id: true,
  createdAt: true,
}).extend({
  code: z.string().min(1, "Code is required"),
  name: z.string().min(1, "Name is required"),
  companyType: z.enum(["erp", "factory"]).default("erp"),
  baseCurrency: z.string().optional(),
  displayCurrency: z.string().optional(),
});

// Exchange rates table - stores historical exchange rates for multi-currency companies
export const exchangeRates = pgTable("exchange_rates", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  fromCurrency: varchar("from_currency", { length: 10 }).notNull(),
  toCurrency: varchar("to_currency", { length: 10 }).notNull(),
  rate: decimal("rate", { precision: 20, scale: 6 }).notNull(),
  effectiveDate: date("effective_date").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertExchangeRateSchema = createInsertSchema(exchangeRates).omit({
  id: true,
  createdAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  fromCurrency: z.string().min(1, "From currency is required"),
  toCurrency: z.string().min(1, "To currency is required"),
  rate: z.string().min(1, "Rate is required"),
  effectiveDate: z.string().min(1, "Effective date is required"),
});

export type InsertExchangeRate = z.infer<typeof insertExchangeRateSchema>;
export type ExchangeRate = typeof exchangeRates.$inferSelect;

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
  daybookEditDays: integer("daybook_edit_days").notNull().default(0),
  canAccessCustomers: boolean("can_access_customers").notNull().default(false),
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

export const userLocations = pgTable("user_locations", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  companyId: integer("company_id").notNull(),
  locationId: integer("location_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUserLocationSchema = createInsertSchema(userLocations).omit({
  id: true,
  createdAt: true,
});

export type InsertUserLocation = z.infer<typeof insertUserLocationSchema>;
export type UserLocation = typeof userLocations.$inferSelect;

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  active: boolean("active").notNull().default(true),
  chatbotEnabled: boolean("chatbot_enabled").notNull().default(false),
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

// Audit Log table - tracks all changes to records
export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  username: text("username").notNull(),
  companyId: integer("company_id"),
  action: text("action").notNull(), // 'create', 'update', 'delete'
  tableName: text("table_name").notNull(),
  recordId: integer("record_id"),
  recordIdentifier: text("record_identifier"), // human-readable identifier (e.g., voucher number)
  changes: jsonb("changes"), // { field: { old: value, new: value } }
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AuditLog = typeof auditLog.$inferSelect;

export const locations = pgTable("locations", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: text("name").notNull(),
  city: text("city"),
  state: text("state"),
  country: text("country"),
  active: boolean("active").notNull().default(true),
  deletedAt: timestamp("deleted_at"),
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
  openingBalance: decimal("opening_balance", { precision: 20, scale: 2 }).default("0"),
  openingBalanceSide: text("opening_balance_side"),
  active: boolean("active").notNull().default(true),
  isHidden: boolean("is_hidden").notNull().default(false),
  deletedAt: timestamp("deleted_at"),
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
  openingBalanceSide: z.enum(["Dr", "Cr"]).optional().or(z.literal("")),
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
  deletedAt: timestamp("deleted_at"),
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
  groupType: text("group_type").notNull().default("Employee"), // "Employee" or "Worker"
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
  groupType: z.enum(["Employee", "Worker"]).default("Employee"),
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
  deletedAt: timestamp("deleted_at"),
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
  deletedAt: timestamp("deleted_at"),
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
  deletedAt: timestamp("deleted_at"),
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
  deletedAt: timestamp("deleted_at"),
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
  openingBalanceSide: z.enum(["Dr", "Cr"]).optional().or(z.literal("")),
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
  itemsTotal: decimal("items_total", { precision: 20, scale: 2 }).default("0"),
  chargesTotal: decimal("charges_total", { precision: 20, scale: 2 }).default("0"),
  grandTotal: decimal("grand_total", { precision: 20, scale: 2 }).default("0"),
  itemName: text("item_name"),
  ratePerKg: decimal("rate_per_kg", { precision: 10, scale: 2 }),
  totalKg: decimal("total_kg", { precision: 15, scale: 2 }),
  // OTW Tracking fields
  shopName: text("shop_name"),
  eta: date("eta"),
  etaSource: text("eta_source").default("manual"), // 'manual' or 'api'
  transporter: varchar("transporter", { length: 100 }),
  transportFee: decimal("transport_fee", { precision: 15, scale: 2 }),
  numberPlate: varchar("number_plate", { length: 50 }),
  trackingLocation: text("tracking_location"),
  borderDate: date("border_date"),
  offloadDate: date("offload_date"),
  agent: varchar("agent", { length: 100 }),
  dutyFee: decimal("duty_fee", { precision: 15, scale: 2 }),
  docReceived: boolean("doc_received").default(false),
  trackingDescription: text("tracking_description"),
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
  itemsTotal: decimal("items_total", { precision: 20, scale: 2 }).default("0"),
  freight: decimal("freight", { precision: 20, scale: 2 }).default("0"),
  surcharge: decimal("surcharge", { precision: 20, scale: 2 }).default("0"),
  fumigation: decimal("fumigation", { precision: 20, scale: 2 }).default("0"),
  documentCharges: decimal("document_charges", { precision: 20, scale: 2 }).default("0"),
  discount: decimal("discount", { precision: 20, scale: 2 }).default("0"),
  otherCharges: decimal("other_charges", { precision: 20, scale: 2 }).default("0"),
  chargesEdited: boolean("charges_edited").default(false),
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
  freight: z.string().optional(),
  surcharge: z.string().optional(),
  fumigation: z.string().optional(),
  documentCharges: z.string().optional(),
  discount: z.string().optional(),
  otherCharges: z.string().optional(),
  chargesEdited: z.boolean().optional(),
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
  lineTotal: decimal("line_total", { precision: 20, scale: 2 }).notNull(),
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
  amount: decimal("amount", { precision: 20, scale: 2 }).notNull(),
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
  averageRate: decimal("average_rate", { precision: 20, scale: 2 }).notNull().default("0"),
  totalValue: decimal("total_value", { precision: 20, scale: 2 }).notNull().default("0"),
  lastUpdated: timestamp("last_updated").notNull().defaultNow(),
}, (t) => ({
  uniqueLocationItem: uniqueIndex("inventory_location_item_unique").on(t.locationId, t.stockItemId),
}));

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
  duties: decimal("duties", { precision: 20, scale: 2 }).notNull().default("0"),
  officeCharges: decimal("office_charges", { precision: 20, scale: 2 }).notNull().default("0"),
  transferCharges: decimal("transfer_charges", { precision: 20, scale: 2 }).notNull().default("0"),
  transportFees: decimal("transport_fees", { precision: 20, scale: 2 }).notNull().default("0"),
  totalCharges: decimal("total_charges", { precision: 20, scale: 2 }).notNull().default("0"),
  totalBales: decimal("total_bales", { precision: 15, scale: 3 }).notNull(),
  additionalCostPerBale: decimal("additional_cost_per_bale", { precision: 20, scale: 2 }).notNull(),
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
  offloadDate: z.string().min(1, "Offload date is required").regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD required)"),
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

export const containerOffloadItems = pgTable("container_offload_items", {
  id: serial("id").primaryKey(),
  offloadId: integer("offload_id").notNull(),
  stockItemId: integer("stock_item_id").notNull(),
  quantity: decimal("quantity", { precision: 15, scale: 3 }).notNull(),
  rate: decimal("rate", { precision: 20, scale: 2 }).notNull(),
  totalValue: decimal("total_value", { precision: 20, scale: 2 }).notNull(),
});

export type ContainerOffloadItem = typeof containerOffloadItems.$inferSelect;

export const vouchers = pgTable("vouchers", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  locationId: integer("location_id"),
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
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertVoucherSchema = createInsertSchema(vouchers).omit({
  id: true,
  createdAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  locationId: z.number().optional(),
  locationName: z.string().optional(),
  voucherNumber: z.string().min(1, "Voucher number is required"),
  voucherType: z.enum(["Payment", "Receipt", "Journal", "Sales", "Purchase", "Contra", "Stock Transfer", "Credit Note", "Debit Note"]),
  voucherDate: z.string().min(1, "Voucher date is required"),
  totalAmount: z.string().min(1, "Total amount is required"),
  currency: z.enum(["USD", "CFA"]).default("USD"),
  optional: z.boolean().optional().default(false),
  shiftId: z.number().optional(),
  exchangeRate: z.string().optional(),
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
  debitAmount: decimal("debit_amount", { precision: 20, scale: 2 }).default("0"),
  creditAmount: decimal("credit_amount", { precision: 20, scale: 2 }).default("0"),
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

// Credit/Debit Note Items - tracks which stock items are returned with which voucher
export const creditNoteItems = pgTable("credit_note_items", {
  id: serial("id").primaryKey(),
  voucherId: integer("voucher_id").notNull(),
  stockItemId: integer("stock_item_id").notNull(),
  locationId: integer("location_id").notNull(),
  quantity: decimal("quantity", { precision: 15, scale: 3 }).notNull(),
  rate: decimal("rate", { precision: 20, scale: 2 }).notNull(),
  inventoryCost: decimal("inventory_cost", { precision: 20, scale: 2 }).notNull().default("0"),
  totalValue: decimal("total_value", { precision: 20, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCreditNoteItemSchema = createInsertSchema(creditNoteItems).omit({
  id: true,
  createdAt: true,
}).extend({
  voucherId: z.number().min(1, "Voucher is required"),
  stockItemId: z.number().min(1, "Stock item is required"),
  locationId: z.number().min(1, "Location is required"),
  quantity: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Quantity must be positive"),
  rate: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Rate must be non-negative"),
  totalValue: z.string(),
});

export type InsertCreditNoteItem = z.infer<typeof insertCreditNoteItemSchema>;
export type CreditNoteItem = typeof creditNoteItems.$inferSelect;

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
  sourceLocationId: integer("source_location_id"), // Nullable for multi-source transfers
  destinationLocationId: integer("destination_location_id").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertStockTransferVoucherSchema = createInsertSchema(stockTransferVouchers).omit({
  id: true,
  createdAt: true,
}).extend({
  voucherId: z.number().min(1, "Voucher is required"),
  sourceLocationId: z.number().optional(), // Optional for multi-source transfers
  destinationLocationId: z.number().min(1, "Destination location is required"),
});

export type InsertStockTransferVoucher = z.infer<typeof insertStockTransferVoucherSchema>;
export type StockTransferVoucher = typeof stockTransferVouchers.$inferSelect;

// Stock Transfer Items
export const stockTransferItems = pgTable("stock_transfer_items", {
  id: serial("id").primaryKey(),
  transferId: integer("transfer_id").notNull(),
  stockItemId: integer("stock_item_id").notNull(),
  sourceLocationId: integer("source_location_id"),
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

// Update schemas for stock transfers and adjustments
export const updateStockTransferItemSchema = z.object({
  sourceLocationId: z.coerce.number().int().positive("Source location must be a positive integer"),
  stockItemId: z.coerce.number().int().positive("Stock item must be a positive integer"),
  quantity: z.coerce.number().finite("Quantity must be a finite number").refine((val) => val !== 0, "Quantity cannot be zero"),
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
  quantity: z.coerce.number().finite("Quantity must be a finite number").refine((val) => val !== 0, "Quantity cannot be zero"),
  rate: z.coerce.number().nonnegative("Rate must be non-negative").finite("Rate must be a finite number"),
});

export const updateStockAdjustmentSchema = z.object({
  locationId: z.coerce.number().int().positive("Location must be a positive integer"),
  adjustmentType: z.enum(["Production", "Consumption", "Mixed"]),
  notes: z.string().optional(),
  items: z.array(updateStockAdjustmentItemSchema).min(1, "At least one item is required"),
});

export type UpdateStockAdjustment = z.infer<typeof updateStockAdjustmentSchema>;

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
  deletedAt: timestamp("deleted_at"),
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
  openingBalanceSide: z.enum(["Dr", "Cr"]).optional().or(z.literal("")),
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
  currency: text("currency").notNull().default("USD"),
  invoiceNumber: varchar("invoice_number", { length: 100 }),
  paymentStatus: text("payment_status").notNull().default("PENDING"),
  paidAmount: decimal("paid_amount", { precision: 20, scale: 2 }).notNull().default("0"),
  voucherId: integer("voucher_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  uniqueCompanyContainer: uniqueIndex("container_sales_company_container_unique").on(t.companyId, t.containerId),
}));

export const insertContainerSaleSchema = createInsertSchema(containerSales).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  containerId: z.number().min(1, "Container is required"),
  customerId: z.number().min(1, "Customer is required"),
  saleDate: z.string().min(1, "Sale date is required"),
  containerCost: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Container cost must be non-negative"),
  commission: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Commission must be non-negative"),
  commissionAccountId: z.number().optional(),
  totalAmount: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Total amount must be positive"),
  currency: z.string().min(1).default("USD"),
  invoiceNumber: z.string().optional(),
  paymentStatus: z.enum(["PENDING", "PARTIAL", "PAID"]).optional(),
  paidAmount: z.string().optional(),
  voucherId: z.number().optional(),
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
  isOpeningBalance: boolean("is_opening_balance").notNull().default(false),
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
  isOpeningBalance: z.boolean().optional().default(false),
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

// Dashboard Payable Accounts - user-selected payable accounts to display in dashboard
export const dashboardPayableAccounts = pgTable("dashboard_payable_accounts", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  accountId: integer("account_id").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertDashboardPayableAccountSchema = createInsertSchema(dashboardPayableAccounts).omit({
  id: true,
  createdAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  accountId: z.number().min(1, "Account is required"),
  displayOrder: z.number().optional(),
});

export type InsertDashboardPayableAccount = z.infer<typeof insertDashboardPayableAccountSchema>;
export type DashboardPayableAccount = typeof dashboardPayableAccounts.$inferSelect;

// Company Settings - stores company-specific configuration like logos
export const companySettings = pgTable("company_settings", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().unique(),
  logoUrl: text("logo_url"),
  logoFileName: text("logo_file_name"),
  logoUpdatedAt: timestamp("logo_updated_at"),
  invoiceFooter: text("invoice_footer"),
  parentCreditAccountId: integer("parent_credit_account_id"),
  netPositionAdjustment: decimal("net_position_adjustment", { precision: 15, scale: 2 }).default("0"),
  posExcelImportEnabled: boolean("pos_excel_import_enabled").default(false),
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
  parentCreditAccountId: z.number().optional(),
  netPositionAdjustment: z.string().optional(),
  posExcelImportEnabled: z.boolean().optional(),
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
  customerId: integer("customer_id"),
  soldDate: timestamp("sold_date"),
  status: text("status").notNull().default("AVAILABLE"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniqueCompanyBarcode: uniqueIndex("bales_company_barcode_unique").on(t.companyId, t.barcode),
}));

export const insertBaleSchema = createInsertSchema(bales).omit({
  id: true,
  createdAt: true,
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

// Pending Barcodes - imported barcodes waiting to be scanned and converted to bales
export const pendingBarcodes = pgTable("pending_barcodes", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  barcode: varchar("barcode", { length: 100 }).notNull(),
  category: text("category"),
  grade: text("grade"),
  origin: text("origin"),
  printed: boolean("printed").notNull().default(false),
  used: boolean("used").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniqueCompanyPendingBarcode: uniqueIndex("pending_barcodes_company_barcode_unique").on(t.companyId, t.barcode),
}));

export const insertPendingBarcodeSchema = createInsertSchema(pendingBarcodes).omit({
  id: true,
  createdAt: true,
});

export type InsertPendingBarcode = z.infer<typeof insertPendingBarcodeSchema>;
export type PendingBarcode = typeof pendingBarcodes.$inferSelect;

// Production Raw Stock - tracks container kg offloaded to production
export const productionRawStock = pgTable("production_raw_stock", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  containerId: integer("container_id").notNull(),
  receivedKg: decimal("received_kg", { precision: 15, scale: 3 }).notNull(),
  usedKg: decimal("used_kg", { precision: 15, scale: 3 }).notNull().default("0"),
  costPerKg: decimal("cost_per_kg", { precision: 20, scale: 4 }).notNull(),
  offloadedAt: timestamp("offloaded_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniqueCompanyContainer: uniqueIndex("production_raw_stock_company_container_unique").on(t.companyId, t.containerId),
}));

export const insertProductionRawStockSchema = createInsertSchema(productionRawStock).omit({
  id: true,
  createdAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  containerId: z.number().min(1, "Container is required"),
  receivedKg: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Received kg must be positive"),
  usedKg: z.string().optional(),
  costPerKg: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Cost per kg must be non-negative"),
});

export type InsertProductionRawStock = z.infer<typeof insertProductionRawStockSchema>;
export type ProductionRawStock = typeof productionRawStock.$inferSelect;

// Mix Batches - combines containers into batches for bale production
export const mixBatches = pgTable("mix_batches", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  batchCode: varchar("batch_code", { length: 50 }).notNull(),
  name: text("name"),
  totalWeightKg: decimal("total_weight_kg", { precision: 15, scale: 3 }).notNull(),
  usedKg: decimal("used_kg", { precision: 15, scale: 3 }).notNull().default("0"),
  costPerKg: decimal("cost_per_kg", { precision: 20, scale: 4 }).notNull(),
  totalCost: decimal("total_cost", { precision: 20, scale: 2 }).notNull(),
  notes: text("notes"),
  status: text("status").notNull().default("ACTIVE"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertMixBatchSchema = createInsertSchema(mixBatches).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  batchCode: z.string().optional(),
  name: z.string().optional(),
  totalWeightKg: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Total weight must be positive"),
  totalCost: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Total cost must be non-negative"),
  costPerKg: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Cost per kg must be non-negative"),
  usedKg: z.string().optional(),
  status: z.enum(["ACTIVE", "COMPLETED"]).optional(),
});

export type InsertMixBatch = z.infer<typeof insertMixBatchSchema>;
export type MixBatch = typeof mixBatches.$inferSelect;

// Mix Batch Sources - tracks which containers or existing batches contribute to a mix batch
export const mixBatchSources = pgTable("mix_batch_sources", {
  id: serial("id").primaryKey(),
  mixBatchId: integer("mix_batch_id").notNull(),
  containerId: integer("container_id"),
  sourceBatchId: integer("source_batch_id"),
  weightKg: decimal("weight_kg", { precision: 15, scale: 3 }).notNull(),
  costPerKg: decimal("cost_per_kg", { precision: 20, scale: 2 }).notNull(),
  totalCost: decimal("total_cost", { precision: 20, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertMixBatchSourceSchema = createInsertSchema(mixBatchSources).omit({
  id: true,
  createdAt: true,
}).extend({
  mixBatchId: z.number().min(1, "Mix batch is required"),
  containerId: z.number().optional().nullable(),
  sourceBatchId: z.number().optional().nullable(),
  weightKg: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Weight must be positive"),
  costPerKg: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Cost per kg must be non-negative"),
  totalCost: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Total cost must be non-negative"),
});

export type InsertMixBatchSource = z.infer<typeof insertMixBatchSourceSchema>;
export type MixBatchSource = typeof mixBatchSources.$inferSelect;

// Bale Product Categories
export const baleProductCategories = pgTable("bale_product_categories", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  uniqueCompanyName: uniqueIndex("bale_product_categories_company_name_unique").on(t.companyId, t.name),
}));

export const insertBaleProductCategorySchema = createInsertSchema(baleProductCategories).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  name: z.string().min(1, "Category name is required"),
  isActive: z.boolean().optional(),
});

export type InsertBaleProductCategory = z.infer<typeof insertBaleProductCategorySchema>;
export type BaleProductCategory = typeof baleProductCategories.$inferSelect;

// Bale Products - master list of product types with codes
export const baleProducts = pgTable("bale_products", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  code: varchar("code", { length: 50 }).notNull(),
  articleCode: varchar("article_code", { length: 50 }),
  name: text("name").notNull(),
  description: text("description"),
  weightPerBaleKg: decimal("weight_per_bale_kg", { precision: 10, scale: 2 }),
  categoryId: integer("category_id"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  uniqueCompanyCode: uniqueIndex("bale_products_company_code_unique").on(t.companyId, t.code),
  uniqueCompanyArticleCode: uniqueIndex("bale_products_company_article_code_unique").on(t.companyId, t.articleCode),
}));

export const insertBaleProductSchema = createInsertSchema(baleProducts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  code: z.string().optional(),
  articleCode: z.string().min(1, "Article code is required"),
  name: z.string().min(1, "Product name is required"),
  description: z.string().optional(),
  weightPerBaleKg: z.string().optional(),
  categoryId: z.number().optional().nullable(),
  active: z.boolean().optional(),
});

export type InsertBaleProduct = z.infer<typeof insertBaleProductSchema>;
export type BaleProduct = typeof baleProducts.$inferSelect;

// Bale Sequences - tracks next barcode number per company
export const baleSequences = pgTable("bale_sequences", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  nextNumber: integer("next_number").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniqueCompanyId: uniqueIndex("bale_sequences_company_unique").on(t.companyId),
}));

export type BaleSequence = typeof baleSequences.$inferSelect;

// Pressing Batches - groups bales created during pressing for count validation
export const pressingBatches = pgTable("pressing_batches", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  mixBatchId: integer("mix_batch_id"),
  productId: integer("product_id"),
  expectedCount: integer("expected_count").notNull(),
  status: text("status").notNull().default("PENDING"),
  createdBy: integer("created_by"),
  finalizedAt: timestamp("finalized_at"),
  finalizedLocationId: integer("finalized_location_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPressingBatchSchema = createInsertSchema(pressingBatches).omit({
  id: true,
  createdAt: true,
});

export type InsertPressingBatch = z.infer<typeof insertPressingBatchSchema>;
export type PressingBatch = typeof pressingBatches.$inferSelect;

// Production Bales - extends the concept with mix batch tracking
export const productionBales = pgTable("production_bales", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  mixBatchId: integer("mix_batch_id"),
  productId: integer("product_id"),
  locationId: integer("location_id"),
  pressingBatchId: integer("pressing_batch_id"),
  baleCode: varchar("bale_code", { length: 50 }).notNull(),
  barcodeValue: varchar("barcode_value", { length: 100 }).notNull(),
  category: text("category"),
  grade: text("grade"),
  quantity: integer("quantity").notNull().default(1),
  weightKg: decimal("weight_kg", { precision: 15, scale: 3 }).notNull(),
  costPerKg: decimal("cost_per_kg", { precision: 20, scale: 2 }).notNull(),
  totalCost: decimal("total_cost", { precision: 20, scale: 2 }).notNull(),
  warehouseLocation: text("warehouse_location"),
  status: text("status").notNull().default("LABEL_PRINTED"),
  pressedAt: timestamp("pressed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  uniqueCompanyBarcodeValue: uniqueIndex("production_bales_company_barcode_unique").on(t.companyId, t.barcodeValue),
}));

export const insertProductionBaleSchema = createInsertSchema(productionBales).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  mixBatchId: z.number().optional(),
  productId: z.number().optional(),
  baleCode: z.string().min(1, "Bale code is required"),
  barcodeValue: z.string().min(1, "Barcode value is required"),
  category: z.string().optional(),
  grade: z.string().optional(),
  weightKg: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Weight must be positive"),
  costPerKg: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Cost per kg must be non-negative"),
  totalCost: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Total cost must be non-negative"),
  warehouseLocation: z.string().optional(),
  status: z.enum(["PENDING", "LABEL_PRINTED", "PRESSED", "IN_STOCK", "RESERVED", "SOLD"]).optional(),
  pressedAt: z.string().optional(),
});

export type InsertProductionBale = z.infer<typeof insertProductionBaleSchema>;
export type ProductionBale = typeof productionBales.$inferSelect;

// Bale Transfers - tracks bale movements between locations
export const baleTransfers = pgTable("bale_transfers", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  sourceLocationId: integer("source_location_id").notNull(),
  destinationLocationId: integer("destination_location_id").notNull(),
  transferDate: date("transfer_date").notNull(),
  notes: text("notes"),
  createdBy: varchar("created_by").notNull(),
  updatedBy: varchar("updated_by"),
  status: text("status").notNull().default("PENDING"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertBaleTransferSchema = createInsertSchema(baleTransfers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  sourceLocationId: z.number().min(1, "Source location is required"),
  destinationLocationId: z.number().min(1, "Destination location is required"),
  transferDate: z.string().min(1, "Transfer date is required"),
  notes: z.string().optional(),
  createdBy: z.string().min(1, "Creator is required"),
  updatedBy: z.string().optional(),
  status: z.enum(["PENDING", "COMPLETED"]).optional(),
});

export type InsertBaleTransfer = z.infer<typeof insertBaleTransferSchema>;
export type BaleTransfer = typeof baleTransfers.$inferSelect;

// Bale Transfer Items - individual bales being transferred
export const baleTransferItems = pgTable("bale_transfer_items", {
  id: serial("id").primaryKey(),
  transferId: integer("transfer_id").notNull(),
  productionBaleId: integer("production_bale_id").notNull(),
  quantity: integer("quantity").notNull().default(1),
  weightKg: decimal("weight_kg", { precision: 15, scale: 3 }).notNull(),
  costPerKg: decimal("cost_per_kg", { precision: 20, scale: 2 }).notNull(),
  totalCost: decimal("total_cost", { precision: 20, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertBaleTransferItemSchema = createInsertSchema(baleTransferItems).omit({
  id: true,
  createdAt: true,
}).extend({
  transferId: z.number().min(1, "Transfer is required"),
  productionBaleId: z.number().min(1, "Bale is required"),
  quantity: z.number().min(1, "Quantity must be at least 1"),
  weightKg: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Weight must be positive"),
  costPerKg: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Cost per kg must be non-negative"),
  totalCost: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Total cost must be non-negative"),
});

export type InsertBaleTransferItem = z.infer<typeof insertBaleTransferItemSchema>;
export type BaleTransferItem = typeof baleTransferItems.$inferSelect;

// Customer Balances - ledger of customer transactions
export const customerBalances = pgTable("customer_balances", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  customerId: integer("customer_id").notNull(),
  transactionDate: date("transaction_date").notNull(),
  transactionType: text("transaction_type").notNull(),
  referenceId: integer("reference_id"),
  referenceType: text("reference_type"),
  debitAmount: decimal("debit_amount", { precision: 20, scale: 2 }).notNull().default("0"),
  creditAmount: decimal("credit_amount", { precision: 20, scale: 2 }).notNull().default("0"),
  balance: decimal("balance", { precision: 20, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  customerCompanyIdx: index("customer_balances_customer_company_idx").on(t.customerId, t.companyId),
}));

export const insertCustomerBalanceSchema = createInsertSchema(customerBalances).omit({
  id: true,
  createdAt: true,
}).extend({
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

// Stock Item Location Prices - allows different selling prices per location
export const stockItemLocationPrices = pgTable("stock_item_location_prices", {
  id: serial("id").primaryKey(),
  stockItemId: integer("stock_item_id").notNull(),
  locationId: integer("location_id").notNull(),
  sellingPrice: decimal("selling_price", { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  uniqueItemLocation: uniqueIndex("stock_item_location_prices_item_location_unique").on(t.stockItemId, t.locationId),
}));

export const insertStockItemLocationPriceSchema = createInsertSchema(stockItemLocationPrices).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  stockItemId: z.number().min(1, "Stock item is required"),
  locationId: z.number().min(1, "Location is required"),
  sellingPrice: z.string().min(1, "Selling price is required"),
});

export type InsertStockItemLocationPrice = z.infer<typeof insertStockItemLocationPriceSchema>;
export type StockItemLocationPrice = typeof stockItemLocationPrices.$inferSelect;

// User Preferences - stores user-specific settings like date format
export const userPreferences = pgTable("user_preferences", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  dateFormat: text("date_format").notNull().default("MM/DD/YYYY"),
  preferredCurrency: varchar("preferred_currency", { length: 10 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertUserPreferencesSchema = createInsertSchema(userPreferences).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  userId: z.string().min(1, "User ID is required"),
  dateFormat: z.enum(["MM/DD/YYYY", "DD/MM/YYYY"]).default("MM/DD/YYYY"),
  preferredCurrency: z.string().nullable().optional(),
});

export type InsertUserPreferences = z.infer<typeof insertUserPreferencesSchema>;
export type UserPreferences = typeof userPreferences.$inferSelect;

// Chat Messages - stores AI chatbot conversation history
export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  userId: varchar("user_id").notNull(),
  role: text("role").notNull(), // 'user' or 'assistant'
  content: text("content").notNull(),
  sessionId: varchar("session_id").notNull(), // Groups messages in a conversation
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  sessionIdx: index("chat_messages_session_idx").on(t.sessionId),
  userIdx: index("chat_messages_user_idx").on(t.userId),
  companyIdx: index("chat_messages_company_idx").on(t.companyId),
}));

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({
  id: true,
  createdAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  userId: z.string().min(1, "User ID is required"),
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1, "Content is required"),
  sessionId: z.string().min(1, "Session ID is required"),
});

export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;

// Dashboard Account Selections - stores user-selected accounts for dashboard widgets
export const dashboardAccountSelections = pgTable("dashboard_account_selections", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  selectionType: text("selection_type").notNull(), // 'availableCash' or 'cashToPay'
  accountIds: integer("account_ids").array().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  uniqueCompanyType: uniqueIndex("dashboard_account_selections_company_type_unique").on(t.companyId, t.selectionType),
}));

export const insertDashboardAccountSelectionSchema = createInsertSchema(dashboardAccountSelections).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  selectionType: z.enum(["availableCash", "cashToPay"]),
  accountIds: z.array(z.number()).default([]),
});

export type InsertDashboardAccountSelection = z.infer<typeof insertDashboardAccountSelectionSchema>;
export type DashboardAccountSelection = typeof dashboardAccountSelections.$inferSelect;

// Role Feature Permissions - controls which features are accessible by each role per company
export const roleFeaturePermissions = pgTable("role_feature_permissions", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  role: text("role").notNull(),
  featureKey: text("feature_key").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  uniqueCompanyRoleFeature: uniqueIndex("role_feature_permissions_unique").on(t.companyId, t.role, t.featureKey),
}));

export const insertRoleFeaturePermissionSchema = createInsertSchema(roleFeaturePermissions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  role: z.enum(["Admin", "Owner", "Manager", "POS1", "POS2", "POS3", "POS4", "POS5", "POS6"]),
  featureKey: z.string().min(1, "Feature key is required"),
  enabled: z.boolean().default(true),
});

export type InsertRoleFeaturePermission = z.infer<typeof insertRoleFeaturePermissionSchema>;
export type RoleFeaturePermission = typeof roleFeaturePermissions.$inferSelect;

// Stock Group Location Archives - for archiving/restoring inventory by stock group at a location
// stockGroupId is nullable to support archiving "Uncategorized" items (items with no stock group)
export const stockGroupLocationArchives = pgTable("stock_group_location_archives", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  locationId: integer("location_id").notNull(),
  stockGroupId: integer("stock_group_id"),
  locationName: text("location_name").notNull(),
  stockGroupName: text("stock_group_name").notNull(),
  totalQuantity: decimal("total_quantity", { precision: 15, scale: 3 }).notNull().default("0"),
  totalValue: decimal("total_value", { precision: 20, scale: 2 }).notNull().default("0"),
  itemCount: integer("item_count").notNull().default(0),
  archivedBy: varchar("archived_by").notNull(),
  archivedAt: timestamp("archived_at").notNull().defaultNow(),
  restoredAt: timestamp("restored_at"),
  deletedAt: timestamp("deleted_at"),
  notes: text("notes"),
});

export const insertStockGroupLocationArchiveSchema = createInsertSchema(stockGroupLocationArchives).omit({
  id: true,
  archivedAt: true,
});

export type InsertStockGroupLocationArchive = z.infer<typeof insertStockGroupLocationArchiveSchema>;
export type StockGroupLocationArchive = typeof stockGroupLocationArchives.$inferSelect;

// Archive Items - individual inventory records within an archive
export const stockGroupLocationArchiveItems = pgTable("stock_group_location_archive_items", {
  id: serial("id").primaryKey(),
  archiveId: integer("archive_id").notNull(),
  stockItemId: integer("stock_item_id").notNull(),
  stockItemCode: varchar("stock_item_code", { length: 50 }).notNull(),
  stockItemName: text("stock_item_name").notNull(),
  quantity: decimal("quantity", { precision: 15, scale: 3 }).notNull(),
  averageRate: decimal("average_rate", { precision: 20, scale: 2 }).notNull(),
  totalValue: decimal("total_value", { precision: 20, scale: 2 }).notNull(),
});

export const insertStockGroupLocationArchiveItemSchema = createInsertSchema(stockGroupLocationArchiveItems).omit({
  id: true,
});

export type InsertStockGroupLocationArchiveItem = z.infer<typeof insertStockGroupLocationArchiveItemSchema>;
export type StockGroupLocationArchiveItem = typeof stockGroupLocationArchiveItems.$inferSelect;

// System Settings - global application-wide settings
export const systemSettings = pgTable("system_settings", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 100 }).notNull().unique(),
  value: text("value"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSystemSettingSchema = createInsertSchema(systemSettings).omit({
  id: true,
  updatedAt: true,
}).extend({
  key: z.string().min(1, "Key is required"),
  value: z.string().optional(),
});

export type InsertSystemSetting = z.infer<typeof insertSystemSettingSchema>;
export type SystemSetting = typeof systemSettings.$inferSelect;

// List of all available features for permission control
export const FEATURE_KEYS = [
  "dashboard",
  "pos",
  "pos_daybook",
  "stock_items",
  "location_inventory",
  "containers",
  "stock_otw",
  "factory_production",
  "analytics",
  "accounts",
  "suppliers",
  "customers",
  "vouchers",
  "daybook",
  "payroll",
  "create",
  "stock_query",
  "location_summary",
  "sales_report",
  "settings",
  "optional_vouchers",
] as const;

export type FeatureKey = typeof FEATURE_KEYS[number];

// Map feature keys to their route paths
export const FEATURE_ROUTES: Record<FeatureKey, string> = {
  dashboard: "/",
  pos: "/pos",
  pos_daybook: "/pos-daybook",
  stock_items: "/stock-items",
  location_inventory: "/location-inventory",
  containers: "/containers",
  stock_otw: "/stock-otw",
  factory_production: "/factory-production",
  analytics: "/analytics",
  accounts: "/accounts",
  suppliers: "/suppliers",
  customers: "/customers",
  vouchers: "/vouchers",
  daybook: "/daybook",
  payroll: "/payroll",
  create: "/create",
  stock_query: "/stock-query",
  location_summary: "/location-summary",
  sales_report: "/sales-report",
  settings: "/settings",
  optional_vouchers: "/optional-vouchers",
};

// Map routes to feature keys (reverse lookup)
export const ROUTE_TO_FEATURE: Record<string, FeatureKey> = Object.fromEntries(
  Object.entries(FEATURE_ROUTES).map(([key, route]) => [route, key as FeatureKey])
) as Record<string, FeatureKey>;

// Container tracking update schema for OTW tracking
export const updateContainerTrackingSchema = z.object({
  shopName: z.string().optional(),
  eta: z.string().nullable().optional(),
  etaSource: z.enum(["manual", "api"]).optional(),
  transporter: z.string().optional(),
  transportFee: z.string().nullable().optional(),
  numberPlate: z.string().optional(),
  trackingLocation: z.string().optional(),
  borderDate: z.string().nullable().optional(),
  offloadDate: z.string().nullable().optional(),
  agent: z.string().optional(),
  dutyFee: z.string().nullable().optional(),
  docReceived: z.boolean().optional(),
  trackingDescription: z.string().optional(),
});

export type UpdateContainerTracking = z.infer<typeof updateContainerTrackingSchema>;

// Container tracking Excel import schema
export const containerTrackingImportRowSchema = z.object({
  containerNumber: z.coerce.string(),
  shopName: z.coerce.string().optional(),
  eta: z.coerce.string().optional(),
  transporter: z.coerce.string().optional(),
  transportFee: z.coerce.string().optional(),
  numberPlate: z.coerce.string().optional(),
  trackingLocation: z.coerce.string().optional(),
  borderDate: z.coerce.string().optional(),
  offloadDate: z.coerce.string().optional(),
  agent: z.coerce.string().optional(),
  dutyFee: z.coerce.string().optional(),
  docReceived: z.union([z.boolean(), z.coerce.string()]).optional(),
  trackingDescription: z.coerce.string().optional(),
});

export type ContainerTrackingImportRow = z.infer<typeof containerTrackingImportRowSchema>;

// User Presence tracking for active users monitoring
export const userPresence = pgTable("user_presence", {
  id: serial("id").primaryKey(),
  sessionId: varchar("session_id", { length: 255 }).notNull(),
  userId: varchar("user_id").notNull(),
  username: text("username").notNull(),
  currentRoute: text("current_route").notNull().default("/"),
  companyId: integer("company_id"),
  companyName: text("company_name"),
  role: text("role"),
  lastSeen: timestamp("last_seen").notNull().defaultNow(),
}, (t) => ({
  uniqueSession: uniqueIndex("user_presence_session_unique").on(t.sessionId),
}));

export const insertUserPresenceSchema = createInsertSchema(userPresence).omit({
  id: true,
});

export type InsertUserPresence = z.infer<typeof insertUserPresenceSchema>;
export type UserPresence = typeof userPresence.$inferSelect;

export const updatePresenceSchema = z.object({
  route: z.string(),
});

export type UpdatePresence = z.infer<typeof updatePresenceSchema>;

// POS Shifts table - tracks POS user work sessions
export const posShifts = pgTable("pos_shifts", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  locationId: integer("location_id").notNull(),
  userId: varchar("user_id").notNull(),
  username: text("username").notNull(),
  cashAccountId: integer("cash_account_id"),
  posStation: integer("pos_station"),
  status: text("status").notNull().default("open"),
  openedAt: timestamp("opened_at").notNull().defaultNow(),
  closedAt: timestamp("closed_at"),
  openingCash: decimal("opening_cash", { precision: 20, scale: 2 }).notNull().default("0"),
  closingCash: decimal("closing_cash", { precision: 20, scale: 2 }),
  expectedCash: decimal("expected_cash", { precision: 20, scale: 2 }),
  variance: decimal("variance", { precision: 20, scale: 2 }),
  salesCount: integer("sales_count").default(0),
  salesTotal: decimal("sales_total", { precision: 20, scale: 2 }).default("0"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPosShiftSchema = createInsertSchema(posShifts).omit({
  id: true,
  createdAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  locationId: z.number().min(1, "Location is required"),
  userId: z.string().min(1, "User ID is required"),
  username: z.string().min(1, "Username is required"),
  cashAccountId: z.number().optional(),
  posStation: z.number().optional(),
  openingCash: z.string().default("0"),
  status: z.enum(["open", "closed"]).default("open"),
});

export type InsertPosShift = z.infer<typeof insertPosShiftSchema>;
export type PosShift = typeof posShifts.$inferSelect;

export const closePosShiftSchema = z.object({
  closingCash: z.string().min(1, "Closing cash is required"),
  notes: z.string().optional(),
});

export type ClosePosShift = z.infer<typeof closePosShiftSchema>;

// Offline POS Queue - stores transactions for offline sync
export const posOfflineQueue = pgTable("pos_offline_queue", {
  id: serial("id").primaryKey(),
  clientId: varchar("client_id", { length: 100 }).notNull(),
  companyId: integer("company_id").notNull(),
  locationId: integer("location_id").notNull(),
  userId: varchar("user_id").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  retries: integer("retries").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  processedAt: timestamp("processed_at"),
}, (t) => ({
  uniqueClientId: uniqueIndex("pos_offline_queue_client_unique").on(t.clientId),
}));

export const insertPosOfflineQueueSchema = createInsertSchema(posOfflineQueue).omit({
  id: true,
  createdAt: true,
  processedAt: true,
});

export type InsertPosOfflineQueue = z.infer<typeof insertPosOfflineQueueSchema>;
export type PosOfflineQueue = typeof posOfflineQueue.$inferSelect;

// Reference Sequences - tracks next reference number per company for label prints
export const referenceSequences = pgTable("reference_sequences", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  nextNumber: integer("next_number").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniqueCompanyId: uniqueIndex("reference_sequences_company_unique").on(t.companyId),
}));

export type ReferenceSequence = typeof referenceSequences.$inferSelect;

// Bale Label Prints - traceability records for every printed label
export const baleLabelPrints = pgTable("bale_label_prints", {
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
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniqueReference: uniqueIndex("bale_label_prints_reference_unique").on(t.companyId, t.referenceNumber),
}));

export const insertBaleLabelPrintSchema = createInsertSchema(baleLabelPrints).omit({
  id: true,
  createdAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  productionBaleId: z.number().optional(),
  productId: z.number().optional(),
  articleCode: z.string().min(1, "Article code is required"),
  referenceNumber: z.string().min(1, "Reference number is required"),
  pieces: z.number().min(1, "Pieces must be at least 1"),
  approxWeightKg: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Weight must be positive"),
  printedByUserId: z.string().optional(),
  printedAt: z.date().optional(),
  scannedByUserId: z.string().optional(),
  scannedAt: z.date().optional(),
});

export type InsertBaleLabelPrint = z.infer<typeof insertBaleLabelPrintSchema>;
export type BaleLabelPrint = typeof baleLabelPrints.$inferSelect;

// ============================================================
// FACTORY DOMAIN TABLES (isolated from ERP)
// ============================================================

export const factorySuppliers = pgTable("factory_suppliers", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  contactPerson: text("contact_person"),
  phone: varchar("phone", { length: 50 }),
  email: varchar("email", { length: 200 }),
  address: text("address"),
  notes: text("notes"),
  openingBalance: decimal("opening_balance", { precision: 20, scale: 4 }).notNull().default("0"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  uniqueCompanyName: uniqueIndex("factory_suppliers_company_name_unique").on(t.companyId, t.name),
}));

export const insertFactorySupplierSchema = createInsertSchema(factorySuppliers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  name: z.string().min(1, "Supplier name is required"),
  contactPerson: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  openingBalance: z.string().optional(),
  isActive: z.boolean().optional(),
});

export type InsertFactorySupplier = z.infer<typeof insertFactorySupplierSchema>;
export type FactorySupplier = typeof factorySuppliers.$inferSelect;

export const factoryCategories = pgTable("factory_categories", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  uniqueCompanyName: uniqueIndex("factory_categories_company_name_unique").on(t.companyId, t.name),
}));

export const insertFactoryCategorySchema = createInsertSchema(factoryCategories).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  name: z.string().min(1, "Category name is required"),
  isActive: z.boolean().optional(),
});

export type InsertFactoryCategory = z.infer<typeof insertFactoryCategorySchema>;
export type FactoryCategory = typeof factoryCategories.$inferSelect;

export const factoryBaleProducts = pgTable("factory_bale_products", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  code: varchar("code", { length: 50 }).notNull(),
  articleCode: varchar("article_code", { length: 50 }),
  name: text("name").notNull(),
  description: text("description"),
  weightPerBaleKg: decimal("weight_per_bale_kg", { precision: 10, scale: 2 }),
  categoryId: integer("category_id"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  uniqueCompanyCode: uniqueIndex("factory_bale_products_company_code_unique").on(t.companyId, t.code),
  uniqueCompanyArticleCode: uniqueIndex("factory_bale_products_company_article_code_unique").on(t.companyId, t.articleCode),
}));

export const insertFactoryBaleProductSchema = createInsertSchema(factoryBaleProducts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  code: z.string().optional(),
  articleCode: z.string().min(1, "Article code is required"),
  name: z.string().min(1, "Product name is required"),
  description: z.string().optional().nullable(),
  weightPerBaleKg: z.string().optional().nullable(),
  categoryId: z.number().optional().nullable(),
  active: z.boolean().optional(),
});

export type InsertFactoryBaleProduct = z.infer<typeof insertFactoryBaleProductSchema>;
export type FactoryBaleProduct = typeof factoryBaleProducts.$inferSelect;

export const factoryContainers = pgTable("factory_containers", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  containerNumber: varchar("container_number", { length: 100 }).notNull(),
  supplierId: integer("supplier_id"),
  origin: text("origin"),
  totalKg: decimal("total_kg", { precision: 15, scale: 3 }),
  ratePerKg: decimal("rate_per_kg", { precision: 20, scale: 4 }),
  declaredKg: decimal("declared_kg", { precision: 15, scale: 3 }),
  actualReceivedKg: decimal("actual_received_kg", { precision: 15, scale: 3 }),
  finalPayableAmount: decimal("final_payable_amount", { precision: 20, scale: 4 }),
  differenceKg: decimal("difference_kg", { precision: 15, scale: 3 }),
  arrivalDate: date("arrival_date"),
  notes: text("notes"),
  status: text("status").notNull().default("PENDING"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertFactoryContainerSchema = createInsertSchema(factoryContainers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  containerNumber: z.string().min(1, "Container number is required"),
  supplierId: z.number().optional().nullable(),
  origin: z.string().optional().nullable(),
  totalKg: z.string().optional().nullable(),
  ratePerKg: z.string().optional().nullable(),
  arrivalDate: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  status: z.string().optional(),
});

export type InsertFactoryContainer = z.infer<typeof insertFactoryContainerSchema>;
export type FactoryContainer = typeof factoryContainers.$inferSelect;

export const factoryRawStock = pgTable("factory_raw_stock", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  containerId: integer("container_id").notNull(),
  receivedKg: decimal("received_kg", { precision: 15, scale: 3 }).notNull(),
  usedKg: decimal("used_kg", { precision: 15, scale: 3 }).notNull().default("0"),
  costPerKg: decimal("cost_per_kg", { precision: 20, scale: 4 }).notNull(),
  offloadedAt: timestamp("offloaded_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniqueCompanyContainer: uniqueIndex("factory_raw_stock_company_container_unique").on(t.companyId, t.containerId),
}));

export const insertFactoryRawStockSchema = createInsertSchema(factoryRawStock).omit({
  id: true,
  createdAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  containerId: z.number().min(1, "Container is required"),
  receivedKg: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Received kg must be positive"),
  usedKg: z.string().optional(),
  costPerKg: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Cost per kg must be non-negative"),
});

export type InsertFactoryRawStock = z.infer<typeof insertFactoryRawStockSchema>;
export type FactoryRawStock = typeof factoryRawStock.$inferSelect;

export const factoryMixBatches = pgTable("factory_mix_batches", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  batchCode: varchar("batch_code", { length: 50 }).notNull(),
  name: text("name"),
  totalWeightKg: decimal("total_weight_kg", { precision: 15, scale: 3 }).notNull(),
  usedKg: decimal("used_kg", { precision: 15, scale: 3 }).notNull().default("0"),
  costPerKg: decimal("cost_per_kg", { precision: 20, scale: 4 }).notNull(),
  totalCost: decimal("total_cost", { precision: 20, scale: 2 }).notNull(),
  notes: text("notes"),
  status: text("status").notNull().default("ACTIVE"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertFactoryMixBatchSchema = createInsertSchema(factoryMixBatches).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  batchCode: z.string().optional(),
  name: z.string().optional(),
  totalWeightKg: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Total weight must be positive"),
  totalCost: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Total cost must be non-negative"),
  costPerKg: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Cost per kg must be non-negative"),
  usedKg: z.string().optional(),
  status: z.enum(["ACTIVE", "COMPLETED"]).optional(),
});

export type InsertFactoryMixBatch = z.infer<typeof insertFactoryMixBatchSchema>;
export type FactoryMixBatch = typeof factoryMixBatches.$inferSelect;

export const factoryMixBatchSources = pgTable("factory_mix_batch_sources", {
  id: serial("id").primaryKey(),
  mixBatchId: integer("mix_batch_id").notNull(),
  containerId: integer("container_id"),
  sourceBatchId: integer("source_batch_id"),
  weightKg: decimal("weight_kg", { precision: 15, scale: 3 }).notNull(),
  costPerKg: decimal("cost_per_kg", { precision: 20, scale: 2 }).notNull(),
  totalCost: decimal("total_cost", { precision: 20, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertFactoryMixBatchSourceSchema = createInsertSchema(factoryMixBatchSources).omit({
  id: true,
  createdAt: true,
}).extend({
  mixBatchId: z.number().min(1, "Mix batch is required"),
  containerId: z.number().optional().nullable(),
  sourceBatchId: z.number().optional().nullable(),
  weightKg: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Weight must be positive"),
  costPerKg: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Cost per kg must be non-negative"),
  totalCost: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Total cost must be non-negative"),
});

export type InsertFactoryMixBatchSource = z.infer<typeof insertFactoryMixBatchSourceSchema>;
export type FactoryMixBatchSource = typeof factoryMixBatchSources.$inferSelect;

export const factoryPressingBatches = pgTable("factory_pressing_batches", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  mixBatchId: integer("mix_batch_id"),
  productId: integer("product_id"),
  expectedCount: integer("expected_count").notNull(),
  status: text("status").notNull().default("PENDING"),
  notes: text("notes"),
  createdBy: integer("created_by"),
  finalizedAt: timestamp("finalized_at"),
  finalizedLocationId: integer("finalized_location_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertFactoryPressingBatchSchema = createInsertSchema(factoryPressingBatches).omit({
  id: true,
  createdAt: true,
});

export type InsertFactoryPressingBatch = z.infer<typeof insertFactoryPressingBatchSchema>;
export type FactoryPressingBatch = typeof factoryPressingBatches.$inferSelect;

export const factoryBales = pgTable("factory_bales", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  mixBatchId: integer("mix_batch_id"),
  productId: integer("product_id"),
  pressingBatchId: integer("pressing_batch_id"),
  erpLocationId: integer("erp_location_id"),
  baleCode: varchar("bale_code", { length: 50 }).notNull(),
  referenceNumber: varchar("reference_number", { length: 100 }).notNull(),
  articleCode: varchar("article_code", { length: 50 }),
  productName: text("product_name"),
  category: text("category"),
  grade: text("grade"),
  quantity: integer("quantity").notNull().default(1),
  weightKg: decimal("weight_kg", { precision: 15, scale: 3 }).notNull(),
  costPerKg: decimal("cost_per_kg", { precision: 20, scale: 2 }).notNull().default("0"),
  totalCost: decimal("total_cost", { precision: 20, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("PENDING_PRESSING"),
  pressedAt: timestamp("pressed_at"),
  finalizedAt: timestamp("finalized_at"),
  finalizedBy: integer("finalized_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  uniqueCompanyRef: uniqueIndex("factory_bales_company_ref_unique").on(t.companyId, t.referenceNumber),
  statusIdx: index("factory_bales_status_idx").on(t.status),
  pressingBatchIdx: index("factory_bales_pressing_batch_idx").on(t.pressingBatchId),
  mixBatchIdx: index("factory_bales_mix_batch_idx").on(t.mixBatchId),
  companyIdx: index("factory_bales_company_idx").on(t.companyId),
}));

export const insertFactoryBaleSchema = createInsertSchema(factoryBales).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  companyId: z.number().min(1, "Company is required"),
  mixBatchId: z.number().optional().nullable(),
  productId: z.number().optional().nullable(),
  pressingBatchId: z.number().optional().nullable(),
  erpLocationId: z.number().optional().nullable(),
  baleCode: z.string().min(1, "Bale code is required"),
  referenceNumber: z.string().min(1, "Reference number is required"),
  articleCode: z.string().optional().nullable(),
  productName: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  grade: z.string().optional().nullable(),
  weightKg: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Weight must be positive"),
  costPerKg: z.string().optional(),
  totalCost: z.string().optional(),
  status: z.enum(["PENDING_PRESSING", "FINALIZED"]).optional(),
  pressedAt: z.string().optional().nullable(),
  finalizedAt: z.string().optional().nullable(),
  finalizedBy: z.number().optional().nullable(),
});

export type InsertFactoryBale = z.infer<typeof insertFactoryBaleSchema>;
export type FactoryBale = typeof factoryBales.$inferSelect;

export const factoryBaleSequences = pgTable("factory_bale_sequences", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  nextNumber: integer("next_number").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniqueCompanyId: uniqueIndex("factory_bale_sequences_company_unique").on(t.companyId),
}));

export type FactoryBaleSequence = typeof factoryBaleSequences.$inferSelect;

export const factoryContainerCommissions = pgTable("factory_container_commissions", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  containerId: integer("container_id").notNull(),
  personName: text("person_name").notNull(),
  commissionType: text("commission_type").notNull().default("PER_KG"),
  commissionRate: decimal("commission_rate", { precision: 20, scale: 4 }).notNull(),
  commissionTotal: decimal("commission_total", { precision: 20, scale: 4 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  containerIdx: index("factory_container_commissions_container_idx").on(t.containerId),
  companyIdx: index("factory_container_commissions_company_idx").on(t.companyId),
}));

export type FactoryContainerCommission = typeof factoryContainerCommissions.$inferSelect;
