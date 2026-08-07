import {
  pgTable,
  serial,
  integer,
  varchar,
  boolean,
  timestamp,
  date,
  decimal,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { factoryWorkers } from "./workers-payroll";

// ─── Factory Production Positions ────────────────────────────────────────────
//
// Production positions are intentionally separate from factoryWorkers.position.
// A worker may belong to several production positions at the same time and the
// memberships below are effective-dated so historical production attribution is
// never rewritten when a worker changes teams later.
export const factoryProductionPositions = pgTable(
  "factory_production_positions",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    active: boolean("active").notNull().default(true),
    createdBy: varchar("created_by", { length: 100 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    companyNameUnique: uniqueIndex("factory_production_positions_company_name_unique").on(t.companyId, t.name),
    companyActiveIdx: index("factory_production_positions_company_active_idx").on(t.companyId, t.active),
  })
);

// A new rule version is inserted whenever target/rate settings change on a new
// effective date. effectiveTo is exclusive: [effectiveFrom, effectiveTo).
export const factoryProductionPositionRules = pgTable(
  "factory_production_position_rules",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    positionId: integer("position_id")
      .notNull()
      .references(() => factoryProductionPositions.id, { onDelete: "cascade" }),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    targetBales: integer("target_bales").notNull().default(0),
    bonusPerExtraBale: decimal("bonus_per_extra_bale", { precision: 20, scale: 4 }).notNull().default("0"),
    bonusEnabled: boolean("bonus_enabled").notNull().default(false),
    createdBy: varchar("created_by", { length: 100 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    positionEffectiveUnique: uniqueIndex("factory_production_position_rules_position_effective_unique").on(
      t.positionId,
      t.effectiveFrom
    ),
    companyPositionIdx: index("factory_production_position_rules_company_position_idx").on(t.companyId, t.positionId),
    effectiveIdx: index("factory_production_position_rules_effective_idx").on(t.positionId, t.effectiveFrom, t.effectiveTo),
  })
);

// Memberships are also effective-dated and intentionally many-to-many. A worker
// can therefore be valid for T SHIRTS and BLOUSE, for example, without relying
// on the legacy free-text position field.
export const factoryProductionPositionMemberships = pgTable(
  "factory_production_position_memberships",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    positionId: integer("position_id")
      .notNull()
      .references(() => factoryProductionPositions.id, { onDelete: "cascade" }),
    workerId: integer("worker_id")
      .notNull()
      .references(() => factoryWorkers.id, { onDelete: "restrict" }),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    createdBy: varchar("created_by", { length: 100 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    positionWorkerEffectiveUnique: uniqueIndex("factory_production_position_memberships_unique").on(
      t.positionId,
      t.workerId,
      t.effectiveFrom
    ),
    companyPositionIdx: index("factory_production_position_memberships_company_position_idx").on(
      t.companyId,
      t.positionId
    ),
    workerEffectiveIdx: index("factory_production_position_memberships_worker_effective_idx").on(
      t.workerId,
      t.effectiveFrom,
      t.effectiveTo
    ),
  })
);

export const insertFactoryProductionPositionSchema = createInsertSchema(factoryProductionPositions)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    companyId: z.number().int().positive(),
    name: z.string().trim().min(1).max(160),
    active: z.boolean().optional(),
    createdBy: z.string().max(100).optional().nullable(),
  });

export const insertFactoryProductionPositionRuleSchema = createInsertSchema(factoryProductionPositionRules)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    companyId: z.number().int().positive(),
    positionId: z.number().int().positive(),
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    targetBales: z.number().int().min(0),
    bonusPerExtraBale: z.string(),
    bonusEnabled: z.boolean(),
    createdBy: z.string().max(100).optional().nullable(),
  });

export const insertFactoryProductionPositionMembershipSchema = createInsertSchema(factoryProductionPositionMemberships)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    companyId: z.number().int().positive(),
    positionId: z.number().int().positive(),
    workerId: z.number().int().positive(),
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    createdBy: z.string().max(100).optional().nullable(),
  });

export type FactoryProductionPosition = typeof factoryProductionPositions.$inferSelect;
export type FactoryProductionPositionRule = typeof factoryProductionPositionRules.$inferSelect;
export type FactoryProductionPositionMembership = typeof factoryProductionPositionMemberships.$inferSelect;
