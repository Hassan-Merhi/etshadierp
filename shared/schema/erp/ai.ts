import { pgTable, text, varchar, serial, integer, timestamp, uniqueIndex, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

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
