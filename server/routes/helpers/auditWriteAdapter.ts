import { writeAuditEvent } from "../../services/audit";
import type { AuditChanges } from "../../services/audit";

/**
 * Compatibility adapter for established server-side audit call sites.
 *
 * Phases 8B and 8C intentionally preserve the existing logAudit API while
 * routing voucher, POS, inventory, transfer, adjustment, and container events
 * through the shared Phase 8A framework so sanitization, bounds,
 * normalization, and safe failure logging are applied consistently.
 */
export async function logAudit(params: {
  userId: string;
  username: string;
  companyId?: number | null;
  action: "create" | "update" | "delete";
  tableName: string;
  recordId?: number | null;
  recordIdentifier?: string | null;
  changes?: AuditChanges | null;
}): Promise<void> {
  await writeAuditEvent(params);
}
