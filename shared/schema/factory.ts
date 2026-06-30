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
import { customers, vouchers } from "./erp";
import { containers } from "./containers";

// ─── Bales ───────────────────────────────────────────────────────────────────
export const bales = pgTable(
  "bales",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    containerId: integer("container_id").references(() => containers.id, { onDelete: "restrict" }),
    barcode: varchar("barcode", { length: 100 }).notNull(),
    category: text("category").notNull(),
    grade: text("grade").notNull(),
    origin: text("origin").notNull(),
    weight: decimal("weight", { precision: 10, scale: 3 }).notNull(),
    datePressed: date("date_pressed").notNull(),
    price: decimal("price", { precision: 12, scale: 2 }),
    currency: varchar("currency", { length: 3 }).default("USD"),
    customerId: integer("customer_id").references(() => customers.id, { onDelete: "restrict" }),
    soldDate: timestamp("sold_date"),
    status: text("status").notNull().default("AVAILABLE"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueCompanyBarcode: uniqueIndex("bales_company_barcode_unique").on(t.companyId, t.barcode),
  })
);

export const insertBaleSchema = createInsertSchema(bales)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
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

// ─── Pending Barcodes ─────────────────────────────────────────────────────────
export const pendingBarcodes = pgTable(
  "pending_barcodes",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    barcode: varchar("barcode", { length: 100 }).notNull(),
    category: text("category"),
    grade: text("grade"),
    origin: text("origin"),
    printed: boolean("printed").notNull().default(false),
    used: boolean("used").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueCompanyPendingBarcode: uniqueIndex("pending_barcodes_company_barcode_unique").on(t.companyId, t.barcode),
  })
);

export const insertPendingBarcodeSchema = createInsertSchema(pendingBarcodes).omit({
  id: true,
  createdAt: true,
});

export type InsertPendingBarcode = z.infer<typeof insertPendingBarcodeSchema>;
export type PendingBarcode = typeof pendingBarcodes.$inferSelect;

// ─── Production Raw Stock ─────────────────────────────────────────────────────
export const productionRawStock = pgTable(
  "production_raw_stock",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    containerId: integer("container_id")
      .notNull()
      .references(() => containers.id, { onDelete: "restrict" }),
    receivedKg: decimal("received_kg", { precision: 15, scale: 3 }).notNull(),
    usedKg: decimal("used_kg", { precision: 15, scale: 3 }).notNull().default("0"),
    costPerKg: decimal("cost_per_kg", { precision: 20, scale: 4 }).notNull(),
    offloadedAt: timestamp("offloaded_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueCompanyContainer: uniqueIndex("production_raw_stock_company_container_unique").on(t.companyId, t.containerId),
  })
);

export const insertProductionRawStockSchema = createInsertSchema(productionRawStock)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    containerId: z.number().min(1, "Container is required"),
    receivedKg: z
      .string()
      .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Received kg must be positive"),
    usedKg: z.string().optional(),
    costPerKg: z
      .string()
      .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Cost per kg must be non-negative"),
  });

export type InsertProductionRawStock = z.infer<typeof insertProductionRawStockSchema>;
export type ProductionRawStock = typeof productionRawStock.$inferSelect;

// ─── Mix Batches ──────────────────────────────────────────────────────────────
export const mixBatches = pgTable(
  "mix_batches",
  {
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
  },
  (t) => ({
    companyIdx: index("mix_batches_company_idx").on(t.companyId),
  })
);

export const insertMixBatchSchema = createInsertSchema(mixBatches)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    batchCode: z.string().optional(),
    name: z.string().optional(),
    totalWeightKg: z
      .string()
      .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Total weight must be positive"),
    totalCost: z
      .string()
      .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Total cost must be non-negative"),
    costPerKg: z
      .string()
      .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Cost per kg must be non-negative"),
    usedKg: z.string().optional(),
    status: z.enum(["ACTIVE", "COMPLETED"]).optional(),
  });

export type InsertMixBatch = z.infer<typeof insertMixBatchSchema>;
export type MixBatch = typeof mixBatches.$inferSelect;

// ─── Mix Batch Sources ────────────────────────────────────────────────────────
export const mixBatchSources = pgTable("mix_batch_sources", {
  id: serial("id").primaryKey(),
  mixBatchId: integer("mix_batch_id").notNull(),
  containerId: integer("container_id").references(() => containers.id, { onDelete: "restrict" }),
  sourceBatchId: integer("source_batch_id"),
  weightKg: decimal("weight_kg", { precision: 15, scale: 3 }).notNull(),
  costPerKg: decimal("cost_per_kg", { precision: 20, scale: 2 }).notNull(),
  totalCost: decimal("total_cost", { precision: 20, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertMixBatchSourceSchema = createInsertSchema(mixBatchSources)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    mixBatchId: z.number().min(1, "Mix batch is required"),
    containerId: z.number().optional().nullable(),
    sourceBatchId: z.number().optional().nullable(),
    weightKg: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Weight must be positive"),
    costPerKg: z
      .string()
      .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Cost per kg must be non-negative"),
    totalCost: z
      .string()
      .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Total cost must be non-negative"),
  });

export type InsertMixBatchSource = z.infer<typeof insertMixBatchSourceSchema>;
export type MixBatchSource = typeof mixBatchSources.$inferSelect;

// ─── Bale Product Categories ──────────────────────────────────────────────────
export const baleProductCategories = pgTable(
  "bale_product_categories",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueCompanyName: uniqueIndex("bale_product_categories_company_name_unique").on(t.companyId, t.name),
  })
);

export const insertBaleProductCategorySchema = createInsertSchema(baleProductCategories)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    name: z.string().min(1, "Category name is required"),
    isActive: z.boolean().optional(),
  });

export type InsertBaleProductCategory = z.infer<typeof insertBaleProductCategorySchema>;
export type BaleProductCategory = typeof baleProductCategories.$inferSelect;

// ─── Bale Products ────────────────────────────────────────────────────────────
export const baleProducts = pgTable(
  "bale_products",
  {
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
  },
  (t) => ({
    uniqueCompanyCode: uniqueIndex("bale_products_company_code_unique").on(t.companyId, t.code),
    uniqueCompanyArticleCode: uniqueIndex("bale_products_company_article_code_unique").on(t.companyId, t.articleCode),
  })
);

export const insertBaleProductSchema = createInsertSchema(baleProducts)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
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

// ─── Bale Sequences ───────────────────────────────────────────────────────────
export const baleSequences = pgTable(
  "bale_sequences",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    nextNumber: integer("next_number").notNull().default(1),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueCompanyId: uniqueIndex("bale_sequences_company_unique").on(t.companyId),
  })
);

export type BaleSequence = typeof baleSequences.$inferSelect;

// ─── Pressing Batches ─────────────────────────────────────────────────────────
export const pressingBatches = pgTable(
  "pressing_batches",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    mixBatchId: integer("mix_batch_id"),
    productId: integer("product_id"),
    expectedCount: integer("expected_count").notNull(),
    status: text("status").notNull().default("PENDING"),
    createdBy: integer("created_by"),
    finalizedAt: timestamp("finalized_at"),
    finalizedLocationId: integer("finalized_location_id").references(() => locations.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("pressing_batches_company_idx").on(t.companyId),
  })
);

export const insertPressingBatchSchema = createInsertSchema(pressingBatches).omit({
  id: true,
  createdAt: true,
});

export type InsertPressingBatch = z.infer<typeof insertPressingBatchSchema>;
export type PressingBatch = typeof pressingBatches.$inferSelect;

// ─── Production Bales ─────────────────────────────────────────────────────────
export const productionBales = pgTable(
  "production_bales",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    mixBatchId: integer("mix_batch_id"),
    productId: integer("product_id"),
    locationId: integer("location_id").references(() => locations.id, { onDelete: "restrict" }),
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
  },
  (t) => ({
    uniqueCompanyBarcodeValue: uniqueIndex("production_bales_company_barcode_unique").on(t.companyId, t.barcodeValue),
  })
);

export const insertProductionBaleSchema = createInsertSchema(productionBales)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    mixBatchId: z.number().optional(),
    productId: z.number().optional(),
    baleCode: z.string().min(1, "Bale code is required"),
    barcodeValue: z.string().min(1, "Barcode value is required"),
    category: z.string().optional(),
    grade: z.string().optional(),
    weightKg: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Weight must be positive"),
    costPerKg: z
      .string()
      .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Cost per kg must be non-negative"),
    totalCost: z
      .string()
      .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Total cost must be non-negative"),
    warehouseLocation: z.string().optional(),
    status: z.enum(["PENDING", "LABEL_PRINTED", "PRESSED", "IN_STOCK", "RESERVED", "SOLD"]).optional(),
    pressedAt: z.string().optional(),
  });

export type InsertProductionBale = z.infer<typeof insertProductionBaleSchema>;
export type ProductionBale = typeof productionBales.$inferSelect;

// ─── Bale Transfers ───────────────────────────────────────────────────────────
export const baleTransfers = pgTable(
  "bale_transfers",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    sourceLocationId: integer("source_location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    destinationLocationId: integer("destination_location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    transferDate: date("transfer_date").notNull(),
    notes: text("notes"),
    createdBy: varchar("created_by").notNull(),
    updatedBy: varchar("updated_by"),
    status: text("status").notNull().default("PENDING"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("bale_transfers_company_idx").on(t.companyId),
  })
);

export const insertBaleTransferSchema = createInsertSchema(baleTransfers)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
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

// ─── Bale Transfer Items ──────────────────────────────────────────────────────
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

export const insertBaleTransferItemSchema = createInsertSchema(baleTransferItems)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    transferId: z.number().min(1, "Transfer is required"),
    productionBaleId: z.number().min(1, "Bale is required"),
    quantity: z.number().min(1, "Quantity must be at least 1"),
    weightKg: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Weight must be positive"),
    costPerKg: z
      .string()
      .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Cost per kg must be non-negative"),
    totalCost: z
      .string()
      .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Total cost must be non-negative"),
  });

export type InsertBaleTransferItem = z.infer<typeof insertBaleTransferItemSchema>;
export type BaleTransferItem = typeof baleTransferItems.$inferSelect;

// ─── Factory Supplier Categories ──────────────────────────────────────────────
export const factorySupplierCategories = pgTable(
  "factory_supplier_categories",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueCompanyName: uniqueIndex("factory_supplier_categories_company_name_unique").on(t.companyId, t.name),
  })
);

export const insertFactorySupplierCategorySchema = createInsertSchema(factorySupplierCategories)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    name: z.string().min(1, "Category name is required"),
    displayOrder: z.number().optional(),
  });

export type InsertFactorySupplierCategory = z.infer<typeof insertFactorySupplierCategorySchema>;
export type FactorySupplierCategory = typeof factorySupplierCategories.$inferSelect;

// ─── Factory Suppliers ────────────────────────────────────────────────────────
export const factorySuppliers = pgTable(
  "factory_suppliers",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    contactPerson: text("contact_person"),
    phone: varchar("phone", { length: 50 }),
    email: varchar("email", { length: 200 }),
    address: text("address"),
    notes: text("notes"),
    openingBalance: decimal("opening_balance", { precision: 20, scale: 4 }).notNull().default("0"),
    linkedSupplierId: integer("linked_supplier_id"),
    parentId: integer("parent_id"),
    supplierCategoryId: integer("supplier_category_id"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueCompanyName: uniqueIndex("factory_suppliers_company_name_unique").on(t.companyId, t.name),
  })
);

export const insertFactorySupplierSchema = createInsertSchema(factorySuppliers)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    name: z.string().min(1, "Supplier name is required"),
    contactPerson: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
    email: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    openingBalance: z.string().optional(),
    linkedSupplierId: z.number().optional().nullable(),
    parentId: z.number().optional().nullable(),
    supplierCategoryId: z.number().optional().nullable(),
    isActive: z.boolean().optional(),
  });

export type InsertFactorySupplier = z.infer<typeof insertFactorySupplierSchema>;
export type FactorySupplier = typeof factorySuppliers.$inferSelect;

// ─── Factory Categories ───────────────────────────────────────────────────────
export const factoryCategories = pgTable(
  "factory_categories",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueCompanyName: uniqueIndex("factory_categories_company_name_unique").on(t.companyId, t.name),
  })
);

export const insertFactoryCategorySchema = createInsertSchema(factoryCategories)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    deletedAt: true,
  })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    name: z.string().min(1, "Category name is required"),
    isActive: z.boolean().optional(),
  });

export type InsertFactoryCategory = z.infer<typeof insertFactoryCategorySchema>;
export type FactoryCategory = typeof factoryCategories.$inferSelect;

// ─── Factory Bale Products ────────────────────────────────────────────────────
export const factoryBaleProducts = pgTable(
  "factory_bale_products",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    code: varchar("code", { length: 50 }).notNull(),
    articleCode: varchar("article_code", { length: 50 }),
    name: text("name").notNull(),
    description: text("description"),
    weightPerBaleKg: decimal("weight_per_bale_kg", { precision: 10, scale: 2 }),
    categoryId: integer("category_id"),
    sellingPrice: decimal("selling_price", { precision: 20, scale: 2 }).default("0"),
    productionPrice: decimal("production_price", { precision: 20, scale: 2 }).default("0"),
    labelDesignColor: varchar("label_design_color", { length: 20 }),
    active: boolean("active").notNull().default(true),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueCompanyCode: uniqueIndex("factory_bale_products_company_code_unique").on(t.companyId, t.code),
    uniqueCompanyArticleCode: uniqueIndex("factory_bale_products_company_article_code_unique").on(
      t.companyId,
      t.articleCode
    ),
  })
);

