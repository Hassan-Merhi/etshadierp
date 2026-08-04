import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db, pool } from "../server/db";
import { ensureSpAccessControlStorage } from "../server/routes/sp/spAccessControl";
import { ensureSpProductionClosureStorage } from "../server/routes/sp/spProductionClosureStorage";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const databaseDescribe = hasDatabase ? describe : describe.skip;

databaseDescribe("Supplier Partner production closure storage", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("creates startup-managed evidence and immutable completion tables idempotently", async () => {
    await ensureSpAccessControlStorage();
    await ensureSpProductionClosureStorage();
    await ensureSpProductionClosureStorage();

    const result = await db.execute(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('sp_production_evidence', 'sp_completion_records')
      ORDER BY table_name
    `);

    expect((result as any).rows.map((row: any) => row.table_name)).toEqual([
      "sp_completion_records",
      "sp_production_evidence",
    ]);
  });

  it("enforces company/cutover evidence idempotency and immutable completion uniqueness", async () => {
    const companyId = 900000001;
    const cutoverId = 900000001;
    await db.execute(sql`DELETE FROM sp_completion_records WHERE company_id = ${companyId}`);
    await db.execute(sql`DELETE FROM sp_production_evidence WHERE company_id = ${companyId}`);

    await db.execute(sql`
      INSERT INTO sp_production_evidence(company_id, cutover_id, evidence_type, status, detail)
      VALUES (${companyId}, ${cutoverId}, 'production_smoke', 'PASS', '{}'::jsonb)
      ON CONFLICT (company_id, cutover_id, evidence_type)
      DO UPDATE SET status = EXCLUDED.status, updated_at = now()
    `);
    await db.execute(sql`
      INSERT INTO sp_production_evidence(company_id, cutover_id, evidence_type, status, detail)
      VALUES (${companyId}, ${cutoverId}, 'production_smoke', 'FAIL', '{}'::jsonb)
      ON CONFLICT (company_id, cutover_id, evidence_type)
      DO UPDATE SET status = EXCLUDED.status, updated_at = now()
    `);

    const evidence = await db.execute(sql`
      SELECT status FROM sp_production_evidence
      WHERE company_id = ${companyId} AND cutover_id = ${cutoverId}
    `);
    expect((evidence as any).rows).toHaveLength(1);
    expect((evidence as any).rows[0].status).toBe("FAIL");

    await db.execute(sql`
      INSERT INTO sp_completion_records(company_id, cutover_id, completion_snapshot, reason)
      VALUES (${companyId}, ${cutoverId}, '{}'::jsonb, 'database test closure')
    `);
    await expect(
      db.execute(sql`
        INSERT INTO sp_completion_records(company_id, cutover_id, completion_snapshot, reason)
        VALUES (${companyId}, ${cutoverId}, '{}'::jsonb, 'duplicate closure')
      `),
    ).rejects.toMatchObject({ code: "23505" });

    await db.execute(sql`DELETE FROM sp_completion_records WHERE company_id = ${companyId}`);
    await db.execute(sql`DELETE FROM sp_production_evidence WHERE company_id = ${companyId}`);
  });
});

describe("Supplier Partner production closure route contract", () => {
  it("keeps the three controlled endpoints and Phase 7 safeguards in the implementation", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile("server/routes/sp/spProductionClosureRoutes.ts", "utf8"),
    );
    expect(source).toContain('app.get("/api/sp/production/closure-status"');
    expect(source).toContain('app.post("/api/sp/production/evidence"');
    expect(source).toContain('app.post("/api/sp/production/close-rollback-window"');
    expect(source).toContain("sp_migration");
    expect(source).toContain("Idempotency-Key");
    expect(source).toContain("CLOSE SP ROLLBACK WINDOW");
    expect(source).toContain("sp_audit_events");
    expect(source).toContain("target_company_id = ${companyId}");
  });
});
