import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  auditLog,
  bankAccounts,
  customers,
  employees,
  factorySuppliers,
  fixedAssets,
  ledgerAccounts,
  locations,
  suppliers,
  voucherEntries,
  vouchers,
} from "@shared/schema";
import type { VoucherEntryInsertFields } from "./accountingTypes";
import {
  PostingValidationError,
  type CentralPostingDependencies,
  type PostingActor,
  type PostingSourceIdentity,
} from "./centralPostingEngine";

const IDEMPOTENCY_TABLE = "accounting_posting_idempotency";
const POSTING_AUDIT_TABLE = "accounting_postings";

const TARGET_FIELDS = [
  "ledgerAccountId",
  "bankAccountId",
  "fixedAssetId",
  "supplierId",
  "employeeId",
  "customerId",
  "factorySupplierId",
] as const;

type TargetField = (typeof TARGET_FIELDS)[number];

export type PostingTargetIds = Record<TargetField, number[]>;

function positiveId(value: unknown, label: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new PostingValidationError("POSTING_TARGET_ID_INVALID", `${label} must be a positive integer`);
  }
  return id;
}

export function collectPostingTargetIds(entries: VoucherEntryInsertFields[]): PostingTargetIds {
  const grouped = Object.fromEntries(TARGET_FIELDS.map((field) => [field, []])) as PostingTargetIds;

  for (const entry of entries) {
    for (const field of TARGET_FIELDS) {
      if (entry[field] == null) continue;
      grouped[field].push(positiveId(entry[field], field));
    }
  }

  for (const field of TARGET_FIELDS) {
    grouped[field] = [...new Set(grouped[field])];
  }

  return grouped;
}

async function assertCompanyOwnedIds(input: {
  tx: any;
  companyId: number;
  ids: number[];
  table: any;
  idColumn: any;
  companyColumn: any;
  label: string;
}) {
  const { tx, companyId, ids, table, idColumn, companyColumn, label } = input;
  if (ids.length === 0) return;

  const rows = await tx
    .select({ id: idColumn })
    .from(table)
    .where(and(eq(companyColumn, companyId), inArray(idColumn, ids)));
  const found = new Set(rows.map((row: { id: number }) => Number(row.id)));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new PostingValidationError(
      "POSTING_TARGET_NOT_OWNED",
      `${label} ${missing.join(", ")} not found in company ${companyId}`
    );
  }
}

async function assertExistingIds(input: {
  tx: any;
  ids: number[];
  table: any;
  idColumn: any;
  label: string;
}) {
  const { tx, ids, table, idColumn, label } = input;
  if (ids.length === 0) return;

  const rows = await tx.select({ id: idColumn }).from(table).where(inArray(idColumn, ids));
  const found = new Set(rows.map((row: { id: number }) => Number(row.id)));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new PostingValidationError("POSTING_TARGET_NOT_FOUND", `${label} ${missing.join(", ")} not found`);
  }
}

function actorUserId(actor: PostingActor): string {
  const value = String(actor.userId ?? "system").trim();
  return value || "system";
}

function actorUsername(actor: PostingActor): string {
  const value = String(actor.username ?? "central-posting-engine").trim();
  return value || "central-posting-engine";
}

function sourceChanges(source: PostingSourceIdentity) {
  return {
    sourceType: { new: source.sourceType },
    sourceId: { new: source.sourceId },
    idempotencyKey: { new: source.idempotencyKey },
  };
}

/**
 * Database-backed dependencies for the central posting engine.
 *
 * The idempotency marker uses the existing audit_log table so Phase 2A does not
 * require a production schema migration. A transaction-scoped PostgreSQL
 * advisory lock serializes concurrent requests with the same company/key pair.
 */