export const insertFactoryBaleProductSchema = createInsertSchema(factoryBaleProducts)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    deletedAt: true,
  })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    code: z.string().optional(),
    articleCode: z.string().optional().nullable(),
    name: z.string().min(1, "Product name is required"),
    description: z.string().optional().nullable(),
    weightPerBaleKg: z.string().optional().nullable(),
    sellingPrice: z.string().optional().nullable(),
    productionPrice: z.string().optional().nullable(),
    categoryId: z.number().optional().nullable(),
    labelDesignColor: z.string().optional().nullable(),
    active: z.boolean().optional(),
  });

export type InsertFactoryBaleProduct = z.infer<typeof insertFactoryBaleProductSchema>;
export type FactoryBaleProduct = typeof factoryBaleProducts.$inferSelect;

// ─── Factory Containers ───────────────────────────────────────────────────────
export const factoryContainers = pgTable(
  "factory_containers",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    containerNumber: varchar("container_number", { length: 100 }).notNull(),
    supplierId: integer("supplier_id").references(() => factorySuppliers.id, { onDelete: "restrict" }),
    origin: text("origin"),
    totalKg: decimal("total_kg", { precision: 15, scale: 3 }),
    ratePerKg: decimal("rate_per_kg", { precision: 20, scale: 7 }),
    declaredKg: decimal("declared_kg", { precision: 15, scale: 3 }),
    actualReceivedKg: decimal("actual_received_kg", { precision: 15, scale: 3 }),
    finalPayableAmount: decimal("final_payable_amount", { precision: 20, scale: 4 }),
    differenceKg: decimal("difference_kg", { precision: 15, scale: 3 }),
    currencyCode: varchar("currency_code", { length: 10 }).notNull().default("USD"),
    fxRateToUsd: decimal("fx_rate_to_usd", { precision: 20, scale: 8 }).notNull().default("1"),
    fxRateToUsdImport: decimal("fx_rate_to_usd_import", { precision: 20, scale: 8 }),
    fxRateToUsdOffload: decimal("fx_rate_to_usd_offload", { precision: 20, scale: 8 }),
    fxRateSource: text("fx_rate_source").notNull().default("auto"),
    fxRateDateImport: date("fx_rate_date_import"),
    fxRateDateOffload: date("fx_rate_date_offload"),
    ratePerKgUsd: decimal("rate_per_kg_usd", { precision: 20, scale: 7 }),
    finalPayableAmountUsd: decimal("final_payable_amount_usd", { precision: 20, scale: 4 }),
    arrivalDate: date("arrival_date"),
    destination: text("destination"),
    notes: text("notes"),
    status: text("status").notNull().default("PENDING"),
    freight: decimal("freight", { precision: 20, scale: 2 }).default("0"),
    freightCurrencyCode: varchar("freight_currency_code", { length: 10 }).default("USD"),
    freightAccountId: integer("freight_account_id"),
    freightSupplierId: integer("freight_supplier_id"),
    freightPaidBy: text("freight_paid_by").default("supplier"),
    freightOwnAccountId: integer("freight_own_account_id"),
    otherCharges: decimal("other_charges", { precision: 20, scale: 2 }).default("0"),
    otherChargesCurrencyCode: varchar("other_charges_currency_code", { length: 10 }),
    otherChargesAccountId: integer("other_charges_account_id"),
    otherChargesSupplierId: integer("other_charges_supplier_id"),
    commissionAmount: decimal("commission_amount", { precision: 20, scale: 2 }).default("0"),
    commissionCurrencyCode: varchar("commission_currency_code", { length: 10 }).default("USD"),
    commissionAccountId: integer("commission_account_id"),
    commissionSupplierId: integer("commission_supplier_id"),
    commissionNotes: text("commission_notes"),
    dutyAmount: decimal("duty_amount", { precision: 20, scale: 2 }),
    dutyAccountId: integer("duty_account_id"),
    dutyStatus: text("duty_status").notNull().default("NONE"),
    dutyNotes: text("duty_notes"),
    preOffloadFreight: decimal("pre_offload_freight", { precision: 20, scale: 2 }),
    preOffloadFreightCurrencyCode: varchar("pre_offload_freight_currency_code", { length: 10 }),
    preOffloadFreightAccountId: integer("pre_offload_freight_account_id"),
    preOffloadFreightSupplierId: integer("pre_offload_freight_supplier_id"),
    preOffloadOtherCharges: decimal("pre_offload_other_charges", { precision: 20, scale: 2 }),
    preOffloadOtherChargesAccountId: integer("pre_offload_other_charges_account_id"),
    preOffloadOtherChargesSupplierId: integer("pre_offload_other_charges_supplier_id"),
    preOffloadStatus: text("pre_offload_status"),
    preOffloadCommissionAmount: decimal("pre_offload_commission_amount", { precision: 20, scale: 2 }),
    preOffloadCommissionCurrencyCode: varchar("pre_offload_commission_currency_code", { length: 10 }),
    preOffloadCommissionAccountId: integer("pre_offload_commission_account_id"),
    preOffloadCommissionSupplierId: integer("pre_offload_commission_supplier_id"),
    preOffloadCommissionNotes: text("pre_offload_commission_notes"),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    trackingEnabled: boolean("tracking_enabled").notNull().default(true),
    trackingAutoUpdate: boolean("tracking_auto_update").notNull().default(true),
    trackingProvider: text("tracking_provider"),
    trackingLastStatus: text("tracking_last_status"),
    trackingLastLocation: text("tracking_last_location"),
    trackingLastCheckedAt: timestamp("tracking_last_checked_at", { withTimezone: true }),
    trackingLastEventDate: timestamp("tracking_last_event_date", { withTimezone: true }),
    trackingLastDescription: text("tracking_last_description"),
    trackingError: text("tracking_error"),
    trackingChangedAt: timestamp("tracking_changed_at", { withTimezone: true }),
    trackingDetectedCarrier: text("tracking_detected_carrier"),
    trackingNextCheckAt: timestamp("tracking_next_check_at", { withTimezone: true }),
    trackingLastSkipReason: text("tracking_last_skip_reason"),
  },
  (t) => ({
    companyIdx: index("factory_containers_company_idx").on(t.companyId),
  })
);

export const insertFactoryContainerSchema = createInsertSchema(factoryContainers)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    deletedAt: true,
  })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    containerNumber: z.string().min(1, "Container number is required"),
    supplierId: z.number().optional().nullable(),
    origin: z.string().optional().nullable(),
    totalKg: z.string().optional().nullable(),
    ratePerKg: z.string().optional().nullable(),
    currencyCode: z.string().optional(),
    fxRateToUsd: z.string().optional(),
    fxRateToUsdImport: z.string().optional().nullable(),
    fxRateToUsdOffload: z.string().optional().nullable(),
    fxRateSource: z.string().optional(),
    fxRateDateImport: z.string().optional().nullable(),
    fxRateDateOffload: z.string().optional().nullable(),
    ratePerKgUsd: z.string().optional().nullable(),
    finalPayableAmountUsd: z.string().optional().nullable(),
    arrivalDate: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    status: z.string().optional(),
    freight: z.string().optional().nullable(),
    freightCurrencyCode: z.string().optional().nullable(),
    freightAccountId: z.number().optional().nullable(),
    otherCharges: z.string().optional().nullable(),
    otherChargesAccountId: z.number().optional().nullable(),
    commissionAmount: z.string().optional().nullable(),
    commissionCurrencyCode: z.string().optional().nullable(),
    commissionAccountId: z.number().optional().nullable(),
    commissionSupplierId: z.number().optional().nullable(),
    commissionNotes: z.string().optional().nullable(),
    dutyAmount: z.string().optional().nullable(),
    dutyAccountId: z.number().optional().nullable(),
    dutyStatus: z.enum(["NONE", "PENDING", "CONFIRMED"]).optional(),
    dutyNotes: z.string().optional().nullable(),
  });

export type InsertFactoryContainer = z.infer<typeof insertFactoryContainerSchema>;
export type FactoryContainer = typeof factoryContainers.$inferSelect;

// ─── Factory Container Tracking Events ───────────────────────────────────────
export const factoryContainerTrackingEvents = pgTable(
  "factory_container_tracking_events",
  {
    id: serial("id").primaryKey(),
    containerId: integer("container_id").notNull(),
    provider: text("provider").notNull().default("parcelsapp"),
    eventTime: timestamp("event_time", { withTimezone: true }),
    eventStatus: text("event_status"),
    eventLocation: text("event_location"),
    eventDescription: text("event_description"),
    rawEventJson: jsonb("raw_event_json"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    dedupUnique: uniqueIndex("fcte_dedup_unique").on(t.containerId, t.eventTime, t.eventStatus),
  })
);

export type FactoryContainerTrackingEvent = typeof factoryContainerTrackingEvents.$inferSelect;

// ─── Factory Container Tracking Checks ───────────────────────────────────────
export const factoryContainerTrackingChecks = pgTable("factory_container_tracking_checks", {
  id: serial("id").primaryKey(),
  containerId: integer("container_id").notNull(),
  provider: text("provider").notNull().default("parcelsapp"),
  status: text("status").notNull(),
  checkedAt: timestamp("checked_at").notNull(),
  errorMessage: text("error_message"),
  rawResponseJson: jsonb("raw_response_json"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type FactoryContainerTrackingCheck = typeof factoryContainerTrackingChecks.$inferSelect;

// ─── Factory Offload Additional Charges ──────────────────────────────────────
export const factoryOffloadAdditionalCharges = pgTable(
  "factory_offload_additional_charges",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    containerId: integer("container_id")
      .notNull()
      .references(() => factoryContainers.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    amount: decimal("amount", { precision: 20, scale: 2 }).notNull(),
    currencyCode: text("currency_code").default("USD"),
    fxRateToUsd: decimal("fx_rate_to_usd", { precision: 20, scale: 6 }).default("1"),
    ledgerAccountId: integer("ledger_account_id"),
    supplierId: integer("supplier_id").references(() => factorySuppliers.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("factory_offload_additional_charges_company_idx").on(t.companyId),
    containerIdx: index("factory_offload_addl_charges_container_idx").on(t.containerId),
  })
);

export type FactoryOffloadAdditionalCharge = typeof factoryOffloadAdditionalCharges.$inferSelect;

// ─── Factory Container Other Charges ─────────────────────────────────────────
export const factoryContainerOtherCharges = pgTable(
  "factory_container_other_charges",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    containerId: integer("container_id")
      .notNull()
      .references(() => factoryContainers.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    amount: decimal("amount", { precision: 20, scale: 2 }).notNull(),
    currencyCode: text("currency_code").default("USD"),
    ledgerAccountId: integer("ledger_account_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("factory_container_other_charges_company_idx").on(t.companyId),
    containerIdx: index("factory_container_other_charges_container_idx").on(t.containerId),
  })
);

export type FactoryContainerOtherCharge = typeof factoryContainerOtherCharges.$inferSelect;

// ─── Factory Raw Stock ────────────────────────────────────────────────────────
export const factoryRawStock = pgTable(
  "factory_raw_stock",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    containerId: integer("container_id")
      .notNull()
      .references(() => factoryContainers.id, { onDelete: "restrict" }),
    receivedKg: decimal("received_kg", { precision: 15, scale: 3 }).notNull(),
    usedKg: decimal("used_kg", { precision: 15, scale: 3 }).notNull().default("0"),
    costPerKg: decimal("cost_per_kg", { precision: 20, scale: 4 }).notNull(),
    costPerKgUsd: decimal("cost_per_kg_usd", { precision: 20, scale: 4 }),
    commissionPersonName: text("commission_person_name"),
    commissionAmount: decimal("commission_amount", { precision: 20, scale: 4 }),
    commissionCurrencyCode: varchar("commission_currency_code", { length: 10 }),
    commissionFxRateToUsd: decimal("commission_fx_rate_to_usd", { precision: 20, scale: 8 }),
    commissionAmountUsd: decimal("commission_amount_usd", { precision: 20, scale: 4 }),
    commissionLedgerAccountId: integer("commission_ledger_account_id"),
    commissionSupplierId: integer("commission_supplier_id").references(() => factorySuppliers.id, {
      onDelete: "restrict",
    }),
    offloadedAt: timestamp("offloaded_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueCompanyContainer: uniqueIndex("factory_raw_stock_company_container_unique").on(t.companyId, t.containerId),
  })
);

export const insertFactoryRawStockSchema = createInsertSchema(factoryRawStock)
  .omit({
    id: true,
    createdAt: true,
    deletedAt: true,
  })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    containerId: z.number().min(1, "Container is required"),
    receivedKg: z
      .string()
      .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Received kg must be positive"),
    usedKg: z.string().optional(),
    costPerKg: z
      .string()
      .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Cost per kg must be non-negative"),
    costPerKgUsd: z.string().optional().nullable(),
    commissionPersonName: z.string().optional().nullable(),
    commissionAmount: z.string().optional().nullable(),
    commissionCurrencyCode: z.string().optional().nullable(),
    commissionFxRateToUsd: z.string().optional().nullable(),
    commissionAmountUsd: z.string().optional().nullable(),
    commissionLedgerAccountId: z.number().optional().nullable(),
    commissionSupplierId: z.number().optional().nullable(),
  });

export type InsertFactoryRawStock = z.infer<typeof insertFactoryRawStockSchema>;
export type FactoryRawStock = typeof factoryRawStock.$inferSelect;

// ─── Factory Raw Material Adjustments ────────────────────────────────────────
export const factoryRawMaterialAdjustments = pgTable(
  "factory_raw_material_adjustments",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    date: varchar("date", { length: 20 }).notNull(),
    type: varchar("type", { length: 10 }).notNull(),
    kg: decimal("kg", { precision: 15, scale: 3 }).notNull(),
    costPerKg: decimal("cost_per_kg", { precision: 20, scale: 4 }).default("0"),
    currencyCode: varchar("currency_code", { length: 10 }).default("USD"),
    supplierId: integer("supplier_id").references(() => factorySuppliers.id, { onDelete: "restrict" }),
    materialLabel: varchar("material_label", { length: 200 }),
    notes: text("notes"),
    reference: varchar("reference", { length: 200 }),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("factory_raw_material_adjustments_company_idx").on(t.companyId),
  })
);

