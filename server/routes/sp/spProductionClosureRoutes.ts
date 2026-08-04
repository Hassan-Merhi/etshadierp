import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { getErrorMessage } from "../../lib/httpHandlers";
import { requireSpCompany } from "./spHelpers";
import { ensureSpAccessControlStorage } from "./spAccessControl";
import { ensureSpProductionClosureStorage } from "./spProductionClosureStorage";

const REQUIRED_STABILIZATION_CHECKS = [
  "daily_sales_stock",
  "container_offload_postings",
  "supplier_statement_ledger",
  "sales_form_profit_split",
  "source_write_lock",
  "production_logs",
  "supplier_links",
  "migration_suspense",
] as const;

const CUTOVER_EVIDENCE_TYPES = [
  "database_backup",
  "final_verification",
  "delta_sync",
  "production_smoke",
  "rollback_available",
  "migration_archive",
] as const;

const ALL_EVIDENCE_TYPES = new Set<string>([...REQUIRED_STABILIZATION_CHECKS, ...CUTOVER_EVIDENCE_TYPES]);
const SP_MIGRATION_PERMISSION = "sp_migration";

function actor(req: Request): { userId: string; username: string | null; role: string } {
  return {
    userId: String((req as any).user?.id ?? req.session.userId ?? ""),
    username: String((req as any).user?.username ?? req.session.username ?? "") || null,
    role: String((req as any).user?.role ?? req.session.currentRole ?? ""),
  };
}

async function hasMigrationPermission(companyId: number, req: Request): Promise<boolean> {
  const { userId, role } = actor(req);
  const explicit = await db.execute(sql`
    SELECT enabled FROM sp_permission_grants
    WHERE company_id = ${companyId} AND user_id = ${userId} AND permission = ${SP_MIGRATION_PERMISSION}
    LIMIT 1
  `);
  const row = ((explicit as any).rows ?? [])[0];
  if (row) return row.enabled === true;
  return role === "Admin" || role === "Developer";
}

function sanitizeBody(body: unknown): unknown {
  if (!body || typeof body !== "object") return null;
  const copy = { ...(body as Record<string, unknown>) };
  for (const key of Object.keys(copy)) if (/password|secret|token/i.test(key)) copy[key] = "[REDACTED]";
  return copy;
}

async function audit(req: Request, companyId: number, action: string, statusCode: number): Promise<void> {
  const { userId, username, role } = actor(req);
  await db.execute(sql`
    INSERT INTO sp_audit_events(
      company_id, user_id, username, role, permission, action, method, path,
      entity_id, reason, confirmation, idempotency_key, status_code, request_body
    ) VALUES (
      ${companyId}, ${userId || null}, ${username}, ${role || null}, ${SP_MIGRATION_PERMISSION},
      ${action}, ${req.method}, ${req.originalUrl}, ${req.body?.cutoverId ?? null},
      ${String(req.body?.reason ?? "") || null}, ${String(req.body?.confirmation ?? "") || null},
      ${String(req.header("Idempotency-Key") ?? req.body?.idempotencyKey ?? "") || null},
      ${statusCode}, ${JSON.stringify(sanitizeBody(req.body))}::jsonb
    )
  `);
}

async function requireMigrationAccess(req: Request, res: Response, companyId: number): Promise<boolean> {
  await ensureSpAccessControlStorage();
  if (await hasMigrationPermission(companyId, req)) return true;
  await audit(req, companyId, "ACCESS_DENIED", 403);
  res.status(403).json({ code: "SP_PERMISSION_DENIED", message: "Missing Supplier Partner permission: sp_migration" });
  return false;
}

async function claimSensitiveRequest(req: Request, res: Response, companyId: number, confirmationText: string): Promise<boolean> {
  const confirmation = String(req.body?.confirmation ?? "").trim();
  const reason = String(req.body?.reason ?? "").trim();
  if (confirmation !== confirmationText) {
    res.status(400).json({ code: "SP_EXACT_CONFIRMATION_REQUIRED", message: `Type exactly: ${confirmationText}` });
    return false;
  }
  if (reason.length < 8) {
    res.status(400).json({ code: "SP_REASON_REQUIRED", message: "A meaningful reason of at least 8 characters is required." });
    return false;
  }
  const key = String(req.header("Idempotency-Key") ?? req.body?.idempotencyKey ?? "").trim();
  if (!key) {
    res.status(400).json({ code: "SP_IDEMPOTENCY_KEY_REQUIRED", message: "Idempotency-Key is required for this sensitive action." });
    return false;
  }
  const { userId } = actor(req);
  try {
    await db.execute(sql`
      INSERT INTO sp_idempotency_keys(company_id, user_id, permission, idempotency_key, method, path)
      VALUES (${companyId}, ${userId}, ${SP_MIGRATION_PERMISSION}, ${key}, ${req.method}, ${req.originalUrl})
    `);
    return true;
  } catch (error: any) {
    if (error?.code === "23505") {
      res.status(409).json({ code: "SP_DUPLICATE_REQUEST", message: "This sensitive request has already been submitted." });
      return false;
    }
    throw error;
  }
}

