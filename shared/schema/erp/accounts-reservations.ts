import { pgTable, varchar, serial, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { locations } from "../common";

export const agentAccounts = pgTable(
  "agent_accounts",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    accountId: varchar("account_id", { length: 50 }).notNull(),
    accountType: varchar("account_type", { length: 50 }).notNull(),
    accountName: varchar("account_name", { length: 300 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("agent_accounts_company_account_unique").on(t.companyId, t.accountId),
  })
);

export const insertAgentAccountSchema = createInsertSchema(agentAccounts).omit({ id: true, createdAt: true });
export type InsertAgentAccount = z.infer<typeof insertAgentAccountSchema>;
export type AgentAccount = typeof agentAccounts.$inferSelect;

export const freightAccounts = pgTable(
  "freight_accounts",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    accountId: varchar("account_id", { length: 50 }).notNull(),
    accountType: varchar("account_type", { length: 50 }).notNull(),
    accountName: varchar("account_name", { length: 300 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("freight_accounts_company_account_unique").on(t.companyId, t.accountId),
  })
);

export const insertFreightAccountSchema = createInsertSchema(freightAccounts).omit({ id: true, createdAt: true });
export type InsertFreightAccount = z.infer<typeof insertFreightAccountSchema>;
export type FreightAccount = typeof freightAccounts.$inferSelect;

export const snapshotPinnedAccounts = pgTable(
  "snapshot_pinned_accounts",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    cardKey: varchar("card_key", { length: 50 }).notNull(),
    accountId: varchar("account_id", { length: 50 }).notNull(),
    accountType: varchar("account_type", { length: 50 }).notNull(),
    accountName: varchar("account_name", { length: 300 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("snapshot_pinned_accounts_unique").on(t.companyId, t.cardKey, t.accountId),
  })
);

export const insertSnapshotPinnedAccountSchema = createInsertSchema(snapshotPinnedAccounts).omit({
  id: true,
  createdAt: true,
});
export type InsertSnapshotPinnedAccount = z.infer<typeof insertSnapshotPinnedAccountSchema>;
export type SnapshotPinnedAccount = typeof snapshotPinnedAccounts.$inferSelect;

export const proformaStockReservations = pgTable(
  "proforma_stock_reservations",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    proformaId: integer("proforma_id").notNull(),
    articleCode: varchar("article_code", { length: 50 }).notNull(),
    reservedQty: integer("reserved_qty").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("proforma_stock_reservations_unique").on(t.companyId, t.proformaId, t.articleCode),
  })
);

export const insertProformaStockReservationSchema = createInsertSchema(proformaStockReservations).omit({
  id: true,
  createdAt: true,
});
export type InsertProformaStockReservation = z.infer<typeof insertProformaStockReservationSchema>;
export type ProformaStockReservation = typeof proformaStockReservations.$inferSelect;

export const locationPriceGroups = pgTable(
  "location_price_groups",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    masterLocationId: integer("master_location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    followerLocationId: integer("follower_location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("location_price_groups_company_idx").on(t.companyId),
  })
);

export const insertLocationPriceGroupSchema = createInsertSchema(locationPriceGroups).omit({
  id: true,
  createdAt: true,
});
export type LocationPriceGroup = typeof locationPriceGroups.$inferSelect;
export type InsertLocationPriceGroup = z.infer<typeof insertLocationPriceGroupSchema>;
