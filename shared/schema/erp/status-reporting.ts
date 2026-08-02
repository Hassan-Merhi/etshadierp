import {
  pgTable,
  text,
  varchar,
  serial,
  integer,
  decimal,
  timestamp,
  uniqueIndex,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

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