export type FactoryRawMaterialAdjustment = typeof factoryRawMaterialAdjustments.$inferSelect;

// ─── Factory Supplier Payments ────────────────────────────────────────────────
export const factorySupplierPayments = pgTable(
  "factory_supplier_payments",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    supplierId: integer("supplier_id")
      .notNull()
      .references(() => factorySuppliers.id, { onDelete: "restrict" }),
    date: varchar("date", { length: 20 }).notNull(),
    amount: decimal("amount", { precision: 20, scale: 4 }).notNull(),
    currencyCode: varchar("currency_code", { length: 10 }).notNull().default("USD"),
    fxRateToUsd: decimal("fx_rate_to_usd", { precision: 20, scale: 8 }).notNull().default("1"),
    amountUsd: decimal("amount_usd", { precision: 20, scale: 4 }).notNull(),
    paidFromAccountId: integer("paid_from_account_id").references(() => ledgerAccounts.id, { onDelete: "restrict" }),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("factory_supplier_payments_company_idx").on(t.companyId),
  })
);

export const insertFactorySupplierPaymentSchema = createInsertSchema(factorySupplierPayments).omit({
  id: true,
  createdAt: true,
});

export type InsertFactorySupplierPayment = z.infer<typeof insertFactorySupplierPaymentSchema>;
export type FactorySupplierPayment = typeof factorySupplierPayments.$inferSelect;

// ─── Factory Supplier FX Transfers ───────────────────────────────────────────
export const factorySupplierFxTransfers = pgTable(
  "factory_supplier_fx_transfers",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    fromSupplierId: integer("from_supplier_id").notNull(),
    toSupplierId: integer("to_supplier_id").notNull(),
    date: varchar("date", { length: 20 }).notNull(),
    fromCurrencyCode: varchar("from_currency_code", { length: 10 }).notNull(),
    fromAmount: decimal("from_amount", { precision: 20, scale: 4 }).notNull(),
    fxRateToUsd: decimal("fx_rate_to_usd", { precision: 20, scale: 8 }).notNull(),
    toAmountUsd: decimal("to_amount_usd", { precision: 20, scale: 4 }).notNull(),
    notes: text("notes"),
    sourceType: text("source_type"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("factory_supplier_fx_transfers_company_idx").on(t.companyId),
  })
);

export const insertFactorySupplierFxTransferSchema = createInsertSchema(factorySupplierFxTransfers).omit({
  id: true,
  createdAt: true,
});

export type InsertFactorySupplierFxTransfer = z.infer<typeof insertFactorySupplierFxTransferSchema>;
export type FactorySupplierFxTransfer = typeof factorySupplierFxTransfers.$inferSelect;

// ─── Factory FX Allocations ───────────────────────────────────────────────────
export const factoryFxAllocations = pgTable(
  "factory_fx_allocations",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    fxTransferId: integer("fx_transfer_id").notNull(),
    containerId: integer("container_id")
      .notNull()
      .references(() => factoryContainers.id, { onDelete: "restrict" }),
    sourceType: varchar("source_type", { length: 20 }).notNull().default("supplier"),
    allocatedAmount: decimal("allocated_amount", { precision: 20, scale: 4 }).notNull(),
    currencyCode: varchar("currency_code", { length: 10 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    fxTransferIdx: index("factory_fx_alloc_transfer_idx").on(t.fxTransferId),
    containerIdx: index("factory_fx_alloc_container_idx").on(t.containerId),
    companyIdx: index("factory_fx_alloc_company_idx").on(t.companyId),
  })
);

export type FactoryFxAllocation = typeof factoryFxAllocations.$inferSelect;

// ─── Factory Mix Batches ──────────────────────────────────────────────────────
export const factoryMixBatches = pgTable(
  "factory_mix_batches",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    batchCode: varchar("batch_code", { length: 50 }).notNull(),
    batchNumber: text("batch_number"),
    name: text("name"),
    totalWeightKg: decimal("total_weight_kg", { precision: 15, scale: 3 }).notNull(),
    usedKg: decimal("used_kg", { precision: 15, scale: 3 }).notNull().default("0"),
    costPerKg: decimal("cost_per_kg", { precision: 20, scale: 4 }).notNull(),
    totalCost: decimal("total_cost", { precision: 20, scale: 2 }).notNull(),
    notes: text("notes"),
    status: text("status").notNull().default("ACTIVE"),
    operatorUser: text("operator_user"),
    batchDate: date("batch_date"),
    carryForwardFromId: integer("carry_forward_from_id"),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("factory_mix_batches_company_idx").on(t.companyId),
  })
);

export const insertFactoryMixBatchSchema = createInsertSchema(factoryMixBatches)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    deletedAt: true,
  })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    batchCode: z.string().optional(),
    name: z.string().optional(),
    totalWeightKg: z
      .string()
      .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Total weight must be positive"),
    totalCost: z
      .string()
      .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Total cost must be non-negative"),
    costPerKg: z
      .string()
      .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Cost per kg must be non-negative"),
    usedKg: z.string().optional(),
    status: z.enum(["ACTIVE", "COMPLETED", "OPEN", "CLOSED", "CARRY_FORWARD"]).optional(),
    operatorUser: z.string().optional().nullable(),
    batchDate: z.string().optional().nullable(),
    carryForwardFromId: z.number().optional().nullable(),
  });

export type InsertFactoryMixBatch = z.infer<typeof insertFactoryMixBatchSchema>;
export type FactoryMixBatch = typeof factoryMixBatches.$inferSelect;

// ─── Factory Mix Batch Sources ────────────────────────────────────────────────
export const factoryMixBatchSources = pgTable("factory_mix_batch_sources", {
  id: serial("id").primaryKey(),
  mixBatchId: integer("mix_batch_id").notNull(),
  containerId: integer("container_id").references(() => factoryContainers.id, { onDelete: "restrict" }),
  supplierId: integer("supplier_id").references(() => factorySuppliers.id, { onDelete: "restrict" }),
  sourceBatchId: integer("source_batch_id"),
  sourceType: text("source_type"),
  sourceId: integer("source_id"),
  weightKg: decimal("weight_kg", { precision: 15, scale: 3 }).notNull(),
  quantityKg: decimal("quantity_kg", { precision: 15, scale: 3 }),
  costPerKg: decimal("cost_per_kg", { precision: 20, scale: 2 }).notNull(),
  totalCost: decimal("total_cost", { precision: 20, scale: 2 }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertFactoryMixBatchSourceSchema = createInsertSchema(factoryMixBatchSources)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    mixBatchId: z.number().min(1, "Mix batch is required"),
    containerId: z.number().optional().nullable(),
    supplierId: z.number().optional().nullable(),
    sourceBatchId: z.number().optional().nullable(),
    weightKg: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Weight must be positive"),
    costPerKg: z
      .string()
      .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Cost per kg must be non-negative"),
    totalCost: z
      .string()
      .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Total cost must be non-negative"),
  });

export type InsertFactoryMixBatchSource = z.infer<typeof insertFactoryMixBatchSourceSchema>;
export type FactoryMixBatchSource = typeof factoryMixBatchSources.$inferSelect;

// ─── Factory Daily Usages ─────────────────────────────────────────────────────
export const factoryDailyUsages = pgTable(
  "factory_daily_usages",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    mixBatchId: integer("mix_batch_id").notNull(),
    kgUsed: decimal("kg_used", { precision: 15, scale: 3 }).notNull(),
    operatorUser: text("operator_user"),
    usedDate: date("used_date").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("factory_daily_usages_company_idx").on(t.companyId),
  })
);

export const insertFactoryDailyUsageSchema = createInsertSchema(factoryDailyUsages).omit({
  id: true,
  createdAt: true,
});

export type InsertFactoryDailyUsage = z.infer<typeof insertFactoryDailyUsageSchema>;
export type FactoryDailyUsage = typeof factoryDailyUsages.$inferSelect;

// ─── Factory Pressing Batches ─────────────────────────────────────────────────
export const factoryPressingBatches = pgTable(
  "factory_pressing_batches",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    mixBatchId: integer("mix_batch_id"),
    productId: integer("product_id"),
    expectedCount: integer("expected_count").notNull(),
    status: text("status").notNull().default("PENDING"),
    notes: text("notes"),
    createdBy: integer("created_by"),
    finalizedAt: timestamp("finalized_at"),
    finalizedLocationId: integer("finalized_location_id").references(() => locations.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("factory_pressing_batches_company_idx").on(t.companyId),
  })
);

export const insertFactoryPressingBatchSchema = createInsertSchema(factoryPressingBatches).omit({
  id: true,
  createdAt: true,
});

export type InsertFactoryPressingBatch = z.infer<typeof insertFactoryPressingBatchSchema>;
export type FactoryPressingBatch = typeof factoryPressingBatches.$inferSelect;

// ─── Factory Bales ────────────────────────────────────────────────────────────
export const factoryBales = pgTable(
  "factory_bales",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    mixBatchId: integer("mix_batch_id"),
    productId: integer("product_id"),
    pressingBatchId: integer("pressing_batch_id"),
    erpLocationId: integer("erp_location_id").references(() => locations.id, { onDelete: "restrict" }),
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
    workerName: text("worker_name"),
    stockEntryDate: date("stock_entry_date"),
    importBatchId: integer("import_batch_id"),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueCompanyRef: uniqueIndex("factory_bales_company_ref_unique").on(t.companyId, t.referenceNumber),
    statusIdx: index("factory_bales_status_idx").on(t.status),
    pressingBatchIdx: index("factory_bales_pressing_batch_idx").on(t.pressingBatchId),
    mixBatchIdx: index("factory_bales_mix_batch_idx").on(t.mixBatchId),
    companyIdx: index("factory_bales_company_idx").on(t.companyId),
    productIdx: index("factory_bales_product_idx").on(t.productId),
    companyStatusIdx: index("factory_bales_company_status_idx").on(t.companyId, t.status),
  })
);

export const insertFactoryBaleSchema = createInsertSchema(factoryBales)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    deletedAt: true,
  })
  .extend({
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
    status: z
      .enum(["PENDING_PRESSING", "IN_STOCK", "RESERVED_FOR_ORDER", "FINALIZED", "SOLD", "DISPATCHED", "DELETED"])
      .optional(),
    pressedAt: z.string().optional().nullable(),
    finalizedAt: z.string().optional().nullable(),
    finalizedBy: z.number().optional().nullable(),
  });

export type InsertFactoryBale = z.infer<typeof insertFactoryBaleSchema>;
export type FactoryBale = typeof factoryBales.$inferSelect;

// ─── Factory Bale Sequences ───────────────────────────────────────────────────
export const factoryBaleSequences = pgTable(
  "factory_bale_sequences",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    nextNumber: integer("next_number").notNull().default(1),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueCompanyId: uniqueIndex("factory_bale_sequences_company_unique").on(t.companyId),
  })
);

export type FactoryBaleSequence = typeof factoryBaleSequences.$inferSelect;

// ─── Factory Bale Import Batches ──────────────────────────────────────────────
export const factoryBaleImportBatches = pgTable(
  "factory_bale_import_batches",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    fileName: text("file_name").notNull(),
    baleCount: integer("bale_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    totalWeightKg: decimal("total_weight_kg", { precision: 15, scale: 3 }).notNull().default("0"),
    importedByUserId: varchar("imported_by_user_id", { length: 100 }),
    importedByName: text("imported_by_name"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("factory_bale_import_batches_company_idx").on(t.companyId),
  })
);

export const insertFactoryBaleImportBatchSchema = createInsertSchema(factoryBaleImportBatches).omit({
  id: true,
  createdAt: true,
});

export type InsertFactoryBaleImportBatch = z.infer<typeof insertFactoryBaleImportBatchSchema>;
export type FactoryBaleImportBatch = typeof factoryBaleImportBatches.$inferSelect;

// ─── Factory Container Commissions ───────────────────────────────────────────
export const factoryContainerCommissions = pgTable(
  "factory_container_commissions",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    containerId: integer("container_id")
      .notNull()
      .references(() => factoryContainers.id, { onDelete: "restrict" }),
    personName: text("person_name").notNull(),
    commissionType: text("commission_type").notNull().default("PER_KG"),
    commissionRate: decimal("commission_rate", { precision: 20, scale: 4 }).notNull(),
    commissionTotal: decimal("commission_total", { precision: 20, scale: 4 }).notNull(),
    currencyCode: varchar("currency_code", { length: 10 }).notNull().default("USD"),
    fxRateToUsd: decimal("fx_rate_to_usd", { precision: 20, scale: 8 }).notNull().default("1"),
    commissionTotalUsd: decimal("commission_total_usd", { precision: 20, scale: 4 }),
    ledgerAccountId: integer("ledger_account_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    containerIdx: index("factory_container_commissions_container_idx").on(t.containerId),
    companyIdx: index("factory_container_commissions_company_idx").on(t.companyId),
  })
);

export type FactoryContainerCommission = typeof factoryContainerCommissions.$inferSelect;

// ─── Factory Duty Audit Log ───────────────────────────────────────────────────
export const factoryDutyAuditLog = pgTable(
  "factory_duty_audit_log",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    containerId: integer("container_id")
      .notNull()
      .references(() => factoryContainers.id, { onDelete: "restrict" }),
    oldDutyAmount: decimal("old_duty_amount", { precision: 20, scale: 2 }),
    newDutyAmount: decimal("new_duty_amount", { precision: 20, scale: 2 }).notNull(),
    oldDutyStatus: text("old_duty_status"),
    newDutyStatus: text("new_duty_status").notNull(),
    notes: text("notes"),
    updatedByUserId: text("updated_by_user_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("factory_duty_audit_log_company_idx").on(t.companyId),
  })
);

