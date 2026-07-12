import { writeAuditEvent } from "../../services/audit";
import type { AuditChanges } from "../../services/audit";

/**
 * Compatibility adapter for existing voucher and POS audit call sites.
 *
 * Phase 8B intentionally preserves the established logAudit API while routing
 * every call through the shared Phase 8A framework so sanitization, bounds,
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
