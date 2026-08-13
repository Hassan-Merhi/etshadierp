import { and, eq, like, sql } from "drizzle-orm";
import { auditLog, voucherEntries, vouchers } from "@shared/schema";
import type { VoucherReversalLoader } from "./voucherReversal";

const POSTING_AUDIT_TABLE = "accounting_postings";

/**
 * PostgreSQL loader for exact voucher reversals. The voucher row is locked with
 * FOR UPDATE inside the caller-owned transaction so the reversal is derived
 * from one stable immutable accounting snapshot. Company scope is part of the
 * locking query rather than being checked after an unscoped read.
 */
export function createDatabaseVoucherReversalLoader(): VoucherReversalLoader {
  return {
    async loadOriginalForUpdate({ tx, companyId, voucherId }) {
      const locked = await tx.execute(sql`
        SELECT id
        FROM vouchers
        WHERE id = ${voucherId}
          AND company_id = ${companyId}
        FOR UPDATE
      `);
      const rows = Array.isArray(locked?.rows) ? locked.rows : [];
      if (rows.length === 0) return null;

      const [voucher] = await tx
        .select()
        .from(vouchers)
        .where(and(eq(vouchers.id, voucherId), eq(vouchers.companyId, companyId)))
        .limit(1);
      if (!voucher) return null;

      const entries = await tx.select().from(voucherEntries).where(eq(voucherEntries.voucherId, voucherId));

      const [reversalAudit] = await tx
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.companyId, companyId),
            eq(auditLog.tableName, POSTING_AUDIT_TABLE),
            eq(auditLog.recordId, voucherId),
            like(auditLog.recordIdentifier, "voucher-reversal:%")
          )
        )
        .limit(1);

      return {
        voucher,
        entries,
        isReversal: Boolean(reversalAudit),
      };
    },
  };
}
