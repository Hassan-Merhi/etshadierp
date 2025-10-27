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