export type FactoryDutyAuditLog = typeof factoryDutyAuditLog.$inferSelect;

// ─── Customer Proformas ───────────────────────────────────────────────────────
export const customerProformas = pgTable(
  "customer_proformas",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    status: text("status").notNull().default("ACTIVE"),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("customer_proformas_company_idx").on(t.companyId),
    customerCompanyIdx: index("customer_proformas_customer_company_idx").on(t.customerId, t.companyId),
  })
);

export const insertCustomerProformaSchema = createInsertSchema(customerProformas)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    deletedAt: true,
  })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    customerId: z.number().min(1, "Customer is required"),
    name: z.string().min(1, "Proforma name is required"),
    isActive: z.boolean().optional(),
    status: z.enum(["ACTIVE", "PARTIALLY_DISPATCHED", "FULLY_INVOICED", "CANCELLED"]).optional(),
  });

export type InsertCustomerProforma = z.infer<typeof insertCustomerProformaSchema>;
export type CustomerProforma = typeof customerProformas.$inferSelect;

// ─── Customer Proforma Lines ──────────────────────────────────────────────────
export const customerProformaLines = pgTable(
  "customer_proforma_lines",
  {
    id: serial("id").primaryKey(),
    proformaId: integer("proforma_id")
      .notNull()
      .references(() => customerProformas.id, { onDelete: "cascade" }),
    articleCode: varchar("article_code", { length: 50 }).notNull(),
    productName: text("product_name").notNull(),
    quantity: integer("quantity").notNull().default(0),
    pricePerBale: decimal("price_per_bale", { precision: 20, scale: 2 }).notNull(),
    productionPricePerBale: decimal("production_price_per_bale", { precision: 20, scale: 2 }).notNull().default("0"),
    priceFixed: boolean("price_fixed").notNull().default(false),
    pricingMode: text("pricing_mode").notNull().default("per_bale"),
    pricePerKg: decimal("price_per_kg", { precision: 20, scale: 4 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    proformaIdx: index("customer_proforma_lines_proforma_idx").on(t.proformaId),
  })
);

export const insertCustomerProformaLineSchema = createInsertSchema(customerProformaLines)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    proformaId: z.number().min(1, "Proforma is required"),
    articleCode: z.string().min(1, "Article code is required"),
    productName: z.string().min(1, "Product name is required"),
    quantity: z.number().int().min(1, "Quantity must be at least 1"),
    pricePerBale: z
      .string()
      .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Price must be non-negative"),
    pricingMode: z.enum(["per_bale", "per_kg"]).optional().default("per_bale"),
    pricePerKg: z.string().optional().nullable(),
  });

export type InsertCustomerProformaLine = z.infer<typeof insertCustomerProformaLineSchema>;
export type CustomerProformaLine = typeof customerProformaLines.$inferSelect;

// ─── Customer Orders ──────────────────────────────────────────────────────────
export const customerOrders = pgTable(
  "customer_orders",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    invoiceNumber: varchar("invoice_number", { length: 50 }),
    orderDate: date("order_date").notNull(),
    proformaIdUsed: integer("proforma_id_used"),
    status: text("status").notNull().default("DRAFT"),
    subtotalBales: decimal("subtotal_bales", { precision: 20, scale: 2 }).notNull().default("0"),
    freightAmount: decimal("freight_amount", { precision: 20, scale: 2 }).notNull().default("0"),
    otherChargesTotal: decimal("other_charges_total", { precision: 20, scale: 2 }).notNull().default("0"),
    grandTotal: decimal("grand_total", { precision: 20, scale: 2 }).notNull().default("0"),
    totalQtyBales: integer("total_qty_bales").notNull().default(0),
    containerNumber: varchar("container_number", { length: 100 }),
    shippingCompany: varchar("shipping_company", { length: 200 }),
    containerNotes: text("container_notes"),
    destination: text("destination"),
    verifiedByUserId: integer("verified_by_user_id"),
    verifiedAt: timestamp("verified_at"),
    loadingStartedAt: timestamp("loading_started_at"),
    loadingFinalizedAt: timestamp("loading_finalized_at"),
    locationId: integer("location_id").references(() => locations.id, { onDelete: "restrict" }),
    dispatchBatchId: integer("dispatch_batch_id"),
    isHidden: boolean("is_hidden").notNull().default(false),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("customer_orders_company_idx").on(t.companyId),
    customerIdx: index("customer_orders_customer_idx").on(t.customerId),
    statusIdx: index("customer_orders_status_idx").on(t.status),
    invoiceIdx: uniqueIndex("customer_orders_invoice_unique").on(t.companyId, t.invoiceNumber),
  })
);

export const insertCustomerOrderSchema = createInsertSchema(customerOrders)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    deletedAt: true,
  })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    customerId: z.number().min(1, "Customer is required"),
    orderDate: z.string().min(1, "Order date is required"),
    proformaIdUsed: z.number().optional().nullable(),
    status: z.enum(["DRAFT", "LOADING", "PENDING_VERIFICATION", "VERIFIED", "FINALIZED", "CANCELLED"]).optional(),
    subtotalBales: z.string().optional(),
    freightAmount: z.string().optional(),
    otherChargesTotal: z.string().optional(),
    grandTotal: z.string().optional(),
    totalQtyBales: z.number().optional(),
    invoiceNumber: z.string().optional().nullable(),
    containerNumber: z.string().optional().nullable(),
    shippingCompany: z.string().optional().nullable(),
    containerNotes: z.string().optional().nullable(),
    destination: z.string().optional().nullable(),
    verifiedByUserId: z.number().optional().nullable(),
    verifiedAt: z.date().optional().nullable(),
    loadingStartedAt: z.date().optional().nullable(),
    loadingFinalizedAt: z.date().optional().nullable(),
    locationId: z.number().optional().nullable(),
  });

export type InsertCustomerOrder = z.infer<typeof insertCustomerOrderSchema>;
export type CustomerOrder = typeof customerOrders.$inferSelect;

// ─── Customer Order Lines ─────────────────────────────────────────────────────
export const customerOrderLines = pgTable(
  "customer_order_lines",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => customerOrders.id, { onDelete: "cascade" }),
    articleCode: varchar("article_code", { length: 50 }).notNull(),
    baleName: text("bale_name").notNull(),
    qty: integer("qty").notNull().default(1),
    weightPerBale: decimal("weight_per_bale", { precision: 15, scale: 3 }).notNull(),
    totalWeight: decimal("total_weight", { precision: 15, scale: 3 }).notNull(),
    pricePerBale: decimal("price_per_bale", { precision: 20, scale: 2 }).notNull(),
    totalPrice: decimal("total_price", { precision: 20, scale: 2 }).notNull(),
    pricingMode: text("pricing_mode").notNull().default("per_bale"),
    pricePerKg: decimal("price_per_kg", { precision: 20, scale: 4 }),
  },
  (t) => ({
    orderIdx: index("customer_order_lines_order_idx").on(t.orderId),
  })
);

export type CustomerOrderLine = typeof customerOrderLines.$inferSelect;

// ─── Customer Order Bales ─────────────────────────────────────────────────────
export const customerOrderBales = pgTable(
  "customer_order_bales",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => customerOrders.id, { onDelete: "cascade" }),
    baleId: integer("bale_id").notNull(),
    baleReference: varchar("bale_reference", { length: 100 }).notNull(),
    locationId: integer("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    weight: decimal("weight", { precision: 15, scale: 3 }).notNull(),
    articleCode: varchar("article_code", { length: 50 }),
    baleName: text("bale_name"),
    priceUsed: decimal("price_used", { precision: 20, scale: 2 }).notNull(),
    scannedBy: text("scanned_by"),
  },
  (t) => ({
    orderIdx: index("customer_order_bales_order_idx").on(t.orderId),
    baleIdx: index("customer_order_bales_bale_idx").on(t.baleId),
  })
);

export type CustomerOrderBale = typeof customerOrderBales.$inferSelect;

// ─── Customer Order Bales History ─────────────────────────────────────────────
export const customerOrderBalesHistory = pgTable("customer_order_bales_history", {
  id: serial("id").primaryKey(),
  originalId: integer("original_id").notNull(),
  orderId: integer("order_id").notNull(),
  baleId: integer("bale_id").notNull(),
  baleReference: varchar("bale_reference", { length: 100 }).notNull(),
  locationId: integer("location_id").notNull(),
  weight: decimal("weight", { precision: 15, scale: 3 }).notNull(),
  articleCode: varchar("article_code", { length: 50 }),
  baleName: text("bale_name"),
  priceUsed: decimal("price_used", { precision: 20, scale: 2 }).notNull(),
  scannedBy: text("scanned_by"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Customer Order Expected Lines ────────────────────────────────────────────
export const customerOrderExpectedLines = pgTable(
  "customer_order_expected_lines",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    orderId: integer("order_id")
      .notNull()
      .references(() => customerOrders.id, { onDelete: "cascade" }),
    proformaId: integer("proforma_id"),
    proformaLineId: integer("proforma_line_id"),
    articleCode: varchar("article_code", { length: 50 }).notNull(),
    productName: text("product_name"),
    expectedQty: integer("expected_qty").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    orderIdx: index("coel_order_idx").on(t.orderId),
    companyIdx: index("coel_company_idx").on(t.companyId),
    orderArticleUnique: uniqueIndex("coel_order_article_unique").on(t.orderId, t.articleCode),
  })
);

export const insertCustomerOrderExpectedLineSchema = createInsertSchema(customerOrderExpectedLines).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCustomerOrderExpectedLine = z.infer<typeof insertCustomerOrderExpectedLineSchema>;
export type CustomerOrderExpectedLine = typeof customerOrderExpectedLines.$inferSelect;

// ─── Customer Order Charges ───────────────────────────────────────────────────
export const customerOrderCharges = pgTable(
  "customer_order_charges",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => customerOrders.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    amount: decimal("amount", { precision: 20, scale: 2 }).notNull(),
    chargeType: text("charge_type").notNull().default("OTHER"),
    ledgerAccountId: integer("ledger_account_id"),
    voucherId: integer("voucher_id").references(() => vouchers.id, { onDelete: "restrict" }),
  },
  (t) => ({
    orderIdx: index("customer_order_charges_order_idx").on(t.orderId),
  })
);

export type CustomerOrderCharge = typeof customerOrderCharges.$inferSelect;

// ─── Customer Invoice Sequences ───────────────────────────────────────────────
export const customerInvoiceSequences = pgTable(
  "customer_invoice_sequences",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    nextNumber: integer("next_number").notNull().default(1),
  },
  (t) => ({
    uniqueCompanyId: uniqueIndex("customer_invoice_sequences_company_unique").on(t.companyId),
  })
);

export type CustomerInvoiceSequence = typeof customerInvoiceSequences.$inferSelect;

// ─── Factory FX Rates ─────────────────────────────────────────────────────────
export const factoryFxRates = pgTable(
  "factory_fx_rates",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    currencyCode: varchar("currency_code", { length: 10 }).notNull(),
    rateToUsd: decimal("rate_to_usd", { precision: 20, scale: 8 }).notNull(),
    effectiveDate: date("effective_date").notNull(),
    source: varchar("source", { length: 10 }).notNull().default("auto"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyDateIdx: index("factory_fx_rates_company_date_idx").on(t.companyId, t.effectiveDate),
    companyCurrencyIdx: index("factory_fx_rates_company_currency_idx").on(t.companyId, t.currencyCode),
  })
);

export const insertFactoryFxRateSchema = createInsertSchema(factoryFxRates)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    currencyCode: z.string().min(1, "Currency code is required"),
    rateToUsd: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Rate must be positive"),
    effectiveDate: z.string().min(1, "Date is required"),
  });

export type InsertFactoryFxRate = z.infer<typeof insertFactoryFxRateSchema>;
export type FactoryFxRate = typeof factoryFxRates.$inferSelect;

// ─── Factory Daybook Entries ──────────────────────────────────────────────────
export const factoryDaybookEntries = pgTable(
  "factory_daybook_entries",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    txDate: date("tx_date").notNull(),
    txType: text("tx_type").notNull(),
    referenceId: integer("reference_id"),
    referenceTable: text("reference_table"),
    description: text("description").notNull(),
    metaJson: text("meta_json"),
    currencyCode: varchar("currency_code", { length: 10 }).notNull().default("USD"),
    amountCurrency: decimal("amount_currency", { precision: 20, scale: 2 }).notNull().default("0"),
    fxRateToUsd: decimal("fx_rate_to_usd", { precision: 20, scale: 8 }).notNull().default("1"),
    amountUsd: decimal("amount_usd", { precision: 20, scale: 2 }).notNull().default("0"),
    effectiveDate: date("effective_date"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    createdBy: varchar("created_by"),
  },
  (t) => ({
    companyDateIdx: index("factory_daybook_company_date_idx").on(t.companyId, t.txDate),
    txTypeIdx: index("factory_daybook_tx_type_idx").on(t.txType),
  })
);

export const insertFactoryDaybookEntrySchema = createInsertSchema(factoryDaybookEntries)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    companyId: z.number().min(1),
    txDate: z.string().min(1),
    txType: z.string().min(1),
    description: z.string().min(1),
    currencyCode: z.string().optional(),
    amountCurrency: z.string().optional(),
    fxRateToUsd: z.string().optional(),
    amountUsd: z.string().optional(),
    referenceId: z.number().optional().nullable(),
    referenceTable: z.string().optional().nullable(),
    metaJson: z.string().optional().nullable(),
    createdBy: z.string().optional().nullable(),
    effectiveDate: z.string().optional().nullable(),
  });

