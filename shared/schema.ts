import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, integer, decimal, date, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const locations = pgTable("locations", {
  id: serial("id").primaryKey(),
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
  code: z.string().min(1, "Code is required"),
  name: z.string().min(1, "Name is required"),
});

export type InsertLocation = z.infer<typeof insertLocationSchema>;
export type Location = typeof locations.$inferSelect;

export const ledgerAccounts = pgTable("ledger_accounts", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: text("name").notNull(),
  accountType: text("account_type").notNull(),
  subType: text("sub_type"),
  parentId: integer("parent_id"),
  openingBalance: decimal("opening_balance", { precision: 15, scale: 2 }).default("0"),
  openingBalanceSide: text("opening_balance_side"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertLedgerAccountSchema = createInsertSchema(ledgerAccounts).omit({
  id: true,
  createdAt: true,
}).extend({
  code: z.string().min(1, "Code is required"),
  name: z.string().min(1, "Name is required"),
  accountType: z.enum(["Asset", "Liability", "Equity", "Income", "Expense", "Bank", "Cash"]),
  subType: z.string().optional(),
  openingBalance: z.string().optional(),
  openingBalanceSide: z.enum(["Dr", "Cr"]).optional(),
});

export type InsertLedgerAccount = z.infer<typeof insertLedgerAccountSchema>;
export type LedgerAccount = typeof ledgerAccounts.$inferSelect;

export const employees = pgTable("employees", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  joinDate: date("join_date").notNull(),
  department: text("department"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertEmployeeSchema = createInsertSchema(employees).omit({
  id: true,
  createdAt: true,
}).extend({
  code: z.string().min(1, "Code is required"),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email format"),
  joinDate: z.string().min(1, "Join date is required"),
});

export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Employee = typeof employees.$inferSelect;

export const suppliers = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  legalName: text("legal_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  address: text("address"),
  taxId: text("tax_id"),
  paymentTerms: text("payment_terms"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSupplierSchema = createInsertSchema(suppliers).omit({
  id: true,
  createdAt: true,
}).extend({
  code: z.string().min(1, "Code is required"),
  legalName: z.string().min(1, "Legal name is required"),
  email: z.string().email("Invalid email format"),
});

export type InsertSupplier = z.infer<typeof insertSupplierSchema>;
export type Supplier = typeof suppliers.$inferSelect;

export const stockGroups = pgTable("stock_groups", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: text("name").notNull(),
  parentId: integer("parent_id"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertStockGroupSchema = createInsertSchema(stockGroups).omit({
  id: true,
  createdAt: true,
}).extend({
  code: z.string().min(1, "Code is required"),
  name: z.string().min(1, "Name is required"),
});

export type InsertStockGroup = z.infer<typeof insertStockGroupSchema>;
export type StockGroup = typeof stockGroups.$inferSelect;

export const stockItems = pgTable("stock_items", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: text("name").notNull(),
  barcode: varchar("barcode", { length: 100 }),
  stockGroupId: integer("stock_group_id"),
  uom: text("uom").notNull(),
  openingQty: decimal("opening_qty", { precision: 15, scale: 3 }).default("0"),
  openingRate: decimal("opening_rate", { precision: 15, scale: 2 }).default("0"),
  openingValue: decimal("opening_value", { precision: 15, scale: 2 }).default("0"),
  reorderLevel: decimal("reorder_level", { precision: 15, scale: 3 }).default("0"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertStockItemSchema = createInsertSchema(stockItems).omit({
  id: true,
  createdAt: true,
}).extend({
  code: z.string().min(1, "Code is required"),
  name: z.string().min(1, "Name is required"),
  uom: z.string().min(1, "Unit of measure is required"),
});

export type InsertStockItem = z.infer<typeof insertStockItemSchema>;
export type StockItem = typeof stockItems.$inferSelect;

export const bankAccounts = pgTable("bank_accounts", {
  id: serial("id").primaryKey(),
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
  containerNumber: z.string().min(1, "Container number is required"),
  supplierId: z.number().min(1, "Supplier is required"),
  importDate: z.string().min(1, "Import date is required"),
});

export type InsertContainer = z.infer<typeof insertContainerSchema>;
export type Container = typeof containers.$inferSelect;

export const purchaseOrders = pgTable("purchase_orders", {
  id: serial("id").primaryKey(),
  poNumber: varchar("po_number", { length: 100 }).notNull(),
  containerId: integer("container_id").notNull(),
  supplierId: integer("supplier_id").notNull(),
  currency: text("currency").notNull().default("USD"),
  itemsTotal: decimal("items_total", { precision: 15, scale: 2 }).default("0"),
  status: text("status").notNull().default("Open"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrders).omit({
  id: true,
  createdAt: true,
}).extend({
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
