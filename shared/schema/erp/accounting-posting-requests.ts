import { index, integer, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { companies } from "../common";
import { vouchers } from "./vouchers";

/**
 * Durable idempotency identity for canonical voucher posting.
 *
 * The unique company/key pair is the database-level guarantee that one logical
 * accounting request cannot be committed as two vouchers. sourceType/sourceId
 * identify the business document behind the posting, while requestFingerprint
 * rejects accidental reuse of the same key for a changed financial payload.
 */
export const accountingPostingRequests = pgTable(
  "accounting_posting_requests",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    idempotencyKey: text("idempotency_key").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
    voucherId: integer("voucher_id")
      .notNull()
      .references(() => vouchers.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyKeyUnique: uniqueIndex("accounting_posting_requests_company_key_unique").on(
      table.companyId,
      table.idempotencyKey
    ),
    companySourceIdx: index("accounting_posting_requests_company_source_idx").on(
      table.companyId,
      table.sourceType,
      table.sourceId
    ),
    voucherIdx: index("accounting_posting_requests_voucher_idx").on(table.voucherId),
  })
);

export type AccountingPostingRequest = typeof accountingPostingRequests.$inferSelect;