export type InsertFactoryDaybookEntry = z.infer<typeof insertFactoryDaybookEntrySchema>;
export type FactoryDaybookEntry = typeof factoryDaybookEntries.$inferSelect;

// ─── Factory Daybook Entry Edits ──────────────────────────────────────────────
export const factoryDaybookEntryEdits = pgTable(
  "factory_daybook_entry_edits",
  {
    id: serial("id").primaryKey(),
    daybookEntryId: integer("daybook_entry_id").notNull(),
    editedAt: timestamp("edited_at").notNull().defaultNow(),
    editedBy: varchar("edited_by"),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    reason: text("reason").notNull(),
  },
  (t) => ({
    entryIdx: index("daybook_edits_entry_idx").on(t.daybookEntryId),
  })
);

export type FactoryDaybookEntryEdit = typeof factoryDaybookEntryEdits.$inferSelect;

// ─── Factory Workers ──────────────────────────────────────────────────────────
export const factoryWorkers = pgTable(
  "factory_workers",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    employeeCode: varchar("employee_code", { length: 50 }),
    fullName: varchar("full_name", { length: 200 }).notNull(),
    fatherName: varchar("father_name", { length: 200 }),
    motherName: varchar("mother_name", { length: 200 }),
    nationalId: varchar("national_id", { length: 100 }),
    passportNumber: varchar("passport_number", { length: 100 }),
    dateOfBirth: date("date_of_birth"),
    gender: varchar("gender", { length: 20 }),
    nationality: varchar("nationality", { length: 100 }),
    maritalStatus: varchar("marital_status", { length: 30 }),
    numberOfChildren: integer("number_of_children").default(0),
    phone1: varchar("phone1", { length: 50 }),
    phone2: varchar("phone2", { length: 50 }),
    emergencyContactName: varchar("emergency_contact_name", { length: 200 }),
    emergencyContactPhone: varchar("emergency_contact_phone", { length: 50 }),
    address: text("address"),
    city: varchar("city", { length: 100 }),
    country: varchar("country", { length: 100 }),
    position: varchar("position", { length: 100 }),
    department: varchar("department", { length: 100 }),
    dateJoined: date("date_joined"),
    contractStartDate: date("contract_start_date"),
    contractEndDate: date("contract_end_date"),
    salaryType: varchar("salary_type", { length: 30 }).notNull().default("Monthly"),
    baseSalary: decimal("base_salary", { precision: 20, scale: 2 }).default("0"),
    perBaleRate: decimal("per_bale_rate", { precision: 20, scale: 4 }).default("0"),
    perKgRate: decimal("per_kg_rate", { precision: 20, scale: 4 }).default("0"),
    overtimeRate: decimal("overtime_rate", { precision: 20, scale: 2 }).default("0"),
    shiftType: varchar("shift_type", { length: 50 }),
    active: boolean("active").notNull().default(true),
    bankName: varchar("bank_name", { length: 200 }),
    bankAccountNumber: varchar("bank_account_number", { length: 100 }),
    paymentMethod: varchar("payment_method", { length: 30 }).default("Cash"),
    photoUrl: text("photo_url"),
    notes: text("notes"),
    payFrequency: varchar("pay_frequency", { length: 20 }).default("Monthly"),
    hourlyRate: decimal("hourly_rate", { precision: 20, scale: 4 }).default("0"),
    weeklySalary: decimal("weekly_salary", { precision: 20, scale: 2 }).default("0"),
    biWeeklySalary: decimal("bi_weekly_salary", { precision: 20, scale: 2 }).default("0"),
    transportAllowance: decimal("transport_allowance", { precision: 20, scale: 2 }).default("0"),
    visaNumber: varchar("visa_number", { length: 100 }),
    visaExpiry: date("visa_expiry"),
    workPermitNumber: varchar("work_permit_number", { length: 100 }),
    workPermitExpiry: date("work_permit_expiry"),
    residentialPermit: varchar("residential_permit", { length: 100 }),
    residentialPermitExpiry: date("residential_permit_expiry"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("factory_workers_company_idx").on(t.companyId),
    activeIdx: index("factory_workers_active_idx").on(t.active),
    codeIdx: index("factory_workers_code_idx").on(t.companyId, t.employeeCode),
  })
);

export const insertFactoryWorkerSchema = createInsertSchema(factoryWorkers)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    fullName: z.string().min(1, "Full name is required"),
    fatherName: z.string().optional().nullable(),
    motherName: z.string().optional().nullable(),
    nationalId: z.string().optional().nullable(),
    passportNumber: z.string().optional().nullable(),
    dateOfBirth: z.string().optional().nullable(),
    gender: z.string().optional().nullable(),
    nationality: z.string().optional().nullable(),
    maritalStatus: z.string().optional().nullable(),
    numberOfChildren: z.number().optional().nullable(),
    phone1: z.string().optional().nullable(),
    phone2: z.string().optional().nullable(),
    emergencyContactName: z.string().optional().nullable(),
    emergencyContactPhone: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    country: z.string().optional().nullable(),
    employeeCode: z.string().optional().nullable(),
    position: z.string().optional().nullable(),
    department: z.string().optional().nullable(),
    dateJoined: z.string().optional().nullable(),
    contractStartDate: z.string().optional().nullable(),
    contractEndDate: z.string().optional().nullable(),
    salaryType: z.enum(["Monthly", "Daily", "Per Bale", "Per KG"]).optional(),
    baseSalary: z.string().optional().nullable(),
    perBaleRate: z.string().optional().nullable(),
    perKgRate: z.string().optional().nullable(),
    overtimeRate: z.string().optional().nullable(),
    shiftType: z.string().optional().nullable(),
    active: z.boolean().optional(),
    bankName: z.string().optional().nullable(),
    bankAccountNumber: z.string().optional().nullable(),
    paymentMethod: z.enum(["Cash", "Bank", "Transfer"]).optional(),
    photoUrl: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    payFrequency: z.enum(["Monthly", "Hourly", "Weekly", "Bi-Weekly"]).optional(),
    hourlyRate: z.string().optional().nullable(),
    weeklySalary: z.string().optional().nullable(),
    biWeeklySalary: z.string().optional().nullable(),
    transportAllowance: z.string().optional().nullable(),
    visaNumber: z.string().optional().nullable(),
    visaExpiry: z.string().optional().nullable(),
    workPermitNumber: z.string().optional().nullable(),
    workPermitExpiry: z.string().optional().nullable(),
    residentialPermit: z.string().optional().nullable(),
    residentialPermitExpiry: z.string().optional().nullable(),
  });

export type InsertFactoryWorker = z.infer<typeof insertFactoryWorkerSchema>;
export type FactoryWorker = typeof factoryWorkers.$inferSelect;

// ─── Factory Payrolls ─────────────────────────────────────────────────────────
export const factoryPayrolls = pgTable(
  "factory_payrolls",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    workerId: integer("worker_id").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    baseSalary: decimal("base_salary", { precision: 20, scale: 2 }).default("0"),
    baleEarnings: decimal("bale_earnings", { precision: 20, scale: 2 }).default("0"),
    kgEarnings: decimal("kg_earnings", { precision: 20, scale: 2 }).default("0"),
    overtimePay: decimal("overtime_pay", { precision: 20, scale: 2 }).default("0"),
    bonuses: decimal("bonuses", { precision: 20, scale: 2 }).default("0"),
    transport: decimal("transport", { precision: 20, scale: 2 }).default("0"),
    deductions: decimal("deductions", { precision: 20, scale: 2 }).default("0"),
    advances: decimal("advances", { precision: 20, scale: 2 }).default("0"),
    netSalary: decimal("net_salary", { precision: 20, scale: 2 }).default("0"),
    balesCount: integer("bales_count").default(0),
    kgProcessed: decimal("kg_processed", { precision: 15, scale: 3 }).default("0"),
    overtimeHours: decimal("overtime_hours", { precision: 10, scale: 2 }).default("0"),
    totalWorkingDays: integer("total_working_days").default(0),
    presentDays: decimal("present_days", { precision: 10, scale: 1 }).default("0"),
    absentDays: decimal("absent_days", { precision: 10, scale: 1 }).default("0"),
    notes: text("notes"),
    status: varchar("status", { length: 30 }).notNull().default("DRAFT"),
    cashAccountId: integer("cash_account_id").references(() => ledgerAccounts.id, { onDelete: "restrict" }),
    paidAt: timestamp("paid_at"),
    generatedAt: timestamp("generated_at").notNull().defaultNow(),
    approvedAt: timestamp("approved_at"),
    approvedBy: integer("approved_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("factory_payrolls_company_idx").on(t.companyId),
    workerIdx: index("factory_payrolls_worker_idx").on(t.workerId),
    periodIdx: index("factory_payrolls_period_idx").on(t.periodStart, t.periodEnd),
  })
);

export const insertFactoryPayrollSchema = createInsertSchema(factoryPayrolls).omit({
  id: true,
  createdAt: true,
});

export type InsertFactoryPayroll = z.infer<typeof insertFactoryPayrollSchema>;
export type FactoryPayroll = typeof factoryPayrolls.$inferSelect;

// ─── Factory Attendance ───────────────────────────────────────────────────────
export const factoryAttendance = pgTable(
  "factory_attendance",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    workerId: integer("worker_id")
      .notNull()
      .references(() => factoryWorkers.id),
    attendanceDate: date("attendance_date").notNull(),
    shift: varchar("shift", { length: 50 }),
    status: varchar("status", { length: 20 }).notNull().default("Present"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    companyDateIdx: index("factory_attendance_company_date_idx").on(t.companyId, t.attendanceDate),
    uniqueWorkerDate: uniqueIndex("factory_attendance_worker_date_unique").on(t.workerId, t.attendanceDate),
  })
);

export const insertFactoryAttendanceSchema = createInsertSchema(factoryAttendance).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertFactoryAttendance = z.infer<typeof insertFactoryAttendanceSchema>;
export type FactoryAttendance = typeof factoryAttendance.$inferSelect;

// ─── Factory Worker Advances ──────────────────────────────────────────────────
export const factoryWorkerAdvances = pgTable(
  "factory_worker_advances",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    workerId: integer("worker_id")
      .notNull()
      .references(() => factoryWorkers.id),
    advanceDate: date("advance_date").notNull(),
    amount: decimal("amount", { precision: 20, scale: 2 }).notNull(),
    remainingBalance: decimal("remaining_balance", { precision: 20, scale: 2 }).notNull().default("0"),
    cashAccountId: integer("cash_account_id").references(() => ledgerAccounts.id, { onDelete: "restrict" }),
    notes: text("notes"),
    fullyPaid: boolean("fully_paid").notNull().default(false),
    repaymentType: varchar("repayment_type", { length: 30 }).notNull().default("salary_deduction"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("factory_worker_advances_company_idx").on(t.companyId),
    workerIdx: index("factory_worker_advances_worker_idx").on(t.workerId),
  })
);

export const insertFactoryWorkerAdvanceSchema = createInsertSchema(factoryWorkerAdvances)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    workerId: z.number().min(1, "Worker is required"),
    advanceDate: z.string().min(1, "Advance date is required"),
    amount: z.string().min(1, "Amount is required"),
    notes: z.string().optional().nullable(),
    cashAccountId: z.number().optional().nullable(),
    repaymentType: z.enum(["salary_deduction", "manual_repayment"]).optional().default("salary_deduction"),
  });

export type InsertFactoryWorkerAdvance = z.infer<typeof insertFactoryWorkerAdvanceSchema>;
export type FactoryWorkerAdvance = typeof factoryWorkerAdvances.$inferSelect;

// ─── Factory Advance Repayments ───────────────────────────────────────────────
export const factoryAdvanceRepayments = pgTable(
  "factory_advance_repayments",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    advanceId: integer("advance_id")
      .notNull()
      .references(() => factoryWorkerAdvances.id, { onDelete: "cascade" }),
    workerId: integer("worker_id").notNull(),
    payrollId: integer("payroll_id"),
    repaymentDate: date("repayment_date").notNull(),
    amount: decimal("amount", { precision: 20, scale: 2 }).notNull(),
    cashAccountId: integer("cash_account_id").references(() => ledgerAccounts.id, { onDelete: "restrict" }),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    advanceIdx: index("factory_advance_repayments_advance_idx").on(t.advanceId),
    companyIdx: index("factory_advance_repayments_company_idx").on(t.companyId),
    payrollIdx: index("factory_advance_repayments_payroll_idx").on(t.payrollId),
  })
);

export const insertFactoryAdvanceRepaymentSchema = createInsertSchema(factoryAdvanceRepayments)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    advanceId: z.number().min(1, "Advance is required"),
    workerId: z.number().min(1, "Worker is required"),
    repaymentDate: z.string().min(1, "Repayment date is required"),
    amount: z.string().min(1, "Amount is required"),
    cashAccountId: z.number().optional().nullable(),
    notes: z.string().optional().nullable(),
  });

export type InsertFactoryAdvanceRepayment = z.infer<typeof insertFactoryAdvanceRepaymentSchema>;
export type FactoryAdvanceRepayment = typeof factoryAdvanceRepayments.$inferSelect;

// ─── Factory Worker Deductions ────────────────────────────────────────────────
export const factoryWorkerDeductions = pgTable(
  "factory_worker_deductions",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    workerId: integer("worker_id")
      .notNull()
      .references(() => factoryWorkers.id),
    amount: decimal("amount", { precision: 20, scale: 2 }).notNull(),
    reason: text("reason"),
    deductionDate: date("deduction_date").notNull(),
    applied: boolean("applied").notNull().default(false),
    payrollId: integer("payroll_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("factory_worker_deductions_company_idx").on(t.companyId),
    workerIdx: index("factory_worker_deductions_worker_idx").on(t.workerId),
  })
);

