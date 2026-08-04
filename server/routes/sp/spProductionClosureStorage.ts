import { sql } from "drizzle-orm";
import { db } from "../../db";

let storageReady: Promise<void> | null = null;

export function ensureSpProductionClosureStorage(): Promise<void> {
  if (!storageReady) {
    storageReady = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS sp_production_evidence (
          id bigserial PRIMARY KEY,
          company_id integer NOT NULL,
          cutover_id bigint NOT NULL,
          evidence_type varchar(80) NOT NULL,
          status varchar(16) NOT NULL CHECK (status IN ('PASS', 'FAIL', 'RECORDED')),
          detail jsonb NOT NULL DEFAULT '{}'::jsonb,
          recorded_by text,
          recorded_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (company_id, cutover_id, evidence_type)
        )
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS sp_completion_records (
          id bigserial PRIMARY KEY,
          company_id integer NOT NULL,
          cutover_id bigint NOT NULL,
          status varchar(16) NOT NULL DEFAULT 'CLOSED' CHECK (status IN ('CLOSED')),
          completion_snapshot jsonb NOT NULL,
          reason text NOT NULL,
          approved_by text,
          approved_at timestamptz NOT NULL DEFAULT now(),
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (company_id, cutover_id)
        )
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS sp_production_evidence_cutover_idx
        ON sp_production_evidence(company_id, cutover_id, evidence_type)
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS sp_completion_records_company_idx
        ON sp_completion_records(company_id, approved_at DESC)
      `);
    })().catch((error) => {
      storageReady = null;
      throw error;
    });
  }
  return storageReady;
}