async function releaseSensitiveRequest(req: Request, companyId: number): Promise<void> {
  const key = String(req.header("Idempotency-Key") ?? req.body?.idempotencyKey ?? "").trim();
  const { userId } = actor(req);
  if (!key) return;
  await db.execute(sql`
    DELETE FROM sp_idempotency_keys
    WHERE company_id = ${companyId} AND user_id = ${userId}
      AND permission = ${SP_MIGRATION_PERMISSION} AND idempotency_key = ${key}
  `);
}

async function latestActiveCutover(companyId: number): Promise<any | null> {
  const result = await db.execute(sql`
    SELECT * FROM sp_migration_cutovers
    WHERE target_company_id = ${companyId} AND status = 'active'
    ORDER BY id DESC LIMIT 1
  `);
  return (result as any).rows?.[0] ?? null;
}

async function buildClosureStatus(companyId: number): Promise<any> {
  const cutover = await latestActiveCutover(companyId);
  if (!cutover) return { status: "BLOCKED", blocker: "No active Supplier Partner cutover exists.", cutover: null, checks: [] };

  const evidenceResult = await db.execute(sql`
    SELECT evidence_type, status, detail, recorded_by, recorded_at, updated_at
    FROM sp_production_evidence
    WHERE company_id = ${companyId} AND cutover_id = ${Number(cutover.id)}
    ORDER BY evidence_type
  `);
  const evidence = (evidenceResult as any).rows ?? [];
  const evidenceMap = new Map<string, any>(evidence.map((row: any) => [row.evidence_type, row]));
  const checks = REQUIRED_STABILIZATION_CHECKS.map((type) => ({
    type,
    ...(evidenceMap.get(type) ?? { status: "MISSING", detail: null, recorded_by: null, recorded_at: null }),
  }));

  const sourceWrites = await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM vouchers
    WHERE company_id = ${Number(cutover.source_company_id)}
      AND deleted_at IS NULL AND created_at > ${cutover.activated_at}
  `);
  const sourceWriteCount = Number((sourceWrites as any).rows?.[0]?.count ?? 0);

  const suspense = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM ledger_accounts la
    JOIN voucher_entries ve ON ve.ledger_account_id = la.id
    JOIN vouchers v ON v.id = ve.voucher_id
    WHERE la.company_id = ${companyId} AND v.company_id = ${companyId}
      AND v.deleted_at IS NULL
      AND (la.name ILIKE '%migration suspense%' OR la.sub_type = 'migration_suspense')
      AND ABS(COALESCE(ve.debit_amount, '0')::numeric - COALESCE(ve.credit_amount, '0')::numeric) > 0.0001
  `);
  const migrationSuspenseEntryCount = Number((suspense as any).rows?.[0]?.count ?? 0);
  const failures: any[] = checks.filter((check: any) => check.status !== "PASS");
  if (sourceWriteCount > 0) failures.push({ type: "source_write_lock_database", status: "FAIL", sourceWriteCount });
  if (migrationSuspenseEntryCount > 0) failures.push({ type: "migration_suspense_database", status: "FAIL", migrationSuspenseEntryCount });

  const completion = await db.execute(sql`
    SELECT * FROM sp_completion_records
    WHERE company_id = ${companyId} AND cutover_id = ${Number(cutover.id)} LIMIT 1
  `);
  return {
    status: failures.length === 0 ? "PASS" : "FAIL",
    cutover,
    checks,
    sourceWriteCount,
    migrationSuspenseEntryCount,
    failureCount: failures.length,
    failures,
    completionRecord: (completion as any).rows?.[0] ?? null,
  };
}