export const insertFactoryWorkerDeductionSchema = createInsertSchema(factoryWorkerDeductions)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    amount: z
      .string()
      .min(1, "Amount is required")
      .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0, "Amount must be positive"),
    reason: z.string().optional().nullable(),
    deductionDate: z.string().min(1, "Date is required"),
  });

export type InsertFactoryWorkerDeduction = z.infer<typeof insertFactoryWorkerDeductionSchema>;
export type FactoryWorkerDeduction = typeof factoryWorkerDeductions.$inferSelect;

// ─── Factory Worker Documents ─────────────────────────────────────────────────
export const factoryWorkerDocuments = pgTable(
  "factory_worker_documents",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    workerId: integer("worker_id").notNull(),
    fileName: text("file_name").notNull(),
    originalName: text("original_name").notNull(),
    fileUrl: text("file_url").notNull(),
    fileType: text("file_type"),
    fileSize: integer("file_size"),
    fileData: text("file_data"),
    uploadedAt: timestamp("uploaded_at").defaultNow(),
  },
  (t) => ({
    companyIdx: index("factory_worker_documents_company_idx").on(t.companyId),
  })
);

export type FactoryWorkerDocument = typeof factoryWorkerDocuments.$inferSelect;

// ─── Factory Settings ─────────────────────────────────────────────────────────
export const factorySettings = pgTable(
  "factory_settings",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    dashboardEnabled: boolean("dashboard_enabled").notNull().default(false),
    kpisEnabled: boolean("kpis_enabled").notNull().default(false),
    profitabilityEnabled: boolean("profitability_enabled").notNull().default(false),
    alertsEnabled: boolean("alerts_enabled").notNull().default(false),
    supplierScoringEnabled: boolean("supplier_scoring_enabled").notNull().default(false),
    mixOptimizerEnabled: boolean("mix_optimizer_enabled").notNull().default(false),
    traceabilityEnabled: boolean("traceability_enabled").notNull().default(false),
    balePhotosEnabled: boolean("bale_photos_enabled").notNull().default(false),
    wasteTrackingEnabled: boolean("waste_tracking_enabled").notNull().default(false),
    cashflowEnabled: boolean("cashflow_enabled").notNull().default(false),
    rolesEnabled: boolean("roles_enabled").notNull().default(false),
    netProfitEnabled: boolean("net_profit_enabled").notNull().default(false),
    productionSummaryEnabled: boolean("production_summary_enabled").notNull().default(false),
    supplierReportEnabled: boolean("supplier_report_enabled").notNull().default(false),
    supplierStatementEnabled: boolean("supplier_statement_enabled").notNull().default(false),
    laborCostPerKg: decimal("labor_cost_per_kg", { precision: 10, scale: 4 }).default("0"),
    overheadPerKg: decimal("overhead_per_kg", { precision: 10, scale: 4 }).default("0"),
    hideSellingPrice: boolean("hide_selling_price").notNull().default(false),
    hideAvgCost: boolean("hide_avg_cost").notNull().default(false),
    extraSettings: jsonb("extra_settings").default({}),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    companyUnique: uniqueIndex("factory_settings_company_unique").on(t.companyId),
  })
);

export const insertFactorySettingsSchema = createInsertSchema(factorySettings).omit({
  id: true,
  updatedAt: true,
});

export type InsertFactorySettings = z.infer<typeof insertFactorySettingsSchema>;
export type FactorySettings = typeof factorySettings.$inferSelect;

// ─── Factory Alerts ───────────────────────────────────────────────────────────
export const factoryAlerts = pgTable(
  "factory_alerts",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    type: varchar("type", { length: 50 }).notNull(),
    severity: varchar("severity", { length: 20 }).notNull().default("info"),
    title: varchar("title", { length: 255 }).notNull(),
    message: text("message"),
    entityType: varchar("entity_type", { length: 50 }),
    entityId: integer("entity_id"),
    isRead: boolean("is_read").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("factory_alerts_company_idx").on(t.companyId),
    readIdx: index("factory_alerts_read_idx").on(t.companyId, t.isRead),
  })
);

export const insertFactoryAlertSchema = createInsertSchema(factoryAlerts).omit({
  id: true,
  createdAt: true,
});

export type InsertFactoryAlert = z.infer<typeof insertFactoryAlertSchema>;
export type FactoryAlert = typeof factoryAlerts.$inferSelect;

// ─── Factory Waste Entries ────────────────────────────────────────────────────
export const factoryWasteEntries = pgTable(
  "factory_waste_entries",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    date: date("date").notNull(),
    mixBatchId: integer("mix_batch_id"),
    supplierId: integer("supplier_id").references(() => factorySuppliers.id, { onDelete: "restrict" }),
    containerId: integer("container_id").references(() => factoryContainers.id, { onDelete: "restrict" }),
    wasteType: varchar("waste_type", { length: 50 }),
    kgWaste: decimal("kg_waste", { precision: 15, scale: 3 }).notNull(),
    reason: text("reason"),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("factory_waste_company_idx").on(t.companyId),
    dateIdx: index("factory_waste_date_idx").on(t.companyId, t.date),
  })
);

export const insertFactoryWasteEntrySchema = createInsertSchema(factoryWasteEntries).omit({
  id: true,
  createdAt: true,
});

export type InsertFactoryWasteEntry = z.infer<typeof insertFactoryWasteEntrySchema>;
export type FactoryWasteEntry = typeof factoryWasteEntries.$inferSelect;

// ─── Factory Bale Photos ──────────────────────────────────────────────────────
export const factoryBalePhotos = pgTable(
  "factory_bale_photos",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    baleId: integer("bale_id")
      .notNull()
      .references(() => factoryBales.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    fileName: varchar("file_name", { length: 255 }),
    uploadedBy: varchar("uploaded_by"),
    uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  },
  (t) => ({
    baleIdx: index("factory_bale_photos_bale_idx").on(t.baleId),
    companyIdx: index("factory_bale_photos_company_idx").on(t.companyId),
  })
);

export const insertFactoryBalePhotoSchema = createInsertSchema(factoryBalePhotos).omit({
  id: true,
  uploadedAt: true,
});

export type InsertFactoryBalePhoto = z.infer<typeof insertFactoryBalePhotoSchema>;
export type FactoryBalePhoto = typeof factoryBalePhotos.$inferSelect;

// ─── Factory Bale Product Images ──────────────────────────────────────────────
export const factoryBaleProductImages = pgTable(
  "factory_bale_product_images",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    articleCode: varchar("article_code", { length: 50 }).notNull(),
    productId: integer("product_id"),
    url: text("url").notNull(),
    fileName: varchar("file_name", { length: 255 }),
    sortOrder: integer("sort_order").default(0),
    uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("factory_bale_product_images_company_idx").on(t.companyId),
    articleCodeIdx: index("factory_bale_product_images_article_code_idx").on(t.articleCode),
  })
);

export type FactoryBaleProductImage = typeof factoryBaleProductImages.$inferSelect;

// ─── Factory Daily KPI Snapshots ──────────────────────────────────────────────
export const factoryDailyKpiSnapshots = pgTable(
  "factory_daily_kpi_snapshots",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    date: date("date").notNull(),
    totalKgIn: decimal("total_kg_in", { precision: 15, scale: 3 }).default("0"),
    totalKgPressed: decimal("total_kg_pressed", { precision: 15, scale: 3 }).default("0"),
    totalBalesProduced: integer("total_bales_produced").default(0),
    totalWasteKg: decimal("total_waste_kg", { precision: 15, scale: 3 }).default("0"),
    topWorkerId: integer("top_worker_id"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyDateUnique: uniqueIndex("factory_kpi_company_date_unique").on(t.companyId, t.date),
  })
);

export const insertFactoryDailyKpiSnapshotSchema = createInsertSchema(factoryDailyKpiSnapshots).omit({
  id: true,
  createdAt: true,
});

export type InsertFactoryDailyKpiSnapshot = z.infer<typeof insertFactoryDailyKpiSnapshotSchema>;
export type FactoryDailyKpiSnapshot = typeof factoryDailyKpiSnapshots.$inferSelect;

// ─── Factory Supplier Score Snapshots ────────────────────────────────────────
export const factorySupplierScoreSnapshots = pgTable(
  "factory_supplier_score_snapshots",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    supplierId: integer("supplier_id")
      .notNull()
      .references(() => factorySuppliers.id, { onDelete: "restrict" }),
    fromDate: date("from_date").notNull(),
    toDate: date("to_date").notNull(),
    totalKg: decimal("total_kg", { precision: 15, scale: 3 }).default("0"),
    wasteKg: decimal("waste_kg", { precision: 15, scale: 3 }).default("0"),
    wastePct: decimal("waste_pct", { precision: 8, scale: 2 }).default("0"),
    avgCostPerKg: decimal("avg_cost_per_kg", { precision: 12, scale: 4 }).default("0"),
    outputBales: integer("output_bales").default(0),
    score0to100: integer("score_0_to_100").default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companySupplierIdx: index("factory_supplier_score_company_idx").on(t.companyId, t.supplierId),
  })
);

export const insertFactorySupplierScoreSnapshotSchema = createInsertSchema(factorySupplierScoreSnapshots).omit({
  id: true,
  createdAt: true,
});

export type InsertFactorySupplierScoreSnapshot = z.infer<typeof insertFactorySupplierScoreSnapshotSchema>;
export type FactorySupplierScoreSnapshot = typeof factorySupplierScoreSnapshots.$inferSelect;

// ─── Factory Bale Cost Snapshots ──────────────────────────────────────────────
export const factoryBaleCostSnapshots = pgTable(
  "factory_bale_cost_snapshots",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    baleId: integer("bale_id")
      .notNull()
      .references(() => factoryBales.id, { onDelete: "cascade" }),
    materialCost: decimal("material_cost", { precision: 15, scale: 4 }).default("0"),
    laborCost: decimal("labor_cost", { precision: 15, scale: 4 }).default("0"),
    overheadCost: decimal("overhead_cost", { precision: 15, scale: 4 }).default("0"),
    freightAllocated: decimal("freight_allocated", { precision: 15, scale: 4 }).default("0"),
    totalCost: decimal("total_cost", { precision: 15, scale: 4 }).default("0"),
    salePrice: decimal("sale_price", { precision: 15, scale: 4 }),
    profit: decimal("profit", { precision: 15, scale: 4 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    baleIdx: index("factory_bale_cost_bale_idx").on(t.baleId),
    companyIdx: index("factory_bale_cost_company_idx").on(t.companyId),
  })
);

export const insertFactoryBaleCostSnapshotSchema = createInsertSchema(factoryBaleCostSnapshots).omit({
  id: true,
  createdAt: true,
});

export type InsertFactoryBaleCostSnapshot = z.infer<typeof insertFactoryBaleCostSnapshotSchema>;
export type FactoryBaleCostSnapshot = typeof factoryBaleCostSnapshots.$inferSelect;

// ─── Factory Container Profit Snapshots ───────────────────────────────────────
export const factoryContainerProfitSnapshots = pgTable(
  "factory_container_profit_snapshots",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    containerId: integer("container_id")
      .notNull()
      .references(() => factoryContainers.id, { onDelete: "cascade" }),
    totalRevenue: decimal("total_revenue", { precision: 20, scale: 4 }).default("0"),
    totalCost: decimal("total_cost", { precision: 20, scale: 4 }).default("0"),
    profit: decimal("profit", { precision: 20, scale: 4 }).default("0"),
    marginPct: decimal("margin_pct", { precision: 8, scale: 2 }).default("0"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    containerIdx: index("factory_container_profit_container_idx").on(t.containerId),
    companyIdx: index("factory_container_profit_company_idx").on(t.companyId),
  })
);

export const insertFactoryContainerProfitSnapshotSchema = createInsertSchema(factoryContainerProfitSnapshots).omit({
  id: true,
  createdAt: true,
});

export type InsertFactoryContainerProfitSnapshot = z.infer<typeof insertFactoryContainerProfitSnapshotSchema>;
export type FactoryContainerProfitSnapshot = typeof factoryContainerProfitSnapshots.$inferSelect;

// ─── Factory User Profiles ────────────────────────────────────────────────────
export const factoryUserProfiles = pgTable(
  "factory_user_profiles",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    userId: varchar("user_id").notNull(),
    displayName: text("display_name").notNull(),
    hasErpAccess: boolean("has_erp_access").notNull().default(true),
    hasFactoryAccess: boolean("has_factory_access").notNull().default(true),
    hiddenCostFields: text("hidden_cost_fields").array().notNull().default([]),
    hideAllCosts: boolean("hide_all_costs").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueCompanyUser: uniqueIndex("factory_user_profiles_unique").on(t.companyId, t.userId),
  })
);

export const insertFactoryUserProfileSchema = createInsertSchema(factoryUserProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertFactoryUserProfile = z.infer<typeof insertFactoryUserProfileSchema>;
export type FactoryUserProfile = typeof factoryUserProfiles.$inferSelect;

// ─── Factory User Page Access ─────────────────────────────────────────────────
export const factoryUserPageAccess = pgTable(
  "factory_user_page_access",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    userId: varchar("user_id").notNull(),
    pageKey: text("page_key").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueCompanyUserPage: uniqueIndex("factory_user_page_access_unique").on(t.companyId, t.userId, t.pageKey),
  })
);

export const insertFactoryUserPageAccessSchema = createInsertSchema(factoryUserPageAccess).omit({
  id: true,
  createdAt: true,
});

export type InsertFactoryUserPageAccess = z.infer<typeof insertFactoryUserPageAccessSchema>;
export type FactoryUserPageAccess = typeof factoryUserPageAccess.$inferSelect;

