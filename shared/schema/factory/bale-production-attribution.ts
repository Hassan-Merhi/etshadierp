import { pgTable, serial, integer, text, date, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { factoryBales } from "./raw-stock-mix";
import { factoryWorkers } from "./workers-payroll";
import { factoryProductionPositions } from "./production-positions";

// One immutable-at-entry attribution row per Factory bale produced through
// Stock Entry. This keeps the worker/position snapshots next to the bale ID
// without rewriting historical attribution when a worker moves teams or a
// production position is renamed later.
export const factoryBaleProductionAttributions = pgTable(
  "factory_bale_production_attributions",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    baleId: integer("bale_id")
      .notNull()
      .references(() => factoryBales.id, { onDelete: "cascade" }),
    workerId: integer("worker_id").references(() => factoryWorkers.id, { onDelete: "restrict" }),
    workerNameSnapshot: text("worker_name_snapshot"),
    productionPositionId: integer("production_position_id").references(() => factoryProductionPositions.id, {
      onDelete: "restrict",
    }),
    productionPositionNameSnapshot: text("production_position_name_snapshot"),
    stockEntryDate: date("stock_entry_date").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    baleUnique: uniqueIndex("factory_bale_production_attributions_bale_unique").on(t.baleId),
    companyPositionDateIdx: index("factory_bale_production_attributions_company_position_date_idx").on(
      t.companyId,
      t.productionPositionId,
      t.stockEntryDate
    ),
    companyWorkerDateIdx: index("factory_bale_production_attributions_company_worker_date_idx").on(
      t.companyId,
      t.workerId,
      t.stockEntryDate
    ),
  })
);

export const insertFactoryBaleProductionAttributionSchema = createInsertSchema(factoryBaleProductionAttributions)
  .omit({ id: true, createdAt: true })
  .extend({
    companyId: z.number().int().positive(),
    baleId: z.number().int().positive(),
    workerId: z.number().int().positive().optional().nullable(),
    workerNameSnapshot: z.string().optional().nullable(),
    productionPositionId: z.number().int().positive().optional().nullable(),
    productionPositionNameSnapshot: z.string().optional().nullable(),
    stockEntryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  });

export type FactoryBaleProductionAttribution = typeof factoryBaleProductionAttributions.$inferSelect;
export type InsertFactoryBaleProductionAttribution = z.infer<typeof insertFactoryBaleProductionAttributionSchema>;
