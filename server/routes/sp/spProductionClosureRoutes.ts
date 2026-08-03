import type { Express } from "express";
import { sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../../auth";
import { db } from "../../db";
import { getErrorMessage } from "../../lib/httpHandlers";
import { requireSpCompany } from "./spHelpers";

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

async function ensureProductionClosureStorage(): Promise<void> {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS sp_production_evidence (
      id BIGSERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL,
      cutover_id BIGINT,
      evidence_type TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('PASS','FAIL','RECORDED')),
      detail JSONB NOT NULL DEFAULT '{}'::jsonb,
      recorded_by TEXT,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (company_id, cutover_id, evidence_type)
    )
  `));
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS sp_completion_records (
      id BIGSERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL,
      cutover_id BIGINT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('OPEN','CLOSED')) DEFAULT 'OPEN',
      completion_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      approved_by TEXT,
      approved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `));
}

function exactConfirmation(req: any, expected: string): string | null {
  if (req.body?.confirmation !== expected) return `Requires confirmation = "${expected}"`;
  const reason = String(req.body?.reason ?? "").trim();
  if (reason.length < 8) return "A meaningful reason of at least 8 characters is required.";
  return null;
}

async function latestActiveCutover(companyId: number): Promise<any | null> {
  const result = await db.execute(sql`
    SELECT *
    FROM sp_migration_cutovers
    WHERE target_company_id = ${companyId}
      AND status = 'active'
    ORDER BY id DESC
    LIMIT 1
  `);
  return (result as any).rows?.[0] ?? null;
}

async function buildClosureStatus(companyId: number): Promise<any> {
  await ensureProductionClosureStorage();
  const cutover = await latestActiveCutover(companyId);
  if (!cutover) {
    return { status: "BLOCKED", blocker: "No active Supplier Partner cutover exists.", cutover: null, checks: [] };
  }

  const evidenceResult = await db.execute(sql`
    SELECT evidence_type, status, detail, recorded_by, recorded_at
    FROM sp_production_evidence
    WHERE company_id = ${companyId} AND cutover_id = ${Number(cutover.id)}
    ORDER BY evidence_type
  `);
  const evidence = (evidenceResult as any).rows ?? [];
  const evidenceMap = new Map(evidence.map((row: any) => [row.evidence_type, row]));
  const checks = REQUIRED_STABILIZATION_CHECKS.map((type) => ({
    type,
    ...(evidenceMap.get(type) ?? { status: "MISSING", detail: null, recorded_by: null, recorded_at: null }),
  }));

  const sourceWrites = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM vouchers
    WHERE company_id = ${Number(cutover.source_company_id)}
      AND deleted_at IS NULL
      AND created_at > ${cutover.activated_at}
  `);
  const sourceWriteCount = Number((sourceWrites as any).rows?.[0]?.count ?? 0);

  const suspense = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM ledger_accounts la
    JOIN voucher_entries ve ON ve.ledger_account_id = la.id
    JOIN vouchers v ON v.id = ve.voucher_id
    WHERE la.company_id = ${companyId}
      AND v.company_id = ${companyId}
      AND v.deleted_at IS NULL
      AND (la.name ILIKE '%migration suspense%' OR la.sub_type = 'migration_suspense')
      AND ABS(COALESCE(ve.debit_amount, '0')::numeric - COALESCE(ve.credit_amount, '0')::numeric) > 0.0001
  `);
  const migrationSuspenseEntryCount = Number((suspense as any).rows?.[0]?.count ?? 0);

  const failures = checks.filter((check: any) => check.status !== "PASS");
  if (sourceWriteCount > 0) failures.push({ type: "source_write_lock_database", status: "FAIL", sourceWriteCount });
  if (migrationSuspenseEntryCount > 0) {
    failures.push({ type: "migration_suspense_database", status: "FAIL", migrationSuspenseEntryCount });
  }

  const closure = await db.execute(sql`
    SELECT * FROM sp_completion_records WHERE cutover_id = ${Number(cutover.id)} LIMIT 1
  `);

  return {
    status: failures.length === 0 ? "PASS" : "FAIL",
    cutover,
    checks,
    sourceWriteCount,
    migrationSuspenseEntryCount,
    failureCount: failures.length,
    failures,
    completionRecord: (closure as any).rows?.[0] ?? null,
  };
}