export function registerSpProductionClosureRoutes(app: Express): void {
  app.get("/api/sp/production/closure-status", async (req: Request, res: Response) => {
    let companyId = 0;
    try {
      companyId = Number(await requireSpCompany(req as any, res as any));
      if (!companyId || !(await requireMigrationAccess(req, res, companyId))) return;
      res.json(await buildClosureStatus(companyId));
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.post("/api/sp/production/evidence", async (req: Request, res: Response) => {
    let companyId = 0;
    let claimed = false;
    try {
      companyId = Number(await requireSpCompany(req as any, res as any));
      if (!companyId || !(await requireMigrationAccess(req, res, companyId))) return;
      claimed = await claimSensitiveRequest(req, res, companyId, "RECORD SP PRODUCTION EVIDENCE");
      if (!claimed) return;
      const cutover = await latestActiveCutover(companyId);
      if (!cutover) {
        await releaseSensitiveRequest(req, companyId);
        return res.status(409).json({ message: "No active Supplier Partner cutover exists." });
      }
      const evidenceType = String(req.body?.evidenceType ?? "").trim();
      const status = String(req.body?.status ?? "").toUpperCase();
      if (!ALL_EVIDENCE_TYPES.has(evidenceType)) {
        await releaseSensitiveRequest(req, companyId);
        return res.status(400).json({ message: "Unknown production evidence type." });
      }
      if (!["PASS", "FAIL", "RECORDED"].includes(status)) {
        await releaseSensitiveRequest(req, companyId);
        return res.status(400).json({ message: "status must be PASS, FAIL, or RECORDED." });
      }
      const { username } = actor(req);
      const result = await db.execute(sql`
        INSERT INTO sp_production_evidence(company_id, cutover_id, evidence_type, status, detail, recorded_by)
        VALUES (${companyId}, ${Number(cutover.id)}, ${evidenceType}, ${status}, ${JSON.stringify(req.body?.detail ?? {})}::jsonb, ${username})
        ON CONFLICT (company_id, cutover_id, evidence_type)
        DO UPDATE SET status = EXCLUDED.status, detail = EXCLUDED.detail,
          recorded_by = EXCLUDED.recorded_by, recorded_at = now(), updated_at = now()
        RETURNING *
      `);
      await audit(req, companyId, "PRODUCTION_EVIDENCE_RECORDED", 200);
      res.json({ success: true, evidence: (result as any).rows?.[0] });
    } catch (error: unknown) {
      if (companyId && claimed) await releaseSensitiveRequest(req, companyId).catch(() => undefined);
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.post("/api/sp/production/close-rollback-window", async (req: Request, res: Response) => {
    let companyId = 0;
    let claimed = false;
    try {
      companyId = Number(await requireSpCompany(req as any, res as any));
      if (!companyId || !(await requireMigrationAccess(req, res, companyId))) return;
      claimed = await claimSensitiveRequest(req, res, companyId, "CLOSE SP ROLLBACK WINDOW");
      if (!claimed) return;
      const status = await buildClosureStatus(companyId);
      if (status.status !== "PASS") {
        await releaseSensitiveRequest(req, companyId);
        return res.status(409).json({ message: "Stabilization checks are not all PASS.", status });
      }
      const cutoverId = Number(status.cutover.id);
      const reason = String(req.body.reason).trim();
      const { username } = actor(req);
      const completion = await db.transaction(async (tx) => {
        const updated = await tx.execute(sql`
          UPDATE sp_migration_cutovers
          SET status = 'completed', rollback_deadline = now(), updated_at = now()
          WHERE id = ${cutoverId} AND target_company_id = ${companyId} AND status = 'active'
          RETURNING id
        `);
        if (((updated as any).rows ?? []).length !== 1) throw new Error("Cutover is no longer active.");
        const inserted = await tx.execute(sql`
          INSERT INTO sp_completion_records(company_id, cutover_id, completion_snapshot, reason, approved_by)
          VALUES (${companyId}, ${cutoverId}, ${JSON.stringify(status)}::jsonb, ${reason}, ${username})
          ON CONFLICT (company_id, cutover_id) DO NOTHING RETURNING *
        `);
        const row = (inserted as any).rows?.[0];
        if (!row) throw new Error("Supplier Partner cutover completion was already recorded.");
        return row;
      });
      await audit(req, companyId, "ROLLBACK_WINDOW_CLOSED", 200);
      res.json({ success: true, message: "Supplier Partner stabilization is closed and the rollback window is no longer available.", completion });
    } catch (error: unknown) {
      if (companyId && claimed) await releaseSensitiveRequest(req, companyId).catch(() => undefined);
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
