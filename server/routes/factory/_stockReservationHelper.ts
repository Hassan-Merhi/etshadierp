import { sql, and, eq } from "drizzle-orm";
import { db } from "../../db";
import { customerProformas, customerProformaLines, proformaStockReservations, companies } from "@shared/schema";

type DbOrTx = typeof db;

/**
 * syncProformaReservations — backend single source of truth for stock reservation state.
 *
 * Computes and persists:
 *   reservedQty = max(0, proformaLineQty − alreadyLoadedInActiveOrders)
 *
 * One quantity lives in exactly one bucket:
 *   inLoading           → bale physically scanned into a LOADING / PENDING_VERIFICATION order
 *   reservedNotYetLoaded → proforma commitment still owed (stored here as reservedQty)
 *
 * Rules:
 *   - If proforma is inactive or deleted → clear all its reservations (reservation released).
 *   - If a line was removed → delete its reservation row.
 *   - reservedQty is never negative.
 *
 * Call after EVERY mutation that touches proformas, lines, or loadings.
 */
export async function syncProformaReservations(tx: DbOrTx, companyId: number, proformaId: number): Promise<void> {
  // 1. Check proforma existence and active status
  const [proforma] = await tx
    .select({ isActive: customerProformas.isActive })
    .from(customerProformas)
    .where(and(eq(customerProformas.id, proformaId), eq(customerProformas.companyId, companyId)));

  // If proforma is gone or inactive → release all reservations
  if (!proforma || !proforma.isActive) {
    await tx
      .delete(proformaStockReservations)
      .where(
        and(eq(proformaStockReservations.companyId, companyId), eq(proformaStockReservations.proformaId, proformaId))
      );
    return;
  }

  // 2. Fetch all lines for this proforma
  const lines = await tx
    .select({ articleCode: customerProformaLines.articleCode, quantity: customerProformaLines.quantity })
    .from(customerProformaLines)
    .where(eq(customerProformaLines.proformaId, proformaId));

  // No lines → clear reservations
  if (lines.length === 0) {
    await tx
      .delete(proformaStockReservations)
      .where(
        and(eq(proformaStockReservations.companyId, companyId), eq(proformaStockReservations.proformaId, proformaId))
      );
    return;
  }

  // 3. Count bales already loaded into ACTIVE orders for this proforma
  //    (status LOADING or PENDING_VERIFICATION — not yet shipped/finalized)
  const loadedRaw = await tx.execute(
    sql`SELECT fb.article_code AS "articleCode", COUNT(*)::int AS loaded
        FROM customer_order_bales cob
        JOIN factory_bales fb   ON fb.id  = cob.bale_id
        JOIN customer_orders co ON co.id  = cob.order_id
        WHERE co.company_id        = ${companyId}
          AND co.proforma_id_used  = ${proformaId}
          AND co.status IN ('LOADING', 'PENDING_VERIFICATION')
        GROUP BY fb.article_code`
  );
  const loadedMap = new Map<string, number>(
    ((loadedRaw as any).rows ?? (loadedRaw as unknown as any[])).map((r: any) => [
      r.articleCode as string,
      Number(r.loaded),
    ])
  );

  // 4. Upsert reservations for every current line
  const currentCodes = new Set<string>();
  for (const line of lines) {
    if (!line.articleCode) continue;
    currentCodes.add(line.articleCode);
    const loaded = loadedMap.get(line.articleCode) ?? 0;
    const reservedQty = Math.max(0, Number(line.quantity) - loaded);

    await tx.execute(
      sql`INSERT INTO proforma_stock_reservations
            (company_id, proforma_id, article_code, reserved_qty)
          VALUES
            (${companyId}, ${proformaId}, ${line.articleCode}, ${reservedQty})
          ON CONFLICT (company_id, proforma_id, article_code)
          DO UPDATE SET reserved_qty = ${reservedQty}`
    );
  }

  // 5. Delete stale rows for article codes that no longer have a line
  // NOTE: <> ALL(array) fails when Drizzle expands JS arrays to individual
  // positional params.  Use NOT IN with sql.join so each code becomes its own
  // bound parameter in a valid IN-list.
  if (currentCodes.size > 0) {
    const codeArr = Array.from(currentCodes);
    const notInList = sql.join(
      codeArr.map((c) => sql`${c}`),
      sql`, `
    );
    await tx.execute(
      sql`DELETE FROM proforma_stock_reservations
          WHERE company_id  = ${companyId}
            AND proforma_id = ${proformaId}
            AND article_code NOT IN (${notInList})`
    );
  }
}

/**
 * Returns whether a company uses factory-mode reservation logic.
 * Applies to both "factory" and "factory_v2" company types — v2 is now the
 * default behaviour for all factory companies.
 */
export async function isFactoryV2Company(companyId: number): Promise<boolean> {
  const [co] = await db
    .select({ companyType: companies.companyType })
    .from(companies)
    .where(eq(companies.id, companyId));
  return co?.companyType === "factory" || co?.companyType === "factory_v2";
}

/**
 * Computes the current free-to-promise quantity for a single articleCode in a company.
 * FTP = max(0, inStock − SUM(reservedQty from proforma_stock_reservations))
 * Intended for use in proforma line creation guards (factory_v2 only).
 */
export async function computeFreeToPromise(companyId: number, articleCode: string): Promise<number> {
  const [inStockRow] =
    (
      (await db.execute(
        sql`SELECT COUNT(*)::int AS count
        FROM factory_bales
        WHERE company_id = ${companyId}
          AND article_code = ${articleCode}
          AND status = 'IN_STOCK'`
      )) as any
    ).rows ?? [];
  const inStock = Number(inStockRow?.count ?? 0);

  const [reservedRow] =
    (
      (await db.execute(
        sql`SELECT COALESCE(SUM(reserved_qty),0)::int AS total
        FROM proforma_stock_reservations
        WHERE company_id = ${companyId}
          AND article_code = ${articleCode}`
      )) as any
    ).rows ?? [];
  const reservedNotYetLoaded = Number(reservedRow?.total ?? 0);

  return Math.max(0, inStock - reservedNotYetLoaded);
}