export function createDatabasePostingDependencies(): CentralPostingDependencies {
  return {
    ownership: {
      async validateVoucherOwnership({ tx, companyId, voucher, entries }) {
        const targets = collectPostingTargetIds(entries);

        if (voucher.locationId != null) {
          await assertCompanyOwnedIds({
            tx,
            companyId,
            ids: [positiveId(voucher.locationId, "locationId")],
            table: locations,
            idColumn: locations.id,
            companyColumn: locations.companyId,
            label: "Location",
          });
        }

        await Promise.all([
          assertCompanyOwnedIds({
            tx,
            companyId,
            ids: targets.ledgerAccountId,
            table: ledgerAccounts,
            idColumn: ledgerAccounts.id,
            companyColumn: ledgerAccounts.companyId,
            label: "Ledger account",
          }),
          assertCompanyOwnedIds({
            tx,
            companyId,
            ids: targets.bankAccountId,
            table: bankAccounts,
            idColumn: bankAccounts.id,
            companyColumn: bankAccounts.companyId,
            label: "Bank account",
          }),
          assertCompanyOwnedIds({
            tx,
            companyId,
            ids: targets.fixedAssetId,
            table: fixedAssets,
            idColumn: fixedAssets.id,
            companyColumn: fixedAssets.companyId,
            label: "Fixed asset",
          }),
          assertCompanyOwnedIds({
            tx,
            companyId,
            ids: targets.employeeId,
            table: employees,
            idColumn: employees.id,
            companyColumn: employees.companyId,
            label: "Employee",
          }),
          assertCompanyOwnedIds({
            tx,
            companyId,
            ids: targets.customerId,
            table: customers,
            idColumn: customers.id,
            companyColumn: customers.companyId,
            label: "Customer",
          }),
          assertCompanyOwnedIds({
            tx,
            companyId,
            ids: targets.factorySupplierId,
            table: factorySuppliers,
            idColumn: factorySuppliers.id,
            companyColumn: factorySuppliers.companyId,
            label: "Factory supplier",
          }),
          // ERP suppliers are currently global in the schema. Phase 2A can verify
          // existence but cannot claim company ownership until Program 3 adds a
          // tenant mapping or company_id boundary for this table.
          assertExistingIds({
            tx,
            ids: targets.supplierId,
            table: suppliers,
            idColumn: suppliers.id,
            label: "Supplier",
          }),
        ]);
      },
    },

    idempotency: {
      async findExisting({ tx, companyId, source }) {
        const lockKey = `accounting-posting:${companyId}:${source.idempotencyKey}`;
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);

        const [marker] = await tx
          .select({ voucherId: auditLog.recordId })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.companyId, companyId),
              eq(auditLog.tableName, IDEMPOTENCY_TABLE),
              eq(auditLog.recordIdentifier, source.idempotencyKey)
            )
          )
          .orderBy(desc(auditLog.id))
          .limit(1);

        if (!marker) return null;
        const voucherId = Number(marker.voucherId);
        if (!Number.isInteger(voucherId) || voucherId <= 0) {
          throw new PostingValidationError(
            "POSTING_IDEMPOTENCY_CORRUPT",
            `Idempotency marker ${source.idempotencyKey} has no valid voucher reference`
          );
        }

        const [voucher] = await tx
          .select()
          .from(vouchers)
          .where(and(eq(vouchers.id, voucherId), eq(vouchers.companyId, companyId)))
          .limit(1);
        if (!voucher) {
          throw new PostingValidationError(
            "POSTING_IDEMPOTENCY_CORRUPT",
            `Idempotency marker ${source.idempotencyKey} references a missing voucher`
          );
        }

        const entries = await tx.select().from(voucherEntries).where(eq(voucherEntries.voucherId, voucherId));
        return { voucher, entries };
      },

      async record({ tx, companyId, voucherId, source }) {
        await tx.insert(auditLog).values({
          userId: "system",
          username: "central-posting-engine",
          companyId,
          action: "create",
          tableName: IDEMPOTENCY_TABLE,
          recordId: voucherId,
          recordIdentifier: source.idempotencyKey,
          changes: sourceChanges(source),
        });
      },
    },

    audit: {
      async recordPosting({ tx, companyId, voucherId, source, actor, debitTotal, creditTotal }) {
        await tx.insert(auditLog).values({
          userId: actorUserId(actor),
          username: actorUsername(actor),
          companyId,
          action: "create",
          tableName: POSTING_AUDIT_TABLE,
          recordId: voucherId,
          recordIdentifier: source.idempotencyKey,
          changes: {
            ...sourceChanges(source),
            debitTotal: { new: debitTotal },
            creditTotal: { new: creditTotal },
            reason: { new: actor.reason ?? null },
          },
        });
      },
    },
  };
}
