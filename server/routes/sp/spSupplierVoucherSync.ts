import { sql } from "drizzle-orm";
import { db } from "../../db";

let triggerSetupPromise: Promise<void> | null = null;

/**
 * Installs an idempotent PostgreSQL trigger that keeps the supplier on an SP
 * container's Goods-OTW voucher header synchronized with the container.
 * Supplier statements are scoped through vouchers.supplier_id, so storing the
 * supplier only on voucher_entries is not sufficient.
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

/** Backfills voucher headers already linked to SP containers. */
export async function repairSpSupplierVoucherLinks(companyId?: number): Promise<number> {
  await ensureSpSupplierVoucherSyncTrigger();

  const result = companyId
    ? await db.execute(sql`
        UPDATE vouchers v
        SET supplier_id = c.supplier_id
        FROM sp_containers c
        WHERE c.goods_otw_voucher_id = v.id
          AND c.company_id = ${companyId}
          AND v.company_id = c.company_id
          AND v.supplier_id IS DISTINCT FROM c.supplier_id
        RETURNING v.id
      `)
    : await db.execute(sql.raw(`
        UPDATE vouchers v
        SET supplier_id = c.supplier_id
        FROM sp_containers c
        WHERE c.goods_otw_voucher_id = v.id
          AND v.company_id = c.company_id
          AND v.supplier_id IS DISTINCT FROM c.supplier_id
        RETURNING v.id
      `));

  const rows = (result as any).rows ?? result;
  return Array.isArray(rows) ? rows.length : 0;
}

/** Counts SP Goods-OTW vouchers whose header supplier differs from the container. */
export async function getSpSupplierVoucherLinkGapCount(companyId: number): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM sp_containers c
    JOIN vouchers v ON v.id = c.goods_otw_voucher_id AND v.company_id = c.company_id
    WHERE c.company_id = ${companyId}
      AND v.supplier_id IS DISTINCT FROM c.supplier_id
  `);
  const row = ((result as any).rows ?? result)?.[0];
  return Number(row?.count ?? 0);
}
