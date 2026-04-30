import type { Express } from "express";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import {
  customerProformas,
  customerProformaLines,
  customerOrders,
  customers,
} from "@shared/schema";
import { eq, inArray, sql, and, gte, lte } from "drizzle-orm";

// ─── Status constants ────────────────────────────────────────────────────────
// Active order statuses from schema enum:
//   DRAFT | LOADING | PENDING_VERIFICATION | VERIFIED | FINALIZED | CANCELLED
//
// expectedToLoad  — orders that represent real loading intent (excludes CANCELLED)
const ACTIVE_ORDER_STATUSES = ["DRAFT", "LOADING", "PENDING_VERIFICATION", "VERIFIED", "FINALIZED"];

// totalLoaded     — bales that have been physically committed to a container
//                   (all statuses where bales were actually scanned in)
const TOTAL_LOADED_STATUSES = ["LOADING", "PENDING_VERIFICATION", "VERIFIED", "FINALIZED"];

// V5 formula:
//   stockAvailable  = IN_STOCK bales not yet assigned to any order
//   totalLoaded     = bales scanned into any TOTAL_LOADED_STATUSES order
//   expectedToLoad  = sum per article of (line.qty × linked active order count)
//   freeToPromise   = expectedToLoad − (stockAvailable + totalLoaded)
//     > 0 → shortage (need more bales)   → red
//     ≤ 0 → sufficient                   → green

