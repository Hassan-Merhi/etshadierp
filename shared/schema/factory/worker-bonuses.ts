import { date, decimal, index, integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { ledgerAccounts } from "../accounting";
import { factoryWorkers } from "./workers-payroll";

/**
 * Legacy/manual factory worker bonuses.
 *
 * This table already exists in the runtime startup schema. Keeping the same
 * declaration in the Drizzle schema makes disposable CI databases complete
 * before test teardown runs, instead of relying on application boot migrations.
 */
export const workerBonuses = pgTable(
  "worker_bonuses",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    workerId: integer("worker_id")
      .notNull()
      .references(() => factoryWorkers.id),
    bonusDate: date("bonus_date").notNull(),
    amount: decimal("amount", { precision: 20, scale: 2 }).notNull(),
    notes: text("notes"),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    cashAccountId: integer("cash_account_id").references(() => ledgerAccounts.id, { onDelete: "restrict" }),
    paidDate: date("paid_date"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("worker_bonuses_company_idx").on(t.companyId),
    workerIdx: index("worker_bonuses_worker_idx").on(t.workerId),
  })
);

export type WorkerBonus = typeof workerBonuses.$inferSelect;
export type InsertWorkerBonus = typeof workerBonuses.$inferInsert;
