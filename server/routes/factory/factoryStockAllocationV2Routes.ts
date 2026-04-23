import type { Express } from "express";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import {
  customerProformas,
  customerProformaLines,
  customers,
} from "@shared/schema";
import { eq, inArray, sql } from "drizzle-orm";

// ─── Backend stock-truth helper ───────────────────────────────────────────────
// Phases 1–4: compute per-article inventory state entirely on the backend.
// The frontend must NEVER recompute availability from visible columns.
//
// State model:
//   IN_STOCK             = free bales, not committed to any order
//   RESERVED_FOR_ORDER   = bales physically in an active loading order
//   (SHIPPED / others)   = finalized — out of the pool
//
// Derived values:
//   onHand               = IN_STOCK + RESERVED_FOR_ORDER  (physical pool)
//   inLoading            = bales in LOADING / PENDING_VERIFICATION orders
//   proformaReserved     = sum of all ACTIVE proforma lines (backend truth)
//   reservedNotYetLoaded = max(0, proformaReserved − inLoading)
//   freeToPromise        = max(0, IN_STOCK − reservedNotYetLoaded)
//
// Loading does NOT create a second stock deduction — it transitions bales from
// the "free" pool (IN_STOCK) into the "committed" pool (RESERVED_FOR_ORDER),
// so onHand stays the same.  The final shipment is the definitive stock-out event.

async function computeStockTruth(companyId: number) {
  // Phase 1: explicit per-article counts from actual bale statuses
  const inStockRaw = await db.execute(
    sql`SELECT article_code as "articleCode", COUNT(*)::int as count
        FROM factory_bales
        WHERE company_id = ${companyId} AND status = 'IN_STOCK'
        GROUP BY article_code`
  );
  const inStockMap = new Map<string, number>(
    (inStockRaw.rows || (inStockRaw as any[])).map((r: any) => [r.articleCode, Number(r.count)])
  );

  // inLoading = bales assigned to active loading orders (status RESERVED_FOR_ORDER)
  // These are physically picked / scanned, but not yet shipped.
  const inLoadingRaw = await db.execute(
    sql`SELECT fb.article_code as "articleCode", COUNT(*)::int as count
        FROM customer_order_bales cob
        JOIN factory_bales fb ON fb.id = cob.bale_id
        JOIN customer_orders co ON co.id = cob.order_id
        WHERE co.company_id = ${companyId}
          AND co.status IN ('LOADING', 'PENDING_VERIFICATION')
        GROUP BY fb.article_code`
  );
  const inLoadingMap = new Map<string, number>(
    (inLoadingRaw.rows || (inLoadingRaw as any[])).map((r: any) => [r.articleCode, Number(r.count)])
  );

  // Phase 2: proforma reservation truth — sum of ACTIVE proforma line quantities
  // This is the backend source of truth, not a UI toggle.
  const proformaReservedRaw = await db.execute(
    sql`SELECT cpl.article_code as "articleCode", SUM(cpl.quantity)::int as "totalReserved"
        FROM customer_proforma_lines cpl
        JOIN customer_proformas cp ON cp.id = cpl.proforma_id
        WHERE cp.company_id = ${companyId} AND cp.is_active = true
        GROUP BY cpl.article_code`
  );
  const proformaReservedMap = new Map<string, number>(
    (proformaReservedRaw.rows || (proformaReservedRaw as any[])).map((r: any) => [r.articleCode, Number(r.totalReserved)])
  );

  // Union all known article codes
  const allCodes = new Set([
    ...inStockMap.keys(),
    ...inLoadingMap.keys(),
    ...proformaReservedMap.keys(),
  ]);

  return Array.from(allCodes).map(code => {
    const inStock        = inStockMap.get(code) || 0;
    const inLoading      = inLoadingMap.get(code) || 0;
    const onHand         = inStock + inLoading;
    const proformaReserved      = proformaReservedMap.get(code) || 0;
    // reserved_not_yet_loaded shrinks as loading scans bales
    const reservedNotYetLoaded  = Math.max(0, proformaReserved - inLoading);
    // freeToPromise = free bales minus what's still owed to active proformas
    const freeToPromise         = Math.max(0, inStock - reservedNotYetLoaded);
    return { code, inStock, inLoading, onHand, proformaReserved, reservedNotYetLoaded, freeToPromise };
  });
}

// ─────────────────────────────────────────────────────────────────────────────

