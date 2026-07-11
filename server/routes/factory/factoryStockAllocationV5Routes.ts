import type { Express } from "express";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { getClientDate } from "../../lib/dateUtils";
import {
  customerProformas,
  customerProformaLines,
  customerOrders,
  customerOrderExpectedLines,
  customers,
} from "@shared/schema";
import { eq, inArray, sql, and, gte, lte, isNull } from "drizzle-orm";
import { recalculateOrderTotals } from "./_helpers";
import { sqlArray } from "../../lib/sqlArray";

// ─── V5 Guard Convention ─────────────────────────────────────────────────────
// V5 orders are identified by: customer_orders.proforma_id_used IS NOT NULL
// V2/V3 orders have proforma_id_used = null and must follow legacy bale lifecycle.
// Do NOT add a dedicated isV5Order column unless proforma_id_used proves unreliable.
// Every place this guard is applied, add the comment: "// V5 guard: proformaIdUsed IS NOT NULL"
// ─────────────────────────────────────────────────────────────────────────────

// ─── Status constants ────────────────────────────────────────────────────────
// Active order statuses from schema enum:
//   DRAFT | LOADING | PENDING_VERIFICATION | VERIFIED | FINALIZED | CANCELLED
//
// NOTE: These constants will be restructured in Phase B when the formula switches
// to customer_order_expected_lines (DRAFT only) and customer_order_bales (LOADING only).
// They are kept here temporarily for reference.
//
// expectedToLoad  — orders that represent real loading intent (excludes CANCELLED)
const ACTIVE_ORDER_STATUSES = ["DRAFT", "LOADING", "PENDING_VERIFICATION", "VERIFIED", "FINALIZED"];

// totalLoaded     — bales that have been physically committed to a container
//                   (all statuses where bales were actually scanned in)
const TOTAL_LOADED_STATUSES = ["LOADING", "PENDING_VERIFICATION", "VERIFIED", "FINALIZED"];

// V5 formula (Phase B — corrected):
//   stockAvailable  = IN_STOCK bales
//   totalLoaded     = bales scanned into LOADING containers (status = 'LOADING')
//   expectedToLoad  = remaining expected for DRAFT + LOADING containers:
//                       DRAFT:   expected_qty (loaded = 0)
//                       LOADING: max(expected_qty − loaded_qty, 0)
//   freeToPromise   = stockAvailable − expectedToLoad − totalLoaded
//     < 0 → shortage (need more bales)   → red
//     = 0 → exactly covered              → neutral
//     > 0 → surplus available            → green