// ─── Factory Bale Waste Dispatches ───────────────────────────────────────────
export const factoryBaleWasteDispatches = pgTable(
  "factory_bale_waste_dispatches",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    dispatchNumber: text("dispatch_number").notNull(),
    dispatchDate: date("dispatch_date").notNull(),
    notes: text("notes"),
    totalBales: integer("total_bales").notNull().default(0),
    totalWeightKg: decimal("total_weight_kg", { precision: 15, scale: 3 }).notNull().default("0"),
    totalCostWrittenOff: decimal("total_cost_written_off", { precision: 15, scale: 2 }).notNull().default("0"),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("factory_bale_waste_dispatches_company_idx").on(t.companyId),
  })
);

export const insertFactoryBaleWasteDispatchSchema = createInsertSchema(factoryBaleWasteDispatches).omit({
  id: true,
  createdAt: true,
});
export type InsertFactoryBaleWasteDispatch = z.infer<typeof insertFactoryBaleWasteDispatchSchema>;
export type FactoryBaleWasteDispatch = typeof factoryBaleWasteDispatches.$inferSelect;

// ─── Factory POS Sales ────────────────────────────────────────────────────────
export const factoryPosSales = pgTable(
  "factory_pos_sales",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    saleNumber: text("sale_number").notNull(),
    txDate: date("tx_date").notNull(),
    locationId: integer("location_id").references(() => locations.id, { onDelete: "restrict" }),
    customerName: text("customer_name"),
    customerId: integer("customer_id").references(() => customers.id, { onDelete: "restrict" }),
    notes: text("notes"),
    totalAmount: decimal("total_amount", { precision: 20, scale: 2 }).notNull().default("0"),
    currencyCode: varchar("currency_code", { length: 10 }).notNull().default("USD"),
    cashAccountId: integer("cash_account_id").references(() => ledgerAccounts.id, { onDelete: "restrict" }),
    paymentType: text("payment_type").notNull().default("CASH"),
    depositAmount: decimal("deposit_amount", { precision: 20, scale: 2 }).default("0"),
    status: text("status").notNull().default("COMPLETED"),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    expensesJson: text("expenses_json"),
  },
  (t) => ({
    companyIdx: index("factory_pos_sales_company_idx").on(t.companyId),
  })
);

export const insertFactoryPosSaleSchema = createInsertSchema(factoryPosSales)
  .omit({ id: true, createdAt: true })
  .extend({
    companyId: z.number().min(1),
    saleNumber: z.string().min(1),
    txDate: z.string().min(1),
    totalAmount: z.string().optional(),
    currencyCode: z.string().optional(),
    cashAccountId: z.number().optional().nullable(),
    locationId: z.number().optional().nullable(),
    customerName: z.string().optional().nullable(),
    customerId: z.number().optional().nullable(),
    paymentType: z.string().optional(),
    depositAmount: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    status: z.string().optional(),
    createdBy: z.number().optional().nullable(),
  });
export type InsertFactoryPosSale = z.infer<typeof insertFactoryPosSaleSchema>;
export type FactoryPosSale = typeof factoryPosSales.$inferSelect;

// ─── Factory POS Sale Items ───────────────────────────────────────────────────
export const factoryPosSaleItems = pgTable(
  "factory_pos_sale_items",
  {
    id: serial("id").primaryKey(),
    saleId: integer("sale_id").notNull(),
    companyId: integer("company_id").notNull(),
    productId: integer("product_id"),
    productName: text("product_name").notNull(),
    articleCode: text("article_code"),
    quantity: integer("quantity").notNull().default(1),
    unitPrice: decimal("unit_price", { precision: 20, scale: 2 }).notNull().default("0"),
    totalAmount: decimal("total_amount", { precision: 20, scale: 2 }).notNull().default("0"),
    currencyCode: varchar("currency_code", { length: 10 }).notNull().default("USD"),
  },
  (t) => ({
    companyIdx: index("factory_pos_sale_items_company_idx").on(t.companyId),
  })
);
export const insertFactoryPosSaleItemSchema = createInsertSchema(factoryPosSaleItems).omit({ id: true });
export type InsertFactoryPosSaleItem = z.infer<typeof insertFactoryPosSaleItemSchema>;
export type FactoryPosSaleItem = typeof factoryPosSaleItems.$inferSelect;

// ─── Factory Worker Categories ────────────────────────────────────────────────
export const factoryWorkerCategories = pgTable(
  "factory_worker_categories",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    workerIds: jsonb("worker_ids").notNull().default([]),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("factory_worker_categories_company_idx").on(t.companyId),
  })
);

export const insertFactoryWorkerCategorySchema = createInsertSchema(factoryWorkerCategories)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    name: z.string().min(1),
    workerIds: z.array(z.number()).default([]),
  });
export type InsertFactoryWorkerCategory = z.infer<typeof insertFactoryWorkerCategorySchema>;
export type FactoryWorkerCategory = typeof factoryWorkerCategories.$inferSelect;

// ─── Factory Transporters ─────────────────────────────────────────────────────
export const factoryTransporters = pgTable(
  "factory_transporters",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    name: text("name").notNull(),
    phone: varchar("phone", { length: 50 }),
    notes: text("notes"),
    ledgerAccountId: integer("ledger_account_id"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    byCompany: index("factory_transporters_company_idx").on(t.companyId),
  })
);

export const insertFactoryTransporterSchema = createInsertSchema(factoryTransporters)
  .omit({
    id: true,
    createdAt: true,
    ledgerAccountId: true,
  })
  .extend({
    name: z.string().min(1, "Name is required"),
  });
export type InsertFactoryTransporter = z.infer<typeof insertFactoryTransporterSchema>;
export type FactoryTransporter = typeof factoryTransporters.$inferSelect;

// ─── Factory Transporter Transactions ────────────────────────────────────────
export const factoryTransporterTransactions = pgTable(
  "factory_transporter_transactions",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    transporterId: integer("transporter_id").notNull(),
    txType: text("tx_type").notNull(),
    amount: decimal("amount", { precision: 20, scale: 4 }).notNull(),
    txDate: date("tx_date").notNull(),
    description: text("description"),
    expenseAccountId: integer("expense_account_id"),
    cashAccountId: integer("cash_account_id").references(() => ledgerAccounts.id, { onDelete: "restrict" }),
    voucherId: integer("voucher_id").references(() => vouchers.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    byTransporter: index("factory_transporter_tx_idx").on(t.transporterId),
    byCompany: index("factory_transporter_tx_company_idx").on(t.companyId),
  })
);

export const insertFactoryTransporterTransactionSchema = createInsertSchema(factoryTransporterTransactions)
  .omit({
    id: true,
    createdAt: true,
    voucherId: true,
  })
  .extend({
    amount: z.union([z.string(), z.number()]).transform((v) => String(v)),
    txDate: z.string().min(1, "Date is required"),
    txType: z.enum(["charge", "payment"]),
  });
export type InsertFactoryTransporterTransaction = z.infer<typeof insertFactoryTransporterTransactionSchema>;
export type FactoryTransporterTransaction = typeof factoryTransporterTransactions.$inferSelect;

// ─── Location Price Groups — defined in erp.ts, imported here for reference ───
// (do not re-export; erp.ts owns this table)

// ─── Customer Order Bale Removals ─────────────────────────────────────────────
export const customerOrderBaleRemovals = pgTable("customer_order_bale_removals", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id")
    .notNull()
    .references(() => customerOrders.id, { onDelete: "cascade" }),
  baleId: integer("bale_id").notNull(),
  referenceNumber: varchar("reference_number", { length: 100 }).notNull(),
  articleCode: varchar("article_code", { length: 50 }),
  productName: text("product_name"),
  weightKg: decimal("weight_kg", { precision: 15, scale: 3 }),
  removedByUserId: varchar("removed_by_user_id"),
  removedByUsername: varchar("removed_by_username"),
  removedAt: timestamp("removed_at").notNull().defaultNow(),
});
export type CustomerOrderBaleRemoval = typeof customerOrderBaleRemovals.$inferSelect;

// ─── Factory Sheets ───────────────────────────────────────────────────────────
export const factorySheets = pgTable(
  "factory_sheets",
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
    companyIdx: index("factory_sheets_company_idx").on(t.companyId),
  })
);

export const insertFactorySheetSchema = createInsertSchema(factorySheets).omit({
  id: true,
  updatedAt: true,
});
export type FactorySheet = typeof factorySheets.$inferSelect;
export type InsertFactorySheet = z.infer<typeof insertFactorySheetSchema>;

// ─── Factory V3 Loads ─────────────────────────────────────────────────────────
export const factoryV3Loads = pgTable(
  "factory_v3_loads",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    proformaId: integer("proforma_id").notNull(),
    loadName: text("load_name").notNull(),
    expectedLoadDate: date("expected_load_date").notNull(),
    notes: text("notes"),
    status: text("status").notNull().default("expected_to_load"),
    createdBy: integer("created_by"),
    createdByName: text("created_by_name"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    startedAt: timestamp("started_at"),
    finalizedAt: timestamp("finalized_at"),
    finalizedBy: integer("finalized_by"),
    finalizedByName: text("finalized_by_name"),
    cancelledAt: timestamp("cancelled_at"),
  },
  (t) => ({
    companyIdx: index("factory_v3_loads_company_idx").on(t.companyId),
  })
);

export const insertFactoryV3LoadSchema = createInsertSchema(factoryV3Loads).omit({
  id: true,
  createdAt: true,
  startedAt: true,
  finalizedAt: true,
  cancelledAt: true,
});
export type FactoryV3Load = typeof factoryV3Loads.$inferSelect;
export type InsertFactoryV3Load = z.infer<typeof insertFactoryV3LoadSchema>;

// ─── Factory V3 Load Bales ────────────────────────────────────────────────────
export const factoryV3LoadBales = pgTable("factory_v3_load_bales", {
  id: serial("id").primaryKey(),
  loadId: integer("load_id").notNull(),
  baleId: integer("bale_id")
    .notNull()
    .references(() => factoryBales.id, { onDelete: "cascade" }),
  baleReference: varchar("bale_reference", { length: 100 }).notNull(),
  articleCode: varchar("article_code", { length: 50 }),
  productName: text("product_name"),
  weightKg: decimal("weight_kg", { precision: 15, scale: 3 }).notNull().default("0"),
  phase: text("phase").notNull().default("scanned"),
  addedBy: integer("added_by"),
  addedByName: text("added_by_name"),
  addedAt: timestamp("added_at").notNull().defaultNow(),
  removedBy: integer("removed_by"),
  removedByName: text("removed_by_name"),
  removedAt: timestamp("removed_at"),
  notes: text("notes"),
});

export const insertFactoryV3LoadBaleSchema = createInsertSchema(factoryV3LoadBales).omit({
  id: true,
  addedAt: true,
  removedAt: true,
});
export type FactoryV3LoadBale = typeof factoryV3LoadBales.$inferSelect;
export type InsertFactoryV3LoadBale = z.infer<typeof insertFactoryV3LoadBaleSchema>;

// ─── Factory Invoice Loading Sessions ────────────────────────────────────────
export const factoryInvoiceLoadingSessions = pgTable(
  "factory_invoice_loading_sessions",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    invoiceId: integer("invoice_id").notNull(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    locationId: integer("location_id").references(() => locations.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("OPEN"),
    truckNo: text("truck_no"),
    driverName: text("driver_name"),
    notes: text("notes"),
    createdBy: varchar("created_by", { length: 100 }),
    createdByName: text("created_by_name"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
    cancelledAt: timestamp("cancelled_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    invoiceIdx: index("factory_invoice_loading_sessions_invoice_idx").on(t.invoiceId),
    companyIdx: index("factory_invoice_loading_sessions_company_idx").on(t.companyId),
    statusIdx: index("factory_invoice_loading_sessions_status_idx").on(t.status),
  })
);

export const insertFactoryInvoiceLoadingSessionSchema = createInsertSchema(factoryInvoiceLoadingSessions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  startedAt: true,
});
export type InsertFactoryInvoiceLoadingSession = z.infer<typeof insertFactoryInvoiceLoadingSessionSchema>;
export type FactoryInvoiceLoadingSession = typeof factoryInvoiceLoadingSessions.$inferSelect;

// ─── Factory Invoice Loading Bales ────────────────────────────────────────────
// IMPORTANT: No unique(companyId, invoiceId, baleId) constraint here.
// Cancelled sessions keep their bale rows for audit history.
export const factoryInvoiceLoadingBales = pgTable(
  "factory_invoice_loading_bales",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    sessionId: integer("session_id").notNull(),
    invoiceId: integer("invoice_id").notNull(),
    baleId: integer("bale_id").notNull(),
    baleReference: varchar("bale_reference", { length: 100 }).notNull(),
    articleCode: varchar("article_code", { length: 50 }),
    productName: text("product_name"),
    weightKg: decimal("weight_kg", { precision: 15, scale: 3 }).notNull().default("0"),
    scannedAt: timestamp("scanned_at").notNull().defaultNow(),
    scannedBy: varchar("scanned_by", { length: 100 }),
    scannedByName: text("scanned_by_name"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("factory_invoice_loading_bales_company_idx").on(t.companyId),
    sessionIdx: index("factory_invoice_loading_bales_session_idx").on(t.sessionId),
    invoiceIdx: index("factory_invoice_loading_bales_invoice_idx").on(t.invoiceId),
    baleIdx: index("factory_invoice_loading_bales_bale_idx").on(t.baleId),
  })
);

export const insertFactoryInvoiceLoadingBaleSchema = createInsertSchema(factoryInvoiceLoadingBales).omit({
  id: true,
  scannedAt: true,
  createdAt: true,
});
export type FactoryInvoiceLoadingBale = typeof factoryInvoiceLoadingBales.$inferSelect;
export type InsertFactoryInvoiceLoadingBale = z.infer<typeof insertFactoryInvoiceLoadingBaleSchema>;