export function registerFactoryStockAllocationV2Routes(app: Express) {

  // Phase 4: single backend endpoint returns computed stock truth per article.
  // Phase 5: frontend renders these values directly — no availability math on client.
  app.get("/api/factory/v2/stock-allocation", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const stockTruth = await computeStockTruth(companyId);

      // All proformas with lines
      const allProformas = await db
        .select({
          id: customerProformas.id,
          customerId: customerProformas.customerId,
          name: customerProformas.name,
          isActive: customerProformas.isActive,
          createdAt: customerProformas.createdAt,
        })
        .from(customerProformas)
        .where(eq(customerProformas.companyId, companyId))
        .orderBy(customerProformas.createdAt);

      const proformaIds = allProformas.map(p => p.id);
      let allLines: any[] = [];
      if (proformaIds.length > 0) {
        allLines = await db
          .select({
            id: customerProformaLines.id,
            proformaId: customerProformaLines.proformaId,
            articleCode: customerProformaLines.articleCode,
            productName: customerProformaLines.productName,
            quantity: customerProformaLines.quantity,
          })
          .from(customerProformaLines)
          .where(inArray(customerProformaLines.proformaId, proformaIds));
      }

      // Phase 3: per-proforma loaded quantities from active orders
      // This shows how much of each proforma reservation has been consumed by loading.
      const loadedByProformaRaw = await db.execute(
        sql`SELECT co.proforma_id_used as "proformaId",
                   fb.article_code as "articleCode",
                   COUNT(*)::int as loaded
            FROM customer_order_bales cob
            JOIN factory_bales fb ON fb.id = cob.bale_id
            JOIN customer_orders co ON co.id = cob.order_id
            WHERE co.company_id = ${companyId}
              AND co.status IN ('LOADING', 'PENDING_VERIFICATION')
              AND co.proforma_id_used IS NOT NULL
            GROUP BY co.proforma_id_used, fb.article_code`
      );
      type LoadedEntry = { proformaId: number; articleCode: string; loaded: number };
      const loadedByProforma: LoadedEntry[] = (loadedByProformaRaw.rows || (loadedByProformaRaw as any[])).map((r: any) => ({
        proformaId:  Number(r.proformaId),
        articleCode: r.articleCode,
        loaded:      Number(r.loaded),
      }));

      // Customer names
      const customerIds = [...new Set(allProformas.map(p => p.customerId))].filter((id): id is number => id != null);
      const customerMap = new Map<number, string>();
      if (customerIds.length > 0) {
        const rows = await db.select({ id: customers.id, legalName: customers.legalName })
          .from(customers).where(inArray(customers.id, customerIds));
        rows.forEach((c: any) => customerMap.set(c.id, c.legalName));
      }

      // Product names
      const allCodes = [...new Set([
        ...stockTruth.map(t => t.code),
        ...allLines.map(l => l.articleCode),
      ])];
      const productNamesMap: Record<string, string> = {};
      if (allCodes.length > 0) {
        const prodRaw = await db.execute(
          sql`SELECT DISTINCT ON (article_code) article_code as "articleCode", name
              FROM factory_bale_products
              WHERE company_id = ${companyId}
                AND article_code = ANY(${sql.raw(`ARRAY[${allCodes.map(c => `'${c.replace(/'/g, "''")}'`).join(',')}]`)})
              ORDER BY article_code`
        );
        (prodRaw.rows || (prodRaw as any[])).forEach((r: any) => {
          if (r.name) productNamesMap[r.articleCode] = r.name;
        });
      }

      res.json({
        // Backend-computed stock truth — one source of reality, never re-derived on frontend
        stockTruth: stockTruth.map(t => ({
          articleCode:          t.code,
          onHand:               t.onHand,
          inStock:              t.inStock,
          inLoading:            t.inLoading,
          proformaReserved:     t.proformaReserved,
          reservedNotYetLoaded: t.reservedNotYetLoaded,
          freeToPromise:        t.freeToPromise,
        })),
        proformas: allProformas.map(p => ({
          id:           p.id,
          customerId:   p.customerId,
          customerName: customerMap.get(p.customerId) || `Customer #${p.customerId}`,
          name:         p.name,
          isActive:     p.isActive,
          createdAt:    p.createdAt,
          lines: allLines
            .filter(l => l.proformaId === p.id)
            .map(l => {
              const loaded = loadedByProforma.find(lb => lb.proformaId === p.id && lb.articleCode === l.articleCode)?.loaded || 0;
              return {
                id:              l.id,
                articleCode:     l.articleCode,
                productName:     l.productName,
                quantity:        Number(l.quantity),
                alreadyLoaded:   loaded,
                remainingToLoad: Math.max(0, Number(l.quantity) - loaded),
              };
            }),
        })),
        productNames: productNamesMap,
      });
    } catch (error: any) {
      console.error("[V2] stock-allocation error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Loading-mode: same data structure as v1 but sourced cleanly from backend truth
  app.get("/api/factory/v2/stock-allocation/loading-mode", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const freeStockRaw = await db.execute(
        sql`SELECT article_code as "articleCode", COUNT(*)::int as count
            FROM factory_bales
            WHERE company_id = ${companyId} AND status = 'IN_STOCK'
            GROUP BY article_code`
      );
      const freeStockCounts: { articleCode: string; count: number }[] =
        (freeStockRaw.rows || (freeStockRaw as any[])).map((r: any) => ({
          articleCode: r.articleCode, count: Number(r.count),
        }));
      const freeStockMap = new Map(freeStockCounts.map(s => [s.articleCode, s.count]));

      const loadingsRaw = await db.execute(
        sql`SELECT id, customer_id as "customerId", container_number as "containerNumber",
                   status, proforma_id_used as "proformaIdUsed"
            FROM customer_orders
            WHERE company_id = ${companyId} AND status IN ('LOADING','PENDING_VERIFICATION')
            ORDER BY id`
      );
      const loadings: any[] = (loadingsRaw.rows || (loadingsRaw as any[])).map((r: any) => ({
        id: r.id, customerId: r.customerId, containerNumber: r.containerNumber || null,
        status: r.status, proformaIdUsed: r.proformaIdUsed || null,
      }));

      let loadingBales: { orderId: number; articleCode: string; count: number }[] = [];
      if (loadings.length > 0) {
        const ids = loadings.map(l => l.id);
        const balesRaw = await db.execute(
          sql`SELECT cob.order_id as "orderId", fb.article_code as "articleCode", COUNT(*)::int as count
              FROM customer_order_bales cob
              JOIN factory_bales fb ON fb.id = cob.bale_id
              WHERE cob.order_id = ANY(${sql.raw(`ARRAY[${ids.join(',')}]`)})
              GROUP BY cob.order_id, fb.article_code`
        );
        loadingBales = (balesRaw.rows || (balesRaw as any[])).map((r: any) => ({
          orderId: r.orderId, articleCode: r.articleCode, count: Number(r.count),
        }));
      }

      const proformaIds = [...new Set(loadings.map(l => l.proformaIdUsed))].filter((id): id is number => id != null);
      let proformaLines: { proformaId: number; articleCode: string; quantity: number }[] = [];
      if (proformaIds.length > 0) {
        const plRaw = await db.select({
          proformaId: customerProformaLines.proformaId,
          articleCode: customerProformaLines.articleCode,
          quantity: customerProformaLines.quantity,
        }).from(customerProformaLines).where(inArray(customerProformaLines.proformaId, proformaIds));
        proformaLines = plRaw.map((r: any) => ({
          proformaId: r.proformaId, articleCode: r.articleCode, quantity: Number(r.quantity),
        }));
      }

      const customerIds = [...new Set(loadings.map(l => l.customerId))].filter((id): id is number => id != null);
      const customerMap = new Map<number, string>();
      if (customerIds.length > 0) {
        const rows = await db.select({ id: customers.id, legalName: customers.legalName })
          .from(customers).where(inArray(customers.id, customerIds));
        rows.forEach((c: any) => customerMap.set(c.id, c.legalName));
      }

      const totalStockMap = new Map(freeStockMap);
      for (const b of loadingBales) {
        totalStockMap.set(b.articleCode, (totalStockMap.get(b.articleCode) || 0) + b.count);
      }

      const articleCodeSet = new Set<string>([
        ...freeStockCounts.map(s => s.articleCode),
        ...loadingBales.map(b => b.articleCode),
        ...proformaLines.map(pl => pl.articleCode),
      ]);
      const productNameByCode = new Map<string, string>();
      if (articleCodeSet.size > 0) {
        const codes = Array.from(articleCodeSet);
        const prodRaw = await db.execute(
          sql`SELECT DISTINCT ON (fbp.article_code) fbp.article_code as "articleCode", fbp.name
              FROM factory_bale_products fbp
              WHERE fbp.company_id = ${companyId}
                AND fbp.article_code = ANY(${sql.raw(`ARRAY[${codes.map(c => `'${c.replace(/'/g, "''")}'`).join(',')}]`)})
              ORDER BY fbp.article_code`
        );
        (prodRaw.rows || (prodRaw as any[])).forEach((r: any) => { if (r.name) productNameByCode.set(r.articleCode, r.name); });
      }

      res.json({
        inStockCounts: Array.from(totalStockMap.entries()).map(([articleCode, count]) => ({ articleCode, count })),
        freeStockCounts,
        loadings: loadings.map(l => ({
          id:              l.id,
          customerId:      l.customerId,
          customerName:    customerMap.get(l.customerId) || `Customer #${l.customerId}`,
          containerNumber: l.containerNumber,
          status:          l.status,
          balesByArticle:  loadingBales.filter(b => b.orderId === l.id).map(b => ({ articleCode: b.articleCode, count: b.count })),
          proformaTargets: l.proformaIdUsed
            ? proformaLines.filter(pl => pl.proformaId === l.proformaIdUsed).map(pl => ({ articleCode: pl.articleCode, quantity: pl.quantity }))
            : [],
        })),
        productNames: Object.fromEntries(productNameByCode),
      });
    } catch (error: any) {
      console.error("[V2] loading-mode error:", error);
      res.status(500).json({ message: error.message });
    }
  });
}