export function registerFactoryStockAllocationV5Routes(app: Express) {
  // ── GET /api/factory/v5/stock-allocation ────────────────────────────────
  app.get("/api/factory/v5/stock-allocation", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const {
        productFilter,
        customerFilter,
        proformaFilter,
        containerFilter,
        statusFilter,
        fromDate,
        toDate,
        hideZero,
      } = req.query;

      // 0. Build set of excluded article codes — products whose category OR name is Wiper/Garbage/Rag
      const excludedCodesRaw = await db.execute(
        sql`SELECT COALESCE(fbp.article_code, fbp.code) AS "articleCode"
            FROM factory_bale_products fbp
            LEFT JOIN factory_categories fc ON fc.id = fbp.category_id
            WHERE fbp.company_id = ${companyId}
              AND (
                LOWER(fc.name) LIKE '%wiper%'
                OR LOWER(fc.name) LIKE '%garbage%'
                OR LOWER(fc.name) LIKE '%rag%'
                OR LOWER(fbp.name) LIKE '%wiper%'
                OR LOWER(fbp.name) LIKE '%garbage%'
              )`
      );
      const excludedCodes = new Set<string>(
        ((excludedCodesRaw as any).rows ?? (excludedCodesRaw as unknown as any[]))
          .map((r: any) => r.articleCode)
          .filter(Boolean)
      );

      // 1. stockAvailable — IN_STOCK bales
      const inStockRaw = await db.execute(
        sql`SELECT article_code AS "articleCode", COUNT(*)::int AS count
            FROM factory_bales
            WHERE company_id = ${companyId} AND status = 'IN_STOCK'
            GROUP BY article_code`
      );
      const inStockMap = new Map<string, number>(
        ((inStockRaw as any).rows ?? (inStockRaw as unknown as any[])).map((r: any) => [r.articleCode, Number(r.count)])
      );

      // 2. totalLoaded — bales physically scanned into LOADING orders ONLY.
      // Phase B change: Restricted to status='LOADING' so that PENDING_VERIFICATION/VERIFIED/FINALIZED
      // orders do not double-count bales that are already SOLD (post Phase C).
      // V5 guard: proformaIdUsed IS NOT NULL — only count V5 container orders.
      const inLoadingRaw = await db.execute(
        sql`SELECT fb.article_code AS "articleCode", COUNT(*)::int AS count
            FROM customer_order_bales cob
            JOIN factory_bales fb   ON fb.id  = cob.bale_id
            JOIN customer_orders co ON co.id  = cob.order_id
            WHERE co.company_id = ${companyId}
              AND co.status = 'LOADING'
              AND co.proforma_id_used IS NOT NULL
            GROUP BY fb.article_code`
      );
      const inLoadingMap = new Map<string, number>(
        ((inLoadingRaw as any).rows ?? (inLoadingRaw as unknown as any[])).map((r: any) => [
          r.articleCode,
          Number(r.count),
        ])
      );

      // 3. Active proformas + lines (with optional date range filter on createdAt)
      const proformaConditions: any[] = [
        eq(customerProformas.companyId, companyId),
        eq(customerProformas.isActive, true),
      ];

      if (fromDate) {
        const from = new Date(String(fromDate));
        if (!isNaN(from.getTime())) {
          proformaConditions.push(gte(customerProformas.createdAt, from));
        }
      }
      if (toDate) {
        const to = new Date(String(toDate));
        if (!isNaN(to.getTime())) {
          to.setHours(23, 59, 59, 999);
          proformaConditions.push(lte(customerProformas.createdAt, to));
        }
      }

      const activeProformasRaw = await db
        .select({
          id: customerProformas.id,
          customerId: customerProformas.customerId,
          name: customerProformas.name,
          isActive: customerProformas.isActive,
          createdAt: customerProformas.createdAt,
        })
        .from(customerProformas)
        .where(and(...proformaConditions));

      const proformaIds = activeProformasRaw.map((p) => p.id);

      let allLines: { id: number; proformaId: number; articleCode: string; productName: string; quantity: number }[] =
        [];
      if (proformaIds.length > 0) {
        allLines = (
          await db
            .select({
              id: customerProformaLines.id,
              proformaId: customerProformaLines.proformaId,
              articleCode: customerProformaLines.articleCode,
              productName: customerProformaLines.productName,
              quantity: customerProformaLines.quantity,
            })
            .from(customerProformaLines)
            .where(inArray(customerProformaLines.proformaId, proformaIds))
        ).map((l) => ({ ...l, quantity: Number(l.quantity) }));
      }

      // 4. Active orders per proforma (ACTIVE_ORDER_STATUSES, excludes CANCELLED)
      type OrderRow = {
        id: number;
        proformaId: number;
        containerNumber: string | null;
        status: string;
        customerId: number;
      };
      let ordersByProforma: OrderRow[] = [];
      if (proformaIds.length > 0) {
        const ordersRaw = await db.execute(
          sql`SELECT id, proforma_id_used AS "proformaId", container_number AS "containerNumber",
                     status, customer_id AS "customerId"
              FROM customer_orders
              WHERE company_id = ${companyId}
                AND proforma_id_used = ANY(${sqlArray(proformaIds)})
                AND status = ANY(${sqlArray(ACTIVE_ORDER_STATUSES as unknown as string[])})
              ORDER BY id`
        );
        ordersByProforma = ((ordersRaw as any).rows ?? (ordersRaw as unknown as any[])).map((r: any) => ({
          id: Number(r.id),
          proformaId: Number(r.proformaId),
          containerNumber: r.containerNumber ?? null,
          status: r.status,
          customerId: Number(r.customerId),
        }));
      }

      // 5. Loaded bales per order — for expandable container detail
      type BalesByOrder = { orderId: number; articleCode: string; count: number };
      let loadedBalesByOrder: BalesByOrder[] = [];
      const allOrderIds = ordersByProforma.map((o) => o.id);
      if (allOrderIds.length > 0) {
        const balesRaw = await db.execute(
          sql`SELECT cob.order_id AS "orderId", fb.article_code AS "articleCode", COUNT(*)::int AS count
              FROM customer_order_bales cob
              JOIN factory_bales fb ON fb.id = cob.bale_id
              WHERE cob.order_id = ANY(${sqlArray(allOrderIds)})
              GROUP BY cob.order_id, fb.article_code`
        );
        loadedBalesByOrder = ((balesRaw as any).rows ?? (balesRaw as unknown as any[])).map((r: any) => ({
          orderId: Number(r.orderId),
          articleCode: r.articleCode,
          count: Number(r.count),
        }));
      }

      // 5b. Backfill: Insert expected lines for any V5 DRAFT or LOADING containers that were
      //     created before Phase B or linked via the link-proforma endpoint.
      //     Idempotent — NOT EXISTS guard prevents duplicates.
      //     V5 guard: proformaIdUsed IS NOT NULL
      //
      //     IMPORTANT: Extending to LOADING does NOT change the expectedToLoad formula.
      //     expectedToLoad still counts DRAFT orders only (see step 9 below).
      //     LOADING expected lines are for container detail/progress display only.
      if (proformaIds.length > 0) {
        try {
          await db.execute(
            // NOT EXISTS is the fast path — avoids any write when rows already exist.
            // ON CONFLICT DO NOTHING is the race-condition safety net for concurrent GETs
            // that both reach the backfill simultaneously before the first one commits.
            // Together these make the backfill fully idempotent with no duplicates.
            sql`INSERT INTO customer_order_expected_lines
                  (company_id, order_id, proforma_id, proforma_line_id, article_code, product_name, expected_qty)
                SELECT co.company_id, co.id, co.proforma_id_used, cpl.id,
                       cpl.article_code, cpl.product_name, cpl.quantity
                FROM customer_orders co
                JOIN customer_proforma_lines cpl ON cpl.proforma_id = co.proforma_id_used
                WHERE co.company_id = ${companyId}
                  AND co.status IN ('DRAFT', 'LOADING')
                  AND co.proforma_id_used IS NOT NULL
                  AND co.proforma_id_used = ANY(${sqlArray(proformaIds)})
                  AND NOT EXISTS (
                    SELECT 1 FROM customer_order_expected_lines cel
                    WHERE cel.order_id = co.id AND cel.article_code = cpl.article_code
                  )
                ON CONFLICT (order_id, article_code) DO NOTHING`
          );
        } catch (_backfillErr) {
          // Non-fatal: backfill failure must never block the GET response
        }
      }

      // 5c. Per-container expected quantities from customer_order_expected_lines.
      //     Covers all active (non-cancelled) orders so the expandable detail always shows
      //     the locked-in expected qty per container.
      //     V5 guard: proformaIdUsed IS NOT NULL (all allOrderIds are already V5 orders)
      type ExpectedLine = { orderId: number; articleCode: string; expectedQty: number };
      let allExpectedLines: ExpectedLine[] = [];
      if (allOrderIds.length > 0) {
        const expRaw = await db.execute(
          sql`SELECT order_id AS "orderId", article_code AS "articleCode",
                     expected_qty AS "expectedQty"
              FROM customer_order_expected_lines
              WHERE order_id = ANY(${sqlArray(allOrderIds)})`
        );
        allExpectedLines = ((expRaw as any).rows ?? (expRaw as unknown as any[])).map((r: any) => ({
          orderId: Number(r.orderId),
          articleCode: r.articleCode,
          expectedQty: Number(r.expectedQty),
        }));
      }

      // Key: `${orderId}__${articleCode}` → expectedQty for per-container expandable detail
      const perContainerExpectedMap = new Map<string, number>();
      allExpectedLines.forEach((el) => {
        perContainerExpectedMap.set(`${el.orderId}__${el.articleCode}`, el.expectedQty);
      });

      // 6. Customer names
      const customerIds = [
        ...new Set([
          ...activeProformasRaw.map((p) => p.customerId).filter((id): id is number => id != null),
          ...ordersByProforma.map((o) => o.customerId),
        ]),
      ];
      const customerMap = new Map<number, string>();
      if (customerIds.length > 0) {
        const rows = await db
          .select({ id: customers.id, legalName: customers.legalName })
          .from(customers)
          .where(inArray(customers.id, customerIds));
        rows.forEach((c: any) => customerMap.set(c.id, c.legalName));
      }

      // 7. ALL active factory_bale_products — so users can allocate to zero-stock items
      //    Using both code and article_code columns to build a full code→name map + weight map
      const allProductsRaw = await db.execute(
        sql`SELECT code, COALESCE(article_code, code) AS "articleCode", name,
                   weight_per_bale_kg AS "weightKg"
            FROM factory_bale_products
            WHERE company_id = ${companyId} AND active = true
            ORDER BY name`
      );
      const allProductsMap = new Map<string, string>();
      const weightMap = new Map<string, number>();
      ((allProductsRaw as any).rows ?? (allProductsRaw as unknown as any[])).forEach((r: any) => {
        if (r.name && r.articleCode) {
          // Use only the canonical articleCode (COALESCE(article_code, code)) as the map key.
          // Adding the raw `code` separately would create phantom zero-stock rows for products
          // where code != article_code (e.g. legacy codes vs HMD article codes).
          // Bales stored under the raw `code` still get names via step 9a bidirectional lookup.
          allProductsMap.set(r.articleCode, r.name);
        }
        const w = r.weightKg ? parseFloat(r.weightKg) : 0;
        if (w > 0 && r.articleCode) {
          weightMap.set(r.articleCode, w);
        }
      });

      // 8. Build allCodes union (stock bales + loading bales + proforma lines + all active products)
      const allCodes = new Set([
        ...inStockMap.keys(),
        ...inLoadingMap.keys(),
        ...allLines.map((l) => l.articleCode),
        ...allProductsMap.keys(),
      ]);

      // 9a. Bidirectional name lookup — same technique as V2 — for any code that appears in the data
      //     Matches factory_bale_products by BOTH code and article_code columns
      const productNamesMap: Record<string, string> = {};
      if (allCodes.size > 0) {
        const codeArrArr = Array.from(allCodes);
        const codeArr = sqlArray(codeArrArr);
        const prodRaw = await db.execute(
          sql`SELECT DISTINCT ON (matched_code) matched_code AS "articleCode", name FROM (
                SELECT name,
                  CASE WHEN code        = ANY(${codeArr}) THEN code
                       WHEN article_code = ANY(${codeArr}) THEN article_code
                  END AS matched_code
                FROM factory_bale_products
                WHERE company_id = ${companyId}
                  AND (code = ANY(${codeArr}) OR article_code = ANY(${codeArr}))
              ) sub
              WHERE matched_code IS NOT NULL
              ORDER BY matched_code`
        );
        ((prodRaw as any).rows ?? (prodRaw as unknown as any[])).forEach((r: any) => {
          if (r.name) productNamesMap[r.articleCode] = r.name;
        });
      }

      // 9b. Fill remaining codes from proforma line names (last resort)
      allLines.forEach((l) => {
        if (!productNamesMap[l.articleCode]) productNamesMap[l.articleCode] = l.productName;
      });

      // 9c. Final fallback — look up product_name stored on factory_bales for any codes
      //     that are still unmapped after the products-table and proforma-line lookups.
      //     This catches bales whose article_code has no matching row in factory_bale_products
      //     (e.g. legacy codes, renamed products, or manually-entered codes).
      const unmappedCodes = Array.from(allCodes).filter((c) => !productNamesMap[c]);
      if (unmappedCodes.length > 0) {
        const unmappedArr = sqlArray(unmappedCodes);
        const baleNamesRaw = await db.execute(
          sql`SELECT DISTINCT ON (article_code) article_code AS "articleCode", product_name AS "productName"
              FROM factory_bales
              WHERE company_id = ${companyId}
                AND article_code = ANY(${unmappedArr})
                AND product_name IS NOT NULL
                AND product_name != ''
              ORDER BY article_code, created_at DESC`
        );
        ((baleNamesRaw as any).rows ?? (baleNamesRaw as unknown as any[])).forEach((r: any) => {
          if (r.articleCode && r.productName && !productNamesMap[r.articleCode]) {
            productNamesMap[r.articleCode] = r.productName;
          }
        });
      }

      // 9. Build per-article aggregates
      const orderCountByProforma = new Map<number, number>();
      const ordersByProformaId = new Map<number, OrderRow[]>();
      for (const o of ordersByProforma) {
        orderCountByProforma.set(o.proformaId, (orderCountByProforma.get(o.proformaId) ?? 0) + 1);
        if (!ordersByProformaId.has(o.proformaId)) ordersByProformaId.set(o.proformaId, []);
        ordersByProformaId.get(o.proformaId)!.push(o);
      }

      // expectedToLoad: remaining expected quantity for DRAFT + LOADING containers.
      //   DRAFT:   remaining = expected_qty          (loaded = 0 by definition)
      //   LOADING: remaining = max(expected_qty − loaded_qty, 0)
      //   PENDING_VERIFICATION / VERIFIED / FINALIZED: excluded — bales already SOLD
      //   CANCELLED: excluded
      //
      // Available Balance = stockAvailable − expectedToLoad − totalLoaded
      // This prevents showing free bales that are still needed to complete active containers.
      // V5 guard: proformaIdUsed IS NOT NULL (allExpectedLines already filtered to active V5 orders)
      const activeDraftLoadingIds = new Set(
        ordersByProforma.filter((o) => o.status === "DRAFT" || o.status === "LOADING").map((o) => o.id)
      );
      const expectedMap = new Map<string, number>();
      allExpectedLines.forEach((el) => {
        if (!activeDraftLoadingIds.has(el.orderId)) return;
        const loaded =
          loadedBalesByOrder.find((b) => b.orderId === el.orderId && b.articleCode === el.articleCode)?.count ?? 0;
        const remaining = Math.max(el.expectedQty - loaded, 0);
        expectedMap.set(el.articleCode, (expectedMap.get(el.articleCode) ?? 0) + remaining);
      });

      // 10. Build rows — union of all known codes (including zero-stock active products)
      const rows = Array.from(allCodes)
        .sort()
        .map((articleCode) => {
          const stockAvailable = inStockMap.get(articleCode) ?? 0;
          const totalLoaded = inLoadingMap.get(articleCode) ?? 0;
          const expectedToLoad = expectedMap.get(articleCode) ?? 0;
          const freeToPromise = stockAvailable - expectedToLoad - totalLoaded;

          // Per-proforma/per-container expandable detail
          const proformaDetails = activeProformasRaw
            .filter((p) => allLines.some((l) => l.proformaId === p.id && l.articleCode === articleCode))
            .map((p) => {
              const line = allLines.find((l) => l.proformaId === p.id && l.articleCode === articleCode);
              const lineQty = line?.quantity ?? 0;
              const linkedOrders = ordersByProformaId.get(p.id) ?? [];
              const containers = linkedOrders.map((o) => {
                const loadedBales =
                  loadedBalesByOrder.find((b) => b.orderId === o.id && b.articleCode === articleCode)?.count ?? 0;
                // Phase B: use locked-in per-container expected qty from customer_order_expected_lines.
                // Falls back to lineQty if no expected line exists (e.g. order pre-dates Phase B backfill).
                const containerExpectedQty = perContainerExpectedMap.get(`${o.id}__${articleCode}`) ?? lineQty;
                const remainingQty = Math.max(containerExpectedQty - loadedBales, 0);
                return {
                  orderId: o.id,
                  containerName: o.containerNumber || `Order #${o.id}`,
                  status: o.status,
                  expectedQty: containerExpectedQty,
                  loadedQty: loadedBales,
                  remainingQty,
                };
              });
              // totalExpected: sum of locked-in per-container expected qty for this article
              const totalExpected = linkedOrders.reduce(
                (sum, o) => sum + (perContainerExpectedMap.get(`${o.id}__${articleCode}`) ?? lineQty),
                0
              );
              return {
                proformaId: p.id,
                proformaName: p.name,
                customerId: p.customerId,
                customerName: customerMap.get(p.customerId!) ?? `Customer #${p.customerId}`,
                lineQty,
                containerCount: linkedOrders.length,
                totalExpected,
                containers,
              };
            });

          const productName = productNamesMap[articleCode] || articleCode;
          const weightKg = weightMap.get(articleCode) ?? 0;
          const totalKg = Math.round(stockAvailable * weightKg);
          const isGarbageOrWipers = excludedCodes.has(articleCode);
          return {
            articleCode,
            productName,
            stockAvailable,
            totalLoaded,
            expectedToLoad,
            freeToPromise,
            totalKg,
            proformaDetails,
            isGarbageOrWipers,
          };
        });

      // 11. Apply frontend filters
      let filtered = rows;
      if (productFilter) {
        const q = String(productFilter).toLowerCase();
        filtered = filtered.filter(
          (r) => r.articleCode.toLowerCase().includes(q) || r.productName.toLowerCase().includes(q)
        );
      }
      if (customerFilter) {
        const q = String(customerFilter).toLowerCase();
        filtered = filtered.filter((r) => r.proformaDetails.some((d) => d.customerName.toLowerCase().includes(q)));
      }
      if (proformaFilter) {
        const q = String(proformaFilter).toLowerCase();
        filtered = filtered.filter((r) => r.proformaDetails.some((d) => d.proformaName.toLowerCase().includes(q)));
      }
      if (containerFilter) {
        const q = String(containerFilter).toLowerCase();
        filtered = filtered.filter((r) =>
          r.proformaDetails.some((d) => d.containers.some((c) => c.containerName.toLowerCase().includes(q)))
        );
      }
      if (statusFilter) {
        const q = String(statusFilter).toUpperCase();
        filtered = filtered.filter((r) => r.proformaDetails.some((d) => d.containers.some((c) => c.status === q)));
      }
      if (hideZero === "true") {
        // Keep rows that have non-zero counts OR that still have at least one non-cancelled
        // container in any linked proforma (e.g. a FINALIZED order whose bales are already SOLD
        // and therefore no longer contribute to stockAvailable / totalLoaded / expectedToLoad).
        filtered = filtered.filter(
          (r) =>
            r.expectedToLoad > 0 ||
            r.stockAvailable > 0 ||
            r.totalLoaded > 0 ||
            r.proformaDetails.some((d) => d.containers.some((c) => c.status !== "CANCELLED"))
        );
      }

      const totals = {
        stockAvailable: filtered.reduce((s, r) => s + r.stockAvailable, 0),
        totalLoaded: filtered.reduce((s, r) => s + r.totalLoaded, 0),
        expectedToLoad: filtered.reduce((s, r) => s + r.expectedToLoad, 0),
        freeToPromise: filtered.reduce((s, r) => s + r.freeToPromise, 0),
        totalKg: filtered.reduce((s, r) => s + r.totalKg, 0),
        shortageCount: filtered.filter((r) => r.freeToPromise < 0).length,
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
        return res
          .status(400)
          .json({ message: "At least one line must have articleCode, productName, and quantity > 0" });
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
          pricingMode: l.pricingMode ?? "per_bale",
          pricePerKg:
            l.pricingMode === "per_kg" && l.pricePerKg != null && l.pricePerKg !== "" ? String(l.pricePerKg) : null,
        }));
        const insertedLines = await tx.insert(customerProformaLines).values(lineValues).returning();

        let createdOrders: any[] = [];
        if (sendToLoading && names.length > 0) {
          const today = getClientDate(req);
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

          // Phase B: Insert one expected line per (container × proforma line).
          // These lock in the expected quantity at order creation time.
          // V5 guard: proformaIdUsed IS NOT NULL (all createdOrders are V5 by construction)
          const expectedLineValues: any[] = [];
          for (const order of createdOrders) {
            for (const line of insertedLines) {
              expectedLineValues.push({
                companyId,
                orderId: order.id,
                proformaId: proforma.id,
                proformaLineId: line.id,
                articleCode: line.articleCode,
                productName: line.productName,
                expectedQty: line.quantity,
              });
            }
          }
          if (expectedLineValues.length > 0) {
            await tx.insert(customerOrderExpectedLines).values(expectedLineValues);
          }
        }

        return { proforma, lines: insertedLines, orders: createdOrders };
      });

      res.json(result);
    } catch (err: any) {
      console.error("[V5] proforma-with-loading error:", err);
      res.status(400).json({ message: err.message });
    }
  });

  // ── POST /api/factory/v5/proforma/:proformaId/add-containers ─────────────
  // Adds new DRAFT containers to an existing active proforma.
  // Creates customer_orders + customer_order_expected_lines for each new container.
  // Does NOT touch existing containers or their expected lines.
  // V5 guard: proformaIdUsed IS NOT NULL (all created orders are V5 by construction)
  app.post("/api/factory/v5/proforma/:proformaId/add-containers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const proformaId = parseInt(req.params.proformaId);
      if (!proformaId || isNaN(proformaId)) return res.status(400).json({ message: "Invalid proformaId" });

      let { containerNames } = req.body;
      if (!Array.isArray(containerNames) || containerNames.length === 0) {
        return res.status(400).json({ message: "containerNames must be a non-empty array" });
      }

      // Trim names
      containerNames = (containerNames as any[]).map((n: any) => String(n ?? "").trim());

      // Reject empty names
      if (containerNames.some((n: string) => !n)) {
        return res.status(400).json({ message: "Container names must not be empty" });
      }

      // Reject duplicates within the request
      const uniqueInReq = new Set(containerNames);
      if (uniqueInReq.size !== containerNames.length) {
        const seen = new Set<string>();
        const dupes = containerNames.filter((n: string) => seen.size === seen.add(n).size);
        return res
          .status(400)
          .json({ message: `Duplicate container names in request: ${Array.from(new Set(dupes)).join(", ")}` });
      }

      // Confirm proforma exists for this company and is active
      const [proforma] = await db
        .select()
        .from(customerProformas)
        .where(and(eq(customerProformas.id, proformaId), eq(customerProformas.companyId, companyId)));
      if (!proforma) return res.status(404).json({ message: "Proforma not found" });
      if (!proforma.isActive) return res.status(400).json({ message: "Proforma is not active" });

      // Reject names that already exist in customer_orders for this proforma (any status,
      // including CANCELLED — prefer strict rejection to avoid confusion)
      const existingOrdersRaw = await db.execute(
        sql`SELECT container_number FROM customer_orders
            WHERE proforma_id_used = ${proformaId}
              AND container_number IS NOT NULL`
      );
      const existingNames = new Set(
        ((existingOrdersRaw as any).rows ?? []).map((r: any) => String(r.container_number ?? "").trim())
      );
      const conflicting = containerNames.filter((n: string) => existingNames.has(n));
      if (conflicting.length > 0) {
        return res
          .status(400)
          .json({ message: `Container name(s) already exist under this proforma: ${conflicting.join(", ")}` });
      }

      // Fetch current proforma lines — used to create expected_lines for each new container
      const proformaLines = await db
        .select()
        .from(customerProformaLines)
        .where(eq(customerProformaLines.proformaId, proformaId));

      const result = await db.transaction(async (tx: any) => {
        const today = getClientDate(req);
        const orderValues = containerNames.map((containerName: string) => ({
          companyId,
          customerId: proforma.customerId,
          orderDate: today,
          proformaIdUsed: proformaId,
          containerNumber: containerName,
          status: "DRAFT",
          subtotalBales: "0",
          freightAmount: "0",
          otherChargesTotal: "0",
          grandTotal: "0",
          totalQtyBales: 0,
        }));
        const createdOrders = await tx.insert(customerOrders).values(orderValues).returning();

        // Phase B: Insert one expected line per (container × proforma line).
        // This locks in the expected qty at order creation time.
        // Existing containers and their expected lines are not touched.
        // V5 guard: proformaIdUsed IS NOT NULL (all createdOrders are V5 by construction)
        const expectedLineValues: any[] = [];
        for (const order of createdOrders) {
          for (const line of proformaLines) {
            expectedLineValues.push({
              companyId,
              orderId: order.id,
              proformaId: proformaId,
              proformaLineId: line.id,
              articleCode: line.articleCode,
              productName: line.productName,
              expectedQty: Number(line.quantity),
            });
          }
        }
        if (expectedLineValues.length > 0) {
          await tx.insert(customerOrderExpectedLines).values(expectedLineValues);
        }

        return { orders: createdOrders, expectedLinesCreated: expectedLineValues.length };
      });

      res.json({
        added: containerNames.length,
        orders: result.orders,
        expectedLinesCreated: result.expectedLinesCreated,
      });
    } catch (err: any) {
      console.error("[V5] add-containers error:", err);
      res.status(400).json({ message: err.message });
    }
  });

  // ── PATCH /api/factory/v5/proforma/:proformaId/close ─────────────────────
  // Manually closes an active proforma by setting isActive = false.
  // Validates all linked containers are FINALIZED or CANCELLED before closing.
  // After close the proforma no longer appears in the V5 GET (which filters isActive=true),
  // so it stops contributing to expectedToLoad automatically.
  // Does NOT delete proformas, containers, expected lines, or bales.
  // V5 guard: proformaIdUsed IS NOT NULL (proforma.isActive is V5-specific concept)
  app.patch("/api/factory/v5/proforma/:proformaId/close", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const proformaId = parseInt(req.params.proformaId);
      if (!proformaId || isNaN(proformaId)) return res.status(400).json({ message: "Invalid proformaId" });

      // Confirm proforma exists for this company
      const [proforma] = await db
        .select()
        .from(customerProformas)
        .where(and(eq(customerProformas.id, proformaId), eq(customerProformas.companyId, companyId)));
      if (!proforma) return res.status(404).json({ message: "Proforma not found" });
      if (!proforma.isActive) return res.status(400).json({ message: "Proforma is already closed" });

      // Confirm it has linked customer_orders
      const linkedOrdersRaw = await db.execute(
        sql`SELECT id, status FROM customer_orders WHERE proforma_id_used = ${proformaId}`
      );
      const linkedOrders = ((linkedOrdersRaw as any).rows ?? []) as { id: number; status: string }[];
      if (linkedOrders.length === 0) {
        return res.status(400).json({ message: "Cannot close a proforma with no linked containers" });
      }

      // Confirm all linked orders are FINALIZED or CANCELLED
      const CLOSEABLE_STATUSES = ["FINALIZED", "CANCELLED"];
      const openOrders = linkedOrders.filter((o) => !CLOSEABLE_STATUSES.includes(o.status));
      if (openOrders.length > 0) {
        return res.status(400).json({ message: "Cannot close proforma while containers are still open." });
      }

      // Set isActive = false — proforma disappears from the V5 GET active filter automatically
      const [updated] = await db
        .update(customerProformas)
        .set({ isActive: false })
        .where(eq(customerProformas.id, proformaId))
        .returning();

      res.json({ proforma: updated });
    } catch (err: any) {
      console.error("[V5] close-proforma error:", err);
      res.status(400).json({ message: err.message });
    }
  });

  // ── PATCH /api/factory/v5/proforma/:proformaId/draft-expected-lines ───────
  // Updates expected_qty in customer_order_expected_lines for DRAFT containers
  // that have NOT started loading (zero bales in customer_order_bales).
  // Containers that have any scanned bale, or whose status is not DRAFT, are
  // completely untouched. V2/V3 orders are not affected (V5 guard below).
  // V5 guard: proformaIdUsed IS NOT NULL (eligible query requires proforma_id_used = proformaId)
  app.patch("/api/factory/v5/proforma/:proformaId/draft-expected-lines", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const proformaId = parseInt(req.params.proformaId);
      if (!proformaId || isNaN(proformaId)) return res.status(400).json({ message: "Invalid proformaId" });

      const { updates } = req.body as { updates?: { articleCode: string; expectedQty: number }[] };
      if (!Array.isArray(updates) || updates.length === 0) {
        return res.status(400).json({ message: "updates[] is required and must not be empty" });
      }

      // Validate each update entry before touching the DB
      for (const u of updates) {
        if (!u.articleCode || typeof u.articleCode !== "string") {
          return res.status(400).json({ message: "Each update must have a valid articleCode" });
        }
        if (!Number.isInteger(Number(u.expectedQty)) || Number(u.expectedQty) < 0) {
          return res.status(400).json({ message: `expectedQty for "${u.articleCode}" must be a non-negative integer` });
        }
      }

      // Verify proforma exists and is active for this company
      const [proforma] = await db
        .select()
        .from(customerProformas)
        .where(and(eq(customerProformas.id, proformaId), eq(customerProformas.companyId, companyId)));
      if (!proforma) return res.status(404).json({ message: "Proforma not found" });
      if (!proforma.isActive) return res.status(400).json({ message: "Proforma is closed" });

      // Find eligible DRAFT orders: status = DRAFT AND NOT EXISTS bales row
      // This is the core safety gate — any container with even one scanned bale is excluded.
      // V5 guard: proformaIdUsed IS NOT NULL (proforma_id_used = proformaId ensures this)
      const eligibleRaw = await db.execute(
        sql`SELECT id FROM customer_orders
            WHERE company_id = ${companyId}
              AND proforma_id_used = ${proformaId}
              AND status = 'DRAFT'
              AND NOT EXISTS (
                SELECT 1 FROM customer_order_bales cob WHERE cob.order_id = customer_orders.id
              )`
      );
      const eligibleOrders = ((eligibleRaw as any).rows ?? []) as { id: number }[];
      if (eligibleOrders.length === 0) {
        return res.status(400).json({ message: "No draft containers are available to edit." });
      }
      const eligibleIds = eligibleOrders.map((o: any) => Number(o.id));

      // Update expected_qty per article × per eligible order.
      // Only updates rows that ALREADY EXIST — rejects silently for unknown articles
      // (expected lines are backfilled at GET time, so missing rows = article not in proforma).
      // LOADING / PENDING / VERIFIED / FINALIZED / CANCELLED orders are not in eligibleIds,
      // so their expected lines are guaranteed to remain unchanged.
      let totalUpdated = 0;
      await db.transaction(async (tx: any) => {
        for (const update of updates) {
          const qty = Math.round(Number(update.expectedQty));
          for (const orderId of eligibleIds) {
            const result = await tx.execute(
              sql`UPDATE customer_order_expected_lines
                  SET expected_qty = ${qty}
                  WHERE order_id = ${orderId}
                    AND article_code = ${update.articleCode}
                    AND company_id = ${companyId}`
            );
            totalUpdated += (result as any).rowCount ?? 0;
          }
        }
      });

      res.json({
        updated: totalUpdated,
        eligibleContainers: eligibleIds.length,
        articlesEdited: updates.length,
      });
    } catch (err: any) {
      console.error("[V5] draft-expected-lines error:", err);
      res.status(400).json({ message: err.message });
    }
  });

  // ── GET /api/factory/v5/location-summary ──────────────────────────────────
  // Returns per-article V5 stock balance for a specific warehouse location:
  //   inStock          — factory_bales.status = IN_STOCK at this location
  //   reservedExpected — SUM(expected_qty) from DRAFT V5 orders on active proformas (company-wide)
  //   loading          — bales at this location in LOADING V5 containers
  //   availableBalance — inStock − reservedExpected − loading
  //
  // V5 guard: proforma_id_used IS NOT NULL (applied to both reservedExpected and loading queries)
  // Does NOT read proforma_stock_reservations or any V2/V3 table.
  app.get("/api/factory/v5/location-summary", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const locationId = parseInt(String(req.query.locationId));
      if (!locationId || isNaN(locationId))
        return res.status(400).json({ message: "locationId query param is required" });

      // 1. inStock — IN_STOCK bales at this location, grouped by article
      const inStockRaw = await db.execute(
        sql`SELECT article_code AS "articleCode", COUNT(*)::int AS count
            FROM factory_bales
            WHERE company_id = ${companyId}
              AND erp_location_id = ${locationId}
              AND status = 'IN_STOCK'
            GROUP BY article_code`
      );
      const inStockMap = new Map<string, number>(
        ((inStockRaw as any).rows ?? []).map((r: any) => [r.articleCode, Number(r.count)])
      );

      // 2. reservedExpected — SUM(expected_qty) for DRAFT V5 orders on active proformas (company-wide)
      //    V5 guard: proforma_id_used IS NOT NULL
      //    Does NOT filter by location: DRAFT containers are reservations not yet physically loaded.
      const reservedRaw = await db.execute(
        sql`SELECT cel.article_code AS "articleCode", SUM(cel.expected_qty)::int AS total
            FROM customer_order_expected_lines cel
            JOIN customer_orders co ON co.id = cel.order_id
            JOIN customer_proformas cp ON cp.id = co.proforma_id_used
            WHERE cel.company_id = ${companyId}
              AND co.status = 'DRAFT'
              AND co.proforma_id_used IS NOT NULL
              AND cp.is_active = true
            GROUP BY cel.article_code`
      );
      const reservedMap = new Map<string, number>(
        ((reservedRaw as any).rows ?? []).map((r: any) => [r.articleCode, Number(r.total)])
      );

      // 3. loading — bales at this location that have been scanned into LOADING V5 containers
      //    V5 guard: proforma_id_used IS NOT NULL
      //    Location-filtered because bales are physically at the location when loaded.
      const loadingRaw = await db.execute(
        sql`SELECT fb.article_code AS "articleCode", COUNT(*)::int AS count
            FROM customer_order_bales cob
            JOIN factory_bales fb ON fb.id = cob.bale_id
            JOIN customer_orders co ON co.id = cob.order_id
            WHERE co.company_id = ${companyId}
              AND co.status = 'LOADING'
              AND co.proforma_id_used IS NOT NULL
              AND fb.erp_location_id = ${locationId}
            GROUP BY fb.article_code`
      );
      const loadingMap = new Map<string, number>(
        ((loadingRaw as any).rows ?? []).map((r: any) => [r.articleCode, Number(r.count)])
      );

      // 4. Resolve product names + weight_per_bale_kg (bidirectional code/articleCode lookup)
      const allCodes = new Set([...inStockMap.keys(), ...reservedMap.keys(), ...loadingMap.keys()]);
      const productNameMap = new Map<string, string>();
      const weightMap = new Map<string, number>();
      if (allCodes.size > 0) {
        const codeArrArr = Array.from(allCodes);
        const codeArr2 = sqlArray(codeArrArr);
        const nameRaw = await db.execute(
          sql`SELECT DISTINCT ON (matched_code) matched_code AS "articleCode", name, weight_per_bale_kg AS "weightPerBaleKg" FROM (
                SELECT name, weight_per_bale_kg,
                  CASE WHEN code        = ANY(${codeArr2}) THEN code
                       WHEN article_code = ANY(${codeArr2}) THEN article_code
                  END AS matched_code
                FROM factory_bale_products
                WHERE company_id = ${companyId}
                  AND (code = ANY(${codeArr2}) OR article_code = ANY(${codeArr2}))
              ) sub
              WHERE matched_code IS NOT NULL
              ORDER BY matched_code`
        );
        ((nameRaw as any).rows ?? []).forEach((r: any) => {
          if (r.name) productNameMap.set(r.articleCode, r.name);
          if (r.weightPerBaleKg != null) weightMap.set(r.articleCode, parseFloat(r.weightPerBaleKg));
        });
      }

      // 5. Build per-article rows; exclude rows with all zeros
      const rows = Array.from(allCodes)
        .sort()
        .map((articleCode) => {
          const inStock = inStockMap.get(articleCode) ?? 0;
          const reservedExpected = reservedMap.get(articleCode) ?? 0;
          const loading = loadingMap.get(articleCode) ?? 0;
          const availableBalance = inStock - reservedExpected - loading;
          const weightPerBaleKg = weightMap.get(articleCode) ?? 0;
          return {
            articleCode,
            productName: productNameMap.get(articleCode) ?? articleCode,
            inStock,
            reservedExpected,
            loading,
            availableBalance,
            weightPerBaleKg,
          };
        })
        .filter((r) => r.inStock > 0 || r.reservedExpected > 0 || r.loading > 0);

      res.json({
        rows,
        shortageCount: rows.filter((r) => r.availableBalance < 0).length,
      });
    } catch (err: any) {
      console.error("[V5] location-summary error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ── GET /api/factory/v5/recently-cancelled-containers ────────────────────
  // Returns V5 containers (proforma_id_used IS NOT NULL) that were cancelled
  // within the last 30 days. Used by the "Restore Cancelled Container" UI.
  // Read-only — does not modify any data.
  app.get("/api/factory/v5/recently-cancelled-containers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const raw = await db.execute(
        sql`SELECT
              co.id,
              co.container_number      AS "containerNumber",
              co.status,
              co.customer_id           AS "customerId",
              co.updated_at            AS "cancelledAt",
              co.loading_started_at    AS "loadingStartedAt",
              co.proforma_id_used      AS "proformaId",
              c.legal_name             AS "customerName",
              cp.name                  AS "proformaName"
            FROM customer_orders co
            LEFT JOIN customers c    ON c.id  = co.customer_id
            LEFT JOIN customer_proformas cp ON cp.id = co.proforma_id_used
            WHERE co.company_id          = ${companyId}
              AND co.status              = 'CANCELLED'
              AND co.proforma_id_used    IS NOT NULL
              AND co.updated_at          >= NOW() - INTERVAL '30 days'
            ORDER BY co.updated_at DESC
            LIMIT 50`
      );

      const orders = ((raw as any).rows ?? (raw as unknown as any[])).map((r: any) => ({
        id: Number(r.id),
        containerNumber: r.containerNumber ?? `Order #${r.id}`,
        status: r.status,
        customerId: r.customerId ? Number(r.customerId) : null,
        customerName: r.customerName ?? "Unknown",
        cancelledAt: r.cancelledAt,
        wasLoading: !!r.loadingStartedAt,
        proformaId: r.proformaId ? Number(r.proformaId) : null,
        proformaName: r.proformaName ?? null,
      }));

      res.json({ orders });
    } catch (err: any) {
      console.error("[V5] recently-cancelled-containers error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ── POST /api/factory/v5/containers/:id/restore ──────────────────────────
  // Restores a cancelled V5 container back to its previous status.
  // If it had loadingStartedAt set → restore to LOADING.
  // If it had no loadingStartedAt → restore to DRAFT.
  // Note: bale links that were deleted during cancellation are NOT restored
  // (bales are back in stock and can be re-scanned).
  app.post("/api/factory/v5/containers/:id/restore", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      if (!orderId || isNaN(orderId)) return res.status(400).json({ message: "Invalid id" });

      const [order] = await db
        .execute(
          sql`SELECT id, status, proforma_id_used, loading_started_at
            FROM customer_orders
            WHERE id = ${orderId} AND company_id = ${companyId}`
        )
        .then((r: any) =>
          (r.rows ?? (r as any[])).map((row: any) => ({
            id: Number(row.id),
            status: row.status,
            proformaIdUsed: row.proforma_id_used,
            loadingStartedAt: row.loading_started_at,
          }))
        );

      if (!order) return res.status(404).json({ message: "Container not found" });
      if (order.status !== "CANCELLED")
        return res.status(400).json({ message: "Only CANCELLED containers can be restored" });
      if (!order.proformaIdUsed)
        return res.status(400).json({ message: "Only V5 containers (linked to a proforma) can be restored here" });

      const restoreStatus = order.loadingStartedAt ? "LOADING" : "DRAFT";

      await db.execute(
        sql`UPDATE customer_orders
            SET status = ${restoreStatus}, updated_at = NOW()
            WHERE id = ${orderId} AND company_id = ${companyId}`
      );

      // Remove the ORDER_CANCELLED daybook entry so financials are clean
      await db.execute(
        sql`DELETE FROM factory_daybook_entries
            WHERE company_id = ${companyId}
              AND tx_type = 'ORDER_CANCELLED'
              AND reference_id = ${orderId}`
      );

      // Restore the exact bale links that were archived when the order was cancelled.
      // If history rows exist (i.e. the order was cancelled after this feature landed),
      // copy them back into customer_order_bales so the scanner sees the original references.
      // For older orders cancelled before this feature, history is empty and the totals
      // are simply reset to 0 — those orders need Auto-Recover or manual recovery.
      const historyResult = await db.execute(
        sql`SELECT COUNT(*)::int AS cnt FROM customer_order_bales_history WHERE order_id = ${orderId}`
      );
      const historyCount = Number(((historyResult as any).rows ?? [])[0]?.cnt ?? 0);

      if (historyCount > 0) {
        await db.execute(
          sql`INSERT INTO customer_order_bales
                (order_id, bale_id, bale_reference, location_id, weight,
                 article_code, bale_name, price_used, scanned_by)
              SELECT order_id, bale_id, bale_reference, location_id, weight,
                     article_code, bale_name, price_used, scanned_by
              FROM customer_order_bales_history
              WHERE order_id = ${orderId}`
        );
        await db.execute(sql`DELETE FROM customer_order_bales_history WHERE order_id = ${orderId}`);
      }

      // Rebuild order_lines and sync total_qty_bales from the live bale count.
      await recalculateOrderTotals(db, orderId);

      res.json({ id: orderId, restoredTo: restoreStatus, balasRestored: historyCount });
    } catch (err: any) {
      console.error("[V5] restore-container error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ── GET /api/factory/v5/unlinked-loading-orders ───────────────────────────
  // Returns LOADING customer_orders that have proforma_id_used IS NULL.
  // Used by the "Link Existing Container" UI in Stock Allocation V5.
  // Read-only — does not modify any data.
  app.get("/api/factory/v5/unlinked-loading-orders", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const raw = await db.execute(
        sql`SELECT
              co.id,
              co.container_number  AS "containerNumber",
              co.status,
              co.customer_id       AS "customerId",
              co.created_at        AS "createdAt",
              c.legal_name         AS "customerName",
              COUNT(cob.id)::int   AS "loadedBaleCount"
            FROM customer_orders co
            LEFT JOIN customers c ON c.id = co.customer_id
            LEFT JOIN customer_order_bales cob ON cob.order_id = co.id
            WHERE co.company_id      = ${companyId}
              AND co.status          = 'LOADING'
              AND co.proforma_id_used IS NULL
            GROUP BY co.id, co.container_number, co.status, co.customer_id, co.created_at, c.legal_name
            ORDER BY co.created_at DESC`
      );

      const orders = (raw.rows).map((r: any) => ({
        id: Number(r.id),
        containerNumber: r.containerNumber ?? `Order #${r.id}`,
        status: r.status,
        customerId: r.customerId ? Number(r.customerId) : null,
        customerName: r.customerName ?? "Unknown",
        createdAt: r.createdAt,
        loadedBaleCount: Number(r.loadedBaleCount ?? 0),
      }));

      res.json({ orders });
    } catch (err: any) {
      console.error("[V5] unlinked-loading-orders error:", err);
      res.status(500).json({ message: err.message });
    }
  });
}
