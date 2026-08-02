import {
  pgTable,
  text,
  varchar,
  serial,
  integer,
  decimal,
  boolean,
  timestamp,
  uniqueIndex,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

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