export function registerSpProductionClosureRoutes(app: Express): void {
  app.get("/api/sp/production/closure-status", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;
      res.json(await buildClosureStatus(companyId));
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.post(
    "/api/sp/production/evidence",
    requireAuth,
    requireRole("Admin"),
    async (req: any, res: any) => {
      try {
        const companyId = await requireSpCompany(req, res);
        if (!companyId) return;
        const cutover = await latestActiveCutover(companyId);
        if (!cutover) return res.status(409).json({ message: "No active Supplier Partner cutover exists." });

        const evidenceType = String(req.body?.evidenceType ?? "").trim();
        if (!REQUIRED_STABILIZATION_CHECKS.includes(evidenceType as any) &&
            !["database_backup", "final_verification", "delta_sync", "production_smoke", "rollback_available", "migration_archive"].includes(evidenceType)) {
          return res.status(400).json({ message: "Unknown production evidence type." });
        }
        const status = String(req.body?.status ?? "").toUpperCase();
        if (!['PASS', 'FAIL', 'RECORDED'].includes(status)) {
          return res.status(400).json({ message: "status must be PASS, FAIL, or RECORDED." });
        }

        await ensureProductionClosureStorage();
        const result = await db.execute(sql`
          INSERT INTO sp_production_evidence
            (company_id, cutover_id, evidence_type, status, detail, recorded_by)
          VALUES
            (${companyId}, ${Number(cutover.id)}, ${evidenceType}, ${status},
             ${JSON.stringify(req.body?.detail ?? {})}::jsonb,
             ${req.user?.username ?? req.session?.username ?? null})
          ON CONFLICT (company_id, cutover_id, evidence_type)
          DO UPDATE SET status = EXCLUDED.status,
                        detail = EXCLUDED.detail,
                        recorded_by = EXCLUDED.recorded_by,
                        recorded_at = now()
          RETURNING *
        `);
        res.json({ success: true, evidence: (result as any).rows[0] });
      } catch (error: unknown) {
        res.status(500).json({ message: getErrorMessage(error) });
      }
    }
  );

  app.post(
    "/api/sp/production/close-rollback-window",
    requireAuth,
    requireRole("Admin"),
    async (req: any, res: any) => {
      try {
        const companyId = await requireSpCompany(req, res);
        if (!companyId) return;
        const confirmationError = exactConfirmation(req, "CLOSE SP ROLLBACK WINDOW");
        if (confirmationError) return res.status(400).json({ message: confirmationError });

        const status = await buildClosureStatus(companyId);
        if (status.status !== "PASS") {
          return res.status(409).json({ message: "Stabilization checks are not all PASS.", status });
        }

        const cutoverId = Number(status.cutover.id);
        const result = await db.transaction(async (tx) => {
          await tx.execute(sql`
            UPDATE sp_migration_cutovers
            SET status = 'completed', rollback_deadline = now(), updated_at = now()
            WHERE id = ${cutoverId} AND status = 'active'
          `);
          const completion = await tx.execute(sql`
            INSERT INTO sp_completion_records
              (company_id, cutover_id, status, completion_snapshot, approved_by, approved_at)
            VALUES
              (${companyId}, ${cutoverId}, 'CLOSED', ${JSON.stringify(status)}::jsonb,
               ${req.user?.username ?? req.session?.username ?? null}, now())
            ON CONFLICT (cutover_id)
            DO UPDATE SET status = 'CLOSED',
                          completion_snapshot = EXCLUDED.completion_snapshot,
                          approved_by = EXCLUDED.approved_by,
                          approved_at = now(),
                          updated_at = now()
            RETURNING *
          `);
          return (completion as any).rows[0];
        });
        res.json({ success: true, message: "Supplier Partner stabilization is closed and the rollback window is no longer available.", completion: result });
      } catch (error: unknown) {
        res.status(500).json({ message: getErrorMessage(error) });
      }
    }
  );
}
