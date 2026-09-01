import {
  pgTable,
  serial,
  integer,
  text,
  varchar,
  decimal,
  date,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { factoryWorkers, factoryPayrolls } from "./workers-payroll";
import { factoryProductionPositions } from "./production-positions";

export const factoryProductionBonusRuns = pgTable(
  "factory_production_bonus_runs",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    planId: integer("plan_id"),
    planEntryId: integer("plan_entry_id"),
    productionDate: date("production_date").notNull(),
    positionId: integer("position_id")
      .notNull()
      .references(() => factoryProductionPositions.id, { onDelete: "restrict" }),
    positionNameSnapshot: text("position_name_snapshot").notNull(),
    targetBales: integer("target_bales").notNull().default(0),
    actualBales: integer("actual_bales").notNull().default(0),
    extraBales: integer("extra_bales").notNull().default(0),
    bonusPerExtraBale: decimal("bonus_per_extra_bale", { precision: 20, scale: 4 }).notNull().default("0"),
    bonusPool: decimal("bonus_pool", { precision: 20, scale: 2 }).notNull().default("0"),
    memberCount: integer("member_count").notNull().default(0),
    status: varchar("status", { length: 20 }).notNull().default("PENDING"),
    generatedAt: timestamp("generated_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueCompanyDatePosition: uniqueIndex("factory_prod_bonus_runs_company_date_position_unique").on(
      t.companyId,
      t.productionDate,
      t.positionId
    ),
    companyDateIdx: index("factory_prod_bonus_runs_company_date_idx").on(t.companyId, t.productionDate),
    positionIdx: index("factory_prod_bonus_runs_position_idx").on(t.positionId),
  })
);

export const factoryProductionBonusAllocations = pgTable(
  "factory_production_bonus_allocations",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    runId: integer("run_id")
      .notNull()
      .references(() => factoryProductionBonusRuns.id, { onDelete: "cascade" }),
    workerId: integer("worker_id")
      .notNull()
      .references(() => factoryWorkers.id, { onDelete: "restrict" }),
    workerNameSnapshot: text("worker_name_snapshot").notNull(),
    amount: decimal("amount", { precision: 20, scale: 2 }).notNull().default("0"),
    decisionStatus: varchar("decision_status", { length: 20 }).notNull().default("PENDING"),
    payrollId: integer("payroll_id").references(() => factoryPayrolls.id, { onDelete: "set null" }),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at"),
    decisionNote: text("decision_note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueRunWorker: uniqueIndex("factory_prod_bonus_allocations_run_worker_unique").on(t.runId, t.workerId),
    companyWorkerIdx: index("factory_prod_bonus_allocations_company_worker_idx").on(t.companyId, t.workerId),
    payrollIdx: index("factory_prod_bonus_allocations_payroll_idx").on(t.payrollId),
    decisionIdx: index("factory_prod_bonus_allocations_decision_idx").on(t.companyId, t.decisionStatus),
  })
);

export type FactoryProductionBonusRun = typeof factoryProductionBonusRuns.$inferSelect;
export type FactoryProductionBonusAllocation = typeof factoryProductionBonusAllocations.$inferSelect;
