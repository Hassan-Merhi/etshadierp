import { sql } from "drizzle-orm";
import { db } from "../../db";

let triggerSetupPromise: Promise<void> | null = null;

/**
 * Installs an idempotent PostgreSQL trigger that keeps the supplier on an SP
 * container's Goods-OTW voucher header and OTW-clearing entry synchronized with
 * the container. Supplier statements are scoped through vouchers.supplier_id,
 * while some legacy surfaces still inspect voucher_entries.supplier_id.
 */
export function ensureSpSupplierVoucherSyncTrigger(): Promise<void> {
  if (!triggerSetupPromise) {
    triggerSetupPromise = (async () => {
      await db.execute(
        sql.raw(`
          CREATE OR REPLACE FUNCTION sync_sp_container_supplier_to_voucher()
          RETURNS trigger AS $sp_supplier_sync$
          BEGIN
            IF NEW.goods_otw_voucher_id IS NOT NULL THEN
              UPDATE vouchers
              SET supplier_id = NEW.supplier_id
              WHERE id = NEW.goods_otw_voucher_id
                AND company_id = NEW.company_id
                AND supplier_id IS DISTINCT FROM NEW.supplier_id;

              UPDATE voucher_entries ve
              SET supplier_id = NEW.supplier_id
              FROM ledger_accounts la
              WHERE ve.voucher_id = NEW.goods_otw_voucher_id
                AND ve.ledger_account_id = la.id
                AND la.company_id = NEW.company_id
                AND la.sub_type = 'sp_otw_clearing'
                AND ve.supplier_id IS DISTINCT FROM NEW.supplier_id;
            END IF;
            RETURN NEW;
          END;
          $sp_supplier_sync$ LANGUAGE plpgsql;
        `)
      );

      await db.execute(sql.raw(`DROP TRIGGER IF EXISTS trg_sp_container_supplier_voucher_sync ON sp_containers;`));
      await db.execute(
        sql.raw(`
          CREATE TRIGGER trg_sp_container_supplier_voucher_sync
          AFTER INSERT OR UPDATE OF supplier_id, goods_otw_voucher_id ON sp_containers
          FOR EACH ROW
          EXECUTE FUNCTION sync_sp_container_supplier_to_voucher();
        `)
      );
    })().catch((error) => {
      // Allow a later retry (for example after fresh-database startup migrations finish).
      triggerSetupPromise = null;
      throw error;
    });
  }

  return triggerSetupPromise;
}

/** Backfills voucher headers and OTW-clearing entries already linked to SP containers. */
export async function repairSpSupplierVoucherLinks(companyId?: number): Promise<number> {
  await ensureSpSupplierVoucherSyncTrigger();

  const companyFilter = companyId ? sql`AND c.company_id = ${companyId}` : sql``;
  const result = await db.execute(sql`
    WITH candidates AS (
      SELECT c.goods_otw_voucher_id AS voucher_id, c.supplier_id, c.company_id
      FROM sp_containers c
      JOIN vouchers v ON v.id = c.goods_otw_voucher_id AND v.company_id = c.company_id
      WHERE c.goods_otw_voucher_id IS NOT NULL
        ${companyFilter}
        AND (
          v.supplier_id IS DISTINCT FROM c.supplier_id
          OR EXISTS (
            SELECT 1
            FROM voucher_entries ve
            JOIN ledger_accounts la ON la.id = ve.ledger_account_id
            WHERE ve.voucher_id = v.id
              AND la.company_id = c.company_id
              AND la.sub_type = 'sp_otw_clearing'
              AND ve.supplier_id IS DISTINCT FROM c.supplier_id
          )
        )
    ),
    updated_vouchers AS (
      UPDATE vouchers v
      SET supplier_id = c.supplier_id
      FROM candidates c
      WHERE v.id = c.voucher_id
        AND v.company_id = c.company_id
      RETURNING v.id
    ),
    updated_entries AS (
      UPDATE voucher_entries ve
      SET supplier_id = c.supplier_id
      FROM candidates c, ledger_accounts la
      WHERE ve.voucher_id = c.voucher_id
        AND ve.ledger_account_id = la.id
        AND la.company_id = c.company_id
        AND la.sub_type = 'sp_otw_clearing'
      RETURNING ve.voucher_id
    )
    SELECT COUNT(*)::int AS count FROM candidates
  `);

  const row = ((result as any).rows ?? result)?.[0];
  return Number(row?.count ?? 0);
}

/** Counts SP Goods-OTW supplier links that differ from their container. */
export async function getSpSupplierVoucherLinkGapCount(companyId: number): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM sp_containers c
    JOIN vouchers v ON v.id = c.goods_otw_voucher_id AND v.company_id = c.company_id
    WHERE c.company_id = ${companyId}
      AND (
        v.supplier_id IS DISTINCT FROM c.supplier_id
        OR EXISTS (
          SELECT 1
          FROM voucher_entries ve
          JOIN ledger_accounts la ON la.id = ve.ledger_account_id
          WHERE ve.voucher_id = v.id
            AND la.company_id = c.company_id
            AND la.sub_type = 'sp_otw_clearing'
            AND ve.supplier_id IS DISTINCT FROM c.supplier_id
        )
      )
  `);
  const row = ((result as any).rows ?? result)?.[0];
  return Number(row?.count ?? 0);
}