// ─── Factory Account WhatsApp Rules ──────────────────────────────────────────
export const factoryAccountWhatsappRules = pgTable(
  "factory_account_whatsapp_rules",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    ledgerAccountId: integer("ledger_account_id").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    whatsappChatId: text("whatsapp_chat_id"),
    sendOnPayment: boolean("send_on_payment").notNull().default(true),
    sendOnReceipt: boolean("send_on_receipt").notNull().default(true),
    sendOnJournal: boolean("send_on_journal").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueAccountRule: uniqueIndex("factory_account_wa_rules_unique").on(t.companyId, t.ledgerAccountId),
    accountIdx: index("factory_account_wa_rules_account_idx").on(t.ledgerAccountId),
  })
);

export const insertFactoryAccountWhatsappRuleSchema = createInsertSchema(factoryAccountWhatsappRules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type FactoryAccountWhatsappRule = typeof factoryAccountWhatsappRules.$inferSelect;
export type InsertFactoryAccountWhatsappRule = z.infer<typeof insertFactoryAccountWhatsappRuleSchema>;

// ─── Factory Production Sessions ─────────────────────────────────────────────
export const factoryProductionSessions = pgTable(
  "factory_production_sessions",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    sessionDate: varchar("session_date", { length: 10 }).notNull(),
    productionEndedAt: timestamp("production_ended_at"),
    productionEndedBy: text("production_ended_by"),
    workerMatrixWhatsappSentAt: timestamp("worker_matrix_whatsapp_sent_at"),
    workerMatrixWhatsappMessageId: text("worker_matrix_whatsapp_message_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueSession: uniqueIndex("factory_production_sessions_unique").on(t.companyId, t.sessionDate),
    companyIdx: index("factory_production_sessions_company_idx").on(t.companyId),
  })
);

export const insertFactoryProductionSessionSchema = createInsertSchema(factoryProductionSessions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type FactoryProductionSession = typeof factoryProductionSessions.$inferSelect;
export type InsertFactoryProductionSession = z.infer<typeof insertFactoryProductionSessionSchema>;

// ─── Factory Shipping Container Rows ─────────────────────────────────────────
export const factoryShippingContainerRows = pgTable(
  "factory_shipping_container_rows",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    customerOrderId: integer("customer_order_id")
      .notNull()
      .references(() => customerOrders.id, { onDelete: "restrict" }),
    orderDate: date("order_date").notNull(),
    eta: date("eta"),
    containerArrivedDate: date("container_arrived_date"),
    note: text("note"),
    ciNumber: text("ci_number"),
    isDone: boolean("is_done").notNull().default(false),
    doneAt: timestamp("done_at"),
    doneBy: text("done_by"),
    whatsappSentAt: timestamp("whatsapp_sent_at"),
    shippingInvoiceFileName: text("shipping_invoice_file_name"),
    shippingInvoiceOriginalName: text("shipping_invoice_original_name"),
    shippingInvoiceFileUrl: text("shipping_invoice_file_url"),
    shippingInvoiceFileData: text("shipping_invoice_file_data"),
    shippingInvoiceFileType: text("shipping_invoice_file_type"),
    trackingLink: text("tracking_link"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("fscr_company_idx").on(t.companyId),
    orderUnique: uniqueIndex("fscr_company_order_unique").on(t.companyId, t.customerOrderId),
  })
);

export const insertFactoryShippingContainerRowSchema = createInsertSchema(factoryShippingContainerRows)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    companyId: z.number().min(1),
    customerOrderId: z.number().min(1),
    orderDate: z.string().min(1),
    containerArrivedDate: z.string().optional().nullable(),
    note: z.string().optional().nullable(),
  });
export type InsertFactoryShippingContainerRow = z.infer<typeof insertFactoryShippingContainerRowSchema>;
export type FactoryShippingContainerRow = typeof factoryShippingContainerRows.$inferSelect;

// ─── Factory Shipping Container Documents ────────────────────────────────────
export const factoryShippingContainerDocuments = pgTable(
  "factory_shipping_container_documents",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    scrId: integer("scr_id")
      .notNull()
      .references(() => factoryShippingContainerRows.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    fileName: text("file_name").notNull(),
    originalName: text("original_name").notNull(),
    fileUrl: text("file_url").notNull(),
    fileType: text("file_type"),
    fileSize: integer("file_size"),
    fileData: text("file_data"),
    uploadedBy: text("uploaded_by"),
    uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  },
  (t) => ({
    scrIdx: index("fscd_scr_idx").on(t.scrId),
    companyIdx: index("fscd_company_idx").on(t.companyId),
  })
);

export const insertFactoryShippingContainerDocumentSchema = createInsertSchema(factoryShippingContainerDocuments)
  .omit({
    id: true,
    uploadedAt: true,
  })
  .extend({
    companyId: z.number().min(1),
    scrId: z.number().min(1),
    displayName: z.string().min(1),
    fileName: z.string().min(1),
    originalName: z.string().min(1),
    fileUrl: z.string().min(1),
    fileType: z.string().optional().nullable(),
    fileSize: z.number().optional().nullable(),
    fileData: z.string().optional().nullable(),
    uploadedBy: z.string().optional().nullable(),
  });
export type InsertFactoryShippingContainerDocument = z.infer<typeof insertFactoryShippingContainerDocumentSchema>;
export type FactoryShippingContainerDocument = typeof factoryShippingContainerDocuments.$inferSelect;

// ─── Factory Shipping Availability ───────────────────────────────────────────
export const factoryShippingAvailability = pgTable(
  "factory_shipping_availability",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    date: date("date").notNull(),
    shippingCompany: text("shipping_company").notNull(),
    availableContainers: integer("available_containers").notNull().default(0),
    note: text("note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("fsa_company_idx").on(t.companyId),
  })
);

export const insertFactoryShippingAvailabilitySchema = createInsertSchema(factoryShippingAvailability)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    companyId: z.number().min(1),
    date: z.string().min(1),
    shippingCompany: z.string().min(1),
    availableContainers: z.number().int().min(0),
    note: z.string().nullable().optional(),
  });
export type InsertFactoryShippingAvailability = z.infer<typeof insertFactoryShippingAvailabilitySchema>;
export type FactoryShippingAvailability = typeof factoryShippingAvailability.$inferSelect;

// ─── Customer Dispatch Batch Sequences ───────────────────────────────────────
export const customerDispatchBatchSequences = pgTable("customer_dispatch_batch_sequences", {
  companyId: integer("company_id").primaryKey(),
  nextNumber: integer("next_number").notNull().default(1),
});

// ─── Customer Dispatch Batches ────────────────────────────────────────────────
export const customerDispatchBatches = pgTable(
  "customer_dispatch_batches",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    proformaId: integer("proforma_id").references(() => customerProformas.id, { onDelete: "restrict" }),
    batchNumber: varchar("batch_number", { length: 50 }).notNull(),
    batchDate: date("batch_date").notNull(),
    status: text("status").notNull().default("DRAFT"),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    priceMode: text("price_mode").notNull().default("PER_BALE"),
    destination: text("destination"),
    notes: text("notes"),
    finalOrderId: integer("final_order_id"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    cancelledAt: timestamp("cancelled_at"),
  },
  (t) => ({
    companyIdx: index("cdb_company_idx").on(t.companyId),
    customerIdx: index("cdb_customer_idx").on(t.customerId),
    statusIdx: index("cdb_status_idx").on(t.status),
  })
);

export const insertCustomerDispatchBatchSchema = createInsertSchema(customerDispatchBatches)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    cancelledAt: true,
  })
  .extend({
    companyId: z.number().min(1),
    customerId: z.number().min(1),
    proformaId: z.number().optional().nullable(),
    batchDate: z.string().min(1),
    status: z.enum(["DRAFT", "LOADING", "READY_TO_INVOICE", "INVOICED", "CANCELLED"]).optional(),
    currency: z.string().optional(),
    priceMode: z.enum(["PER_BALE", "PER_KG"]).optional(),
    destination: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    createdBy: z.string().optional().nullable(),
  });
export type InsertCustomerDispatchBatch = z.infer<typeof insertCustomerDispatchBatchSchema>;
export type CustomerDispatchBatch = typeof customerDispatchBatches.$inferSelect;

// ─── Customer Dispatch Truck Rides ────────────────────────────────────────────
export const customerDispatchTruckRides = pgTable(
  "customer_dispatch_truck_rides",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    batchId: integer("batch_id")
      .notNull()
      .references(() => customerDispatchBatches.id, { onDelete: "restrict" }),
    rideNumber: integer("ride_number").notNull(),
    truckPlate: varchar("truck_plate", { length: 50 }),
    driverName: text("driver_name"),
    destination: text("destination"),
    notes: text("notes"),
    status: text("status").notNull().default("DRAFT"),
    loadedAt: timestamp("loaded_at"),
    dispatchedAt: timestamp("dispatched_at"),
    reopenedAt: timestamp("reopened_at"),
    reopenReason: text("reopen_reason"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    batchIdx: index("cdtr_batch_idx").on(t.batchId),
    companyIdx: index("cdtr_company_idx").on(t.companyId),
  })
);

export const insertCustomerDispatchTruckRideSchema = createInsertSchema(customerDispatchTruckRides)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    loadedAt: true,
    dispatchedAt: true,
    reopenedAt: true,
  })
  .extend({
    companyId: z.number().min(1),
    batchId: z.number().min(1),
    rideNumber: z.number().int().min(1),
    truckPlate: z.string().optional().nullable(),
    driverName: z.string().optional().nullable(),
    destination: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    createdBy: z.string().optional().nullable(),
  });
export type InsertCustomerDispatchTruckRide = z.infer<typeof insertCustomerDispatchTruckRideSchema>;
export type CustomerDispatchTruckRide = typeof customerDispatchTruckRides.$inferSelect;

// ─── Customer Dispatch Bale Scans ─────────────────────────────────────────────
export const customerDispatchBaleScans = pgTable(
  "customer_dispatch_bale_scans",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    batchId: integer("batch_id").notNull(),
    truckRideId: integer("truck_ride_id").notNull(),
    baleId: integer("bale_id").notNull(),
    baleReference: varchar("bale_reference", { length: 100 }).notNull(),
    articleCode: varchar("article_code", { length: 50 }),
    productName: text("product_name"),
    weightKg: decimal("weight_kg", { precision: 15, scale: 3 }).notNull().default("0"),
    priceUsed: decimal("price_used", { precision: 20, scale: 2 }).notNull().default("0"),
    amount: decimal("amount", { precision: 20, scale: 2 }).notNull().default("0"),
    scannedBy: text("scanned_by"),
    scannedAt: timestamp("scanned_at").notNull().defaultNow(),
    removedAt: timestamp("removed_at"),
    removalReason: text("removal_reason"),
  },
  (t) => ({
    batchIdx: index("cdbs_batch_idx").on(t.batchId),
    rideIdx: index("cdbs_ride_idx").on(t.truckRideId),
    baleIdx: index("cdbs_bale_idx").on(t.baleId),
  })
);

export type CustomerDispatchBaleScan = typeof customerDispatchBaleScans.$inferSelect;

// ─── Bale Recode Sessions ─────────────────────────────────────────────────────
export const baleRecodeSessions = pgTable(
  "bale_recode_sessions",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    performedBy: varchar("performed_by", { length: 255 }),
    uploadedFilename: text("uploaded_filename"),
    printFormat: text("print_format").notNull().default("A4"),
    designColor: text("design_color"),
    totalRows: integer("total_rows").notNull().default(0),
    validRows: integer("valid_rows").notNull().default(0),
    invalidRows: integer("invalid_rows").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("bale_recode_sessions_company_idx").on(t.companyId),
  })
);

export const insertBaleRecodeSessionSchema = createInsertSchema(baleRecodeSessions)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    companyId: z.number().min(1),
  });

export type InsertBaleRecodeSession = z.infer<typeof insertBaleRecodeSessionSchema>;
export type BaleRecodeSession = typeof baleRecodeSessions.$inferSelect;

// ─── Bale Recode Items ────────────────────────────────────────────────────────
export const baleRecodeItems = pgTable("bale_recode_items", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id")
    .notNull()
    .references(() => baleRecodeSessions.id, { onDelete: "cascade" }),
  oldReferenceCode: text("old_reference_code").notNull(),
  newReferenceCode: text("new_reference_code"),
  productName: text("product_name"),
  articleCode: text("article_code"),
  weightKg: text("weight_kg"),
  status: text("status").notNull().default("SUCCESS"),
  errorMessage: text("error_message"),
});

export const insertBaleRecodeItemSchema = createInsertSchema(baleRecodeItems)
  .omit({
    id: true,
  })
  .extend({
    sessionId: z.number().min(1),
    oldReferenceCode: z.string().min(1),
  });

export type InsertBaleRecodeItem = z.infer<typeof insertBaleRecodeItemSchema>;
export type BaleRecodeItem = typeof baleRecodeItems.$inferSelect;

// ─── Insurance Members ────────────────────────────────────────────────────────
export const insuranceMembers = pgTable("insurance_members", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  name: text("name").notNull(),
  nationality: text("nationality"),
  positionWorking: text("position_working"),
  insuranceNumber: text("insurance_number"),
  startDate: date("start_date").notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  dob: date("dob"),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  ledgerAccountId: integer("ledger_account_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertInsuranceMemberSchema = createInsertSchema(insuranceMembers)
  .omit({ id: true, createdAt: true, ledgerAccountId: true })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    name: z.string().min(1, "Name is required"),
    startDate: z.string().min(1, "Start date is required"),
    amount: z.string().refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) >= 0, "Amount must be a non-negative number"),
    nationality: z.string().optional().nullable(),
    positionWorking: z.string().optional().nullable(),
    insuranceNumber: z.string().optional().nullable(),
    dob: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    active: z.boolean().optional(),
  });

export type InsertInsuranceMember = z.infer<typeof insertInsuranceMemberSchema>;
export type InsuranceMember = typeof insuranceMembers.$inferSelect;
