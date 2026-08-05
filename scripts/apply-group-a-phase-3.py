from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise RuntimeError(f"Could not find {label}")
    return text.replace(old, new, 1)


# Register the new startup migration last.
path = Path("server/startup-schema/index.ts")
text = path.read_text()
text = replace_once(
    text,
    'import { securityNotificationsAndPrecision } from "./010-security-notifications-and-precision";\n',
    'import { securityNotificationsAndPrecision } from "./010-security-notifications-and-precision";\n'
    'import { stockTransferRevisionIntegrity } from "./011-stock-transfer-revision-integrity";\n',
    "startup migration import",
)
text = replace_once(
    text,
    '  ...securityNotificationsAndPrecision,\n];',
    '  ...securityNotificationsAndPrecision,\n  ...stockTransferRevisionIntegrity,\n];',
    "startup migration registration",
)
path.write_text(text)

# Make the runtime schema authoritative for the new lifecycle fields and indexes.
path = Path("shared/schema/erp/stock-movements.ts")
text = path.read_text()
text = replace_once(
    text,
    'import { pgTable, text, varchar, serial, integer, decimal, boolean, timestamp } from "drizzle-orm/pg-core";',
    'import { pgTable, text, varchar, serial, integer, decimal, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";',
    "stock movement pg imports",
)
old_table = '''export const stockTransferRevisions = pgTable("stock_transfer_revisions", {
  id: serial("id").primaryKey(),
  transferId: integer("transfer_id").notNull(),
  revisionNumber: integer("revision_number").notNull(),
  note: text("note"),
  optional: boolean("optional").default(false).notNull(),
  revisionDate: timestamp("revision_date").notNull().defaultNow(),
  createdBy: varchar("created_by"),
});'''
new_table = '''export const stockTransferRevisions = pgTable(
  "stock_transfer_revisions",
  {
    id: serial("id").primaryKey(),
    transferId: integer("transfer_id").notNull(),
    revisionNumber: integer("revision_number").notNull(),
    note: text("note"),
    optional: boolean("optional").default(false).notNull(),
    revisionDate: timestamp("revision_date").notNull().defaultNow(),
    createdBy: varchar("created_by"),
    status: text("status").notNull().default("pending"),
    reviewedAt: timestamp("reviewed_at"),
    reviewedBy: varchar("reviewed_by"),
    rejectionReason: text("rejection_reason"),
    supersededByRevisionId: integer("superseded_by_revision_id"),
    payloadHash: varchar("payload_hash", { length: 64 }),
  },
  (table) => ({
    transferRevisionUnique: uniqueIndex("stock_transfer_revisions_transfer_number_unique").on(
      table.transferId,
      table.revisionNumber
    ),
    transferStatusRevisionIndex: index("stock_transfer_revisions_transfer_status_number_idx").on(
      table.transferId,
      table.status,
      table.revisionNumber
    ),
  })
);'''
text = replace_once(text, old_table, new_table, "stock transfer revision schema")
path.write_text(text)

# Register immutable routes before the old compatibility lifecycle.
path = Path("server/routes/voucherRoutes.ts")
text = path.read_text()
anchor = 'import { registerStockTransferRevisionLifecycleRoutes } from "./vouchers/stockTransferRevisionLifecycleRoutes";\n'
addition = 'import { registerImmutableStockTransferRevisionRoutes } from "./vouchers/immutableStockTransferRevisionRoutes";\n'
if addition not in text:
    text = replace_once(text, anchor, anchor + addition, "immutable route import")
text = replace_once(
    text,
    '  registerStockTransferLifecycleRoutes(app);\n  registerStockTransferRevisionLifecycleRoutes(app);',
    '  registerStockTransferLifecycleRoutes(app);\n'
    '  registerImmutableStockTransferRevisionRoutes(app);\n'
    '  registerStockTransferRevisionLifecycleRoutes(app);',
    "immutable route registration",
)
path.write_text(text)

# Expose immutable lifecycle metadata to the POS transfer detail UI.
path = Path("client/src/pages/pos/postransferorders/types.ts")
text = path.read_text()
text = replace_once(
    text,
    '''export interface Revision {
  id: number;
  revisionNumber: number;
  note?: string;
  optional: boolean;
  createdBy?: number | null;
  createdAt: string;
  items: RevisionItem[];
}''',
    '''export type RevisionStatus = "pending" | "approved" | "rejected" | "cancelled" | "superseded";

export interface Revision {
  id: number;
  revisionNumber: number;
  note?: string;
  optional: boolean;
  status: RevisionStatus;
  createdBy?: string | number | null;
  createdAt: string;
  revisionDate?: string;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  rejectionReason?: string | null;
  supersededByRevisionId?: number | null;
  sourceLocationName?: string | null;
  destinationLocationName?: string | null;
  items: RevisionItem[];
}''',
    "POS revision type",
)
path.write_text(text)

print("Group A Phase 3 current-main patches applied.")