export function registerFactoryStockAllocationV5Routes(app: Express) {

  // ── GET /api/factory/v5/stock-allocation ────────────────────────────────
  app.get("/api/factory/v5/stock-allocation", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { productFilter, customerFilter, proformaFilter, containerFilter, statusFilter, fromDate, toDate, hideZero } = req.query;

      // 1. stockAvailable — IN_STOCK bales
      const inStockRaw = await db.execute(
        sql`SELECT article_code AS "articleCode", COUNT(*)::int AS count
            FROM factory_bales
            WHERE company_id = ${companyId} AND status = 'IN_STOCK'
            GROUP BY article_code`,
      );
      const inStockMap = new Map<string, number>(
        ((inStockRaw as any).rows ?? (inStockRaw as any[])).map((r: any) => [r.articleCode, Number(r.count)]),
      );

      // 2. totalLoaded — bales physically scanned into loading/verified/finalized orders
      const inLoadingRaw = await db.execute(
        sql`SELECT fb.article_code AS "articleCode", COUNT(*)::int AS count
            FROM customer_order_bales cob
            JOIN factory_bales fb   ON fb.id  = cob.bale_id
            JOIN customer_orders co ON co.id  = cob.order_id
            WHERE co.company_id = ${companyId}
              AND co.status = ANY(${sql.raw(`ARRAY['${TOTAL_LOADED_STATUSES.join("','")}']`)})
            GROUP BY fb.article_code`,
      );
      const inLoadingMap = new Map<string, number>(
        ((inLoadingRaw as any).rows ?? (inLoadingRaw as any[])).map((r: any) => [r.articleCode, Number(r.count)]),
      );

      // 3. Active proformas + lines (with optional date range filter on createdAt)
      let proformaQuery = db
        .select({
          id: customerProformas.id,
          customerId: customerProformas.customerId,
          name: customerProformas.name,
          isActive: customerProformas.isActive,
          createdAt: customerProformas.createdAt,
        })
        .from(customerProformas)
        .where(and(eq(customerProformas.companyId, companyId), eq(customerProformas.isActive, true)));

      // Apply date range filter
      if (fromDate) {
        const from = new Date(String(fromDate));
        if (!isNaN(from.getTime())) {
          proformaQuery = proformaQuery.where(gte(customerProformas.createdAt, from)) as any;
        }
      }
      if (toDate) {
        const to = new Date(String(toDate));
        if (!isNaN(to.getTime())) {
          to.setHours(23, 59, 59, 999);
          proformaQuery = proformaQuery.where(lte(customerProformas.createdAt, to)) as any;
        }
      }

      const activeProformasRaw = await proformaQuery;

      const proformaIds = activeProformasRaw.map(p => p.id);

      let allLines: { id: number; proformaId: number; articleCode: string; productName: string; quantity: number }[] = [];
      if (proformaIds.length > 0) {
        allLines = (await db
          .select({
            id: customerProformaLines.id,
            proformaId: customerProformaLines.proformaId,
            articleCode: customerProformaLines.articleCode,
            productName: customerProformaLines.productName,
            quantity: customerProformaLines.quantity,
          })
          .from(customerProformaLines)
          .where(inArray(customerProformaLines.proformaId, proformaIds))
        ).map(l => ({ ...l, quantity: Number(l.quantity) }));
      }

      // 4. Active orders per proforma (ACTIVE_ORDER_STATUSES, excludes CANCELLED)
      type OrderRow = { id: number; proformaId: number; containerNumber: string | null; status: string; customerId: number };
      let ordersByProforma: OrderRow[] = [];
      if (proformaIds.length > 0) {
        const ordersRaw = await db.execute(
          sql`SELECT id, proforma_id_used AS "proformaId", container_number AS "containerNumber",
                     status, customer_id AS "customerId"
              FROM customer_orders
              WHERE company_id = ${companyId}
                AND proforma_id_used = ANY(${sql.raw(`ARRAY[${proformaIds.join(",")}]`)})
                AND status = ANY(${sql.raw(`ARRAY['${ACTIVE_ORDER_STATUSES.join("','")}']`)})
              ORDER BY id`,
        );
        ordersByProforma = ((ordersRaw as any).rows ?? (ordersRaw as any[])).map((r: any) => ({
          id: Number(r.id),
          proformaId: Number(r.proformaId),
          containerNumber: r.containerNumber ?? null,
          status: r.status,
          customerId: Number(r.customerId),
        }));
      }

      // 5. Loaded bales per order — for expandable container detail
      //    Count bales in ALL non-cancelled statuses to reflect actual loaded progress
      type BalesByOrder = { orderId: number; articleCode: string; count: number };
      let loadedBalesByOrder: BalesByOrder[] = [];
      const allOrderIds = ordersByProforma.map(o => o.id);
      if (allOrderIds.length > 0) {
        const balesRaw = await db.execute(
          sql`SELECT cob.order_id AS "orderId", fb.article_code AS "articleCode", COUNT(*)::int AS count
              FROM customer_order_bales cob
              JOIN factory_bales fb ON fb.id = cob.bale_id
              WHERE cob.order_id = ANY(${sql.raw(`ARRAY[${allOrderIds.join(",")}]`)})
              GROUP BY cob.order_id, fb.article_code`,
        );
        loadedBalesByOrder = ((balesRaw as any).rows ?? (balesRaw as any[])).map((r: any) => ({
          orderId: Number(r.orderId),
          articleCode: r.articleCode,
          count: Number(r.count),
        }));
      }

      // 6. Customer names
      const customerIds = [...new Set([
        ...activeProformasRaw.map(p => p.customerId).filter((id): id is number => id != null),
        ...ordersByProforma.map(o => o.customerId),
      ])];
      const customerMap = new Map<number, string>();
      if (customerIds.length > 0) {
        const rows = await db
          .select({ id: customers.id, legalName: customers.legalName })
          .from(customers)
          .where(inArray(customers.id, customerIds));
        rows.forEach((c: any) => customerMap.set(c.id, c.legalName));
      }

      // 7. ALL active factory_bale_products — so users can allocate to zero-stock items
      const allProductsRaw = await db.execute(
        sql`SELECT COALESCE(article_code, code) AS "articleCode", name
            FROM factory_bale_products
            WHERE company_id = ${companyId} AND active = true
            ORDER BY name`,
      );
      const allProductsMap = new Map<string, string>(
        ((allProductsRaw as any).rows ?? (allProductsRaw as any[])).map((r: any) => [r.articleCode, r.name]),
      );

      // 8. Product names — prefer bale_products, fall back to proforma line names
      const allCodes = new Set([
        ...inStockMap.keys(),
        ...inLoadingMap.keys(),
        ...allLines.map(l => l.articleCode),
        ...allProductsMap.keys(),
      ]);
      const productNamesMap: Record<string, string> = {};
      allProductsMap.forEach((name, code) => { productNamesMap[code] = name; });
      allLines.forEach(l => { if (!productNamesMap[l.articleCode]) productNamesMap[l.articleCode] = l.productName; });

      // 9. Build per-article aggregates
      const orderCountByProforma = new Map<number, number>();
      const ordersByProformaId = new Map<number, OrderRow[]>();
      for (const o of ordersByProforma) {
        orderCountByProforma.set(o.proformaId, (orderCountByProforma.get(o.proformaId) ?? 0) + 1);
        if (!ordersByProformaId.has(o.proformaId)) ordersByProformaId.set(o.proformaId, []);
        ordersByProformaId.get(o.proformaId)!.push(o);
      }

      // expectedToLoad: only proformas with ≥1 active container order contribute
      const expectedMap = new Map<string, number>();
      for (const line of allLines) {
        const cnt = orderCountByProforma.get(line.proformaId) ?? 0;
        if (cnt === 0) continue;
        expectedMap.set(line.articleCode, (expectedMap.get(line.articleCode) ?? 0) + line.quantity * cnt);
      }

      // 10. Build rows — union of all known codes (including zero-stock active products)
      const rows = Array.from(allCodes).sort().map(articleCode => {
        const stockAvailable = inStockMap.get(articleCode) ?? 0;
        const totalLoaded    = inLoadingMap.get(articleCode) ?? 0;
        const expectedToLoad = expectedMap.get(articleCode) ?? 0;
        const freeToPromise  = expectedToLoad - (stockAvailable + totalLoaded);

        // Per-proforma/per-container expandable detail
        const proformaDetails = activeProformasRaw
          .filter(p => allLines.some(l => l.proformaId === p.id && l.articleCode === articleCode))
          .map(p => {
            const line = allLines.find(l => l.proformaId === p.id && l.articleCode === articleCode);
            const lineQty = line?.quantity ?? 0;
            const linkedOrders = ordersByProformaId.get(p.id) ?? [];
            const containers = linkedOrders.map(o => {
              const loadedBales = loadedBalesByOrder.find(
                b => b.orderId === o.id && b.articleCode === articleCode,
              )?.count ?? 0;
              return {
                orderId: o.id,
                containerName: o.containerNumber ?? `Container #${o.id}`,
                status: o.status,
                expectedQty: lineQty,
                loadedQty: loadedBales,
              };
            });
            return {
              proformaId: p.id,
              proformaName: p.name,
              customerId: p.customerId,
              customerName: customerMap.get(p.customerId!) ?? `Customer #${p.customerId}`,
              lineQty,
              containerCount: linkedOrders.length,
              totalExpected: lineQty * linkedOrders.length,
              containers,
            };
          });

        const productName = productNamesMap[articleCode] || articleCode;
        return { articleCode, productName, stockAvailable, totalLoaded, expectedToLoad, freeToPromise, proformaDetails };
      });

      // 11. Apply frontend filters
      let filtered = rows;
      if (productFilter) {
        const q = String(productFilter).toLowerCase();
        filtered = filtered.filter(r => r.articleCode.toLowerCase().includes(q) || r.productName.toLowerCase().includes(q));
      }
      if (customerFilter) {
        const q = String(customerFilter).toLowerCase();
        filtered = filtered.filter(r => r.proformaDetails.some(d => d.customerName.toLowerCase().includes(q)));
      }
      if (proformaFilter) {
        const q = String(proformaFilter).toLowerCase();
        filtered = filtered.filter(r => r.proformaDetails.some(d => d.proformaName.toLowerCase().includes(q)));
      }
      if (containerFilter) {
        const q = String(containerFilter).toLowerCase();
        filtered = filtered.filter(r => r.proformaDetails.some(d => d.containers.some(c => c.containerName.toLowerCase().includes(q))));
      }
      if (statusFilter) {
        const q = String(statusFilter).toUpperCase();
        filtered = filtered.filter(r => r.proformaDetails.some(d => d.containers.some(c => c.status === q)));
      }
      if (hideZero === "true") {
        filtered = filtered.filter(r => r.expectedToLoad > 0 || r.stockAvailable > 0 || r.totalLoaded > 0);
      }

      const totals = {
        stockAvailable: filtered.reduce((s, r) => s + r.stockAvailable, 0),
        totalLoaded:    filtered.reduce((s, r) => s + r.totalLoaded, 0),
        expectedToLoad: filtered.reduce((s, r) => s + r.expectedToLoad, 0),
        freeToPromise:  filtered.reduce((s, r) => s + r.freeToPromise, 0),
        shortageCount:  filtered.filter(r => r.freeToPromise > 0).length,
      };

      res.json({ rows: filtered, totals, productNames: productNamesMap });
    } catch (err: any) {
      console.error("[V5] stock-allocation error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ── POST /api/factory/v5/proforma-with-loading ──────────────────────────
  // Body: { customerId, name, isActive, lines[], sendToLoading, containerNames[] }
  app.post("/api/factory/v5/proforma-with-loading", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { customerId, name, isActive, lines, sendToLoading, containerNames } = req.body;

      if (!customerId || !name || !Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ message: "customerId, name, and at least one line are required" });
      }
      const validLines = lines.filter((l: any) => l.articleCode && l.productName && parseInt(l.quantity) > 0);
      if (validLines.length === 0) {
        return res.status(400).json({ message: "At least one line must have articleCode, productName, and quantity > 0" });
      }

      const names: string[] = Array.isArray(containerNames) ? containerNames.filter(Boolean) : [];

      const result = await db.transaction(async (tx: any) => {
        const [proforma] = await tx
          .insert(customerProformas)
          .values({ companyId, customerId: Number(customerId), name, isActive: isActive ?? false })
          .returning();

        const lineValues = validLines.map((l: any) => ({
          proformaId: proforma.id,
          articleCode: l.articleCode,
          productName: l.productName,
          quantity: parseInt(l.quantity),
          pricePerBale: String(l.pricePerBale ?? "0"),
          productionPricePerBale: String(l.productionPricePerBale ?? "0"),
        }));
        const insertedLines = await tx.insert(customerProformaLines).values(lineValues).returning();

        let createdOrders: any[] = [];
        if (sendToLoading && names.length > 0) {
          const today = new Date().toISOString().slice(0, 10);
          const orderValues = names.map((containerName: string) => ({
            companyId,
            customerId: Number(customerId),
            orderDate: today,
            proformaIdUsed: proforma.id,
            containerNumber: containerName,
            status: "DRAFT",
            subtotalBales: "0",
            freightAmount: "0",
            otherChargesTotal: "0",
            grandTotal: "0",
            totalQtyBales: 0,
          }));
          createdOrders = await tx.insert(customerOrders).values(orderValues).returning();
        }

        return { proforma, lines: insertedLines, orders: createdOrders };
      });

      res.json(result);
    } catch (err: any) {
      console.error("[V5] proforma-with-loading error:", err);
      res.status(400).json({ message: err.message });
    }
  });
}
