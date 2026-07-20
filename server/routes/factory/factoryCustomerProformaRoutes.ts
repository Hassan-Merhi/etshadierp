import { parseId, parseOptionalId } from "../../lib/parseId";
import { getClientDate } from "../../lib/dateUtils";
import { getExportPriceVisibility } from "../../helpers/exportVisibility";
import { buildSafeFilename, contentDisposition } from "../../lib/contentDisposition";
import { syncProformaReservations, isFactoryV2Company, computeFreeToPromise } from "./_stockReservationHelper";
import { sqlArray } from "../../lib/sqlArray";
import type { Express } from "express";
import { db, pool } from "../../db";
import { requireAuth } from "../../auth";
import { classifyNetPositionAccounts } from "../../netPositionHelper";
import { adjustInventory } from "../../inventoryHelper";
import {
  writeDaybookEntry,
  getOrFetchFxRateToUsd,
  getOrCreateLedgerAccount,
  isLegacySHA256Hash,
  verifySupervisorPassword,
  recalculateOrderTotals,
} from "./_helpers";
import {
  factorySuppliers,
  factoryCategories,
  factoryBaleProducts,
  factoryContainers,
  factoryRawStock,
  factoryMixBatches,
  factoryMixBatchSources,
  factoryDailyUsages,
  factoryPressingBatches,
  factoryBales,
  factoryBaleSequences,
  factoryContainerCommissions,
  baleLabelPrints,
  stockItems,
  stockGroups,
  users,
  insertFactorySupplierSchema,
  insertFactoryCategorySchema,
  insertFactoryBaleProductSchema,
  insertFactoryContainerSchema,
  insertFactoryRawStockSchema,
  insertFactoryMixBatchSchema,
  insertFactoryMixBatchSourceSchema,
  insertFactoryPressingBatchSchema,
  insertFactoryBaleSchema,
  customerProformas,
  customerProformaLines,
  customerOrders,
  customerOrderLines,
  customerOrderBales,
  customerOrderCharges,
  customerInvoiceSequences,
  customerBalances,
  customers,
  insertCustomerSchema,
  ledgerAccounts,
  voucherEntries,
  companies,
  locations,
  userCompanyRoles,
  insertCustomerProformaSchema,
  insertCustomerProformaLineSchema,
  insertCustomerOrderSchema,
  factoryFxRates,
  insertFactoryFxRateSchema,
  factoryDaybookEntries,
  containerDocumentTypes,
  containerDocuments,
  containerFreight,
  containerFreightPayments,
  factoryDaybookEntryEdits,
  containers,
  factoryUserProfiles,
  factoryUserPageAccess,
  insertUserSchema,
  directMessages,
  insertDirectMessageSchema,
  userPresence,
  factoryDutyAuditLog,
  factoryOffloadAdditionalCharges,
  factoryContainerOtherCharges,
  companySettings,
  factorySettings,
  factoryWorkers,
  factoryWorkerCategories,
  insertFactoryWorkerCategorySchema,
  factoryRawMaterialAdjustments,
  factoryPayrolls,
  factoryWorkerDocuments,
  factoryAlerts,
  employees,
  factoryWasteEntries,
  factoryBalePhotos,
  factoryDailyKpiSnapshots,
  factorySupplierScoreSnapshots,
  factoryBaleCostSnapshots,
  factoryContainerProfitSnapshots,
  bankAccounts,
  inventory,
  exchangeRates,
  vouchers,
  suppliers,
  containerSales,
  factorySupplierPayments,
  insertFactorySupplierPaymentSchema,
  factorySupplierFxTransfers,
  insertFactorySupplierFxTransferSchema,
  factoryFxAllocations,
  baleRecodeSessions,
  baleRecodeItems,
  factoryWorkerAdvances,
  factoryAdvanceRepayments,
  factoryBaleWasteDispatches,
  factoryPosSales,
  factoryPosSaleItems,
  proformaStockReservations,
} from "@shared/schema";
import { eq, and, or, asc, desc, sql, inArray, ilike, ne, isNull, not, gte, lte, lt, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import CryptoJS from "crypto-js";
import multer from "multer";
import path from "path";
import fs from "fs";

async function autoSavePriceToPriceList(
  companyId: number,
  customerId: number,
  articleCode: string,
  pricePerBale: string | number
) {
  const price = parseFloat(String(pricePerBale));
  if (!articleCode || isNaN(price) || price <= 0) return;
  await pool.query(
    `INSERT INTO customer_price_lists (company_id, customer_id, article_code, price_per_bale, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (company_id, customer_id, article_code)
     DO UPDATE SET price_per_bale = EXCLUDED.price_per_bale, updated_at = now()`,
    [companyId, customerId, articleCode, price]
  );
}

export function registerFactoryCustomerProformaRoutes(app: Express) {
  /* Single proforma by ID — used by EditProformaV5Drawer */
  app.get("/api/factory/customer-proformas/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      // Use SELECT * to avoid "column does not exist" errors when the Drizzle schema
      // has columns not yet migrated to production.
      const rawProformaRes = await db.execute(
        sql`SELECT * FROM customer_proformas WHERE id = ${id} AND company_id = ${companyId} AND deleted_at IS NULL LIMIT 1`
      );
      const rawProformaRows: any[] = (rawProformaRes as any).rows ?? (rawProformaRes as unknown as any[]);
      if (!rawProformaRows.length) return res.status(404).json({ message: "Proforma not found" });
      const pr = rawProformaRows[0];
      const proforma = {
        id: pr.id,
        companyId: pr.company_id,
        customerId: pr.customer_id,
        name: pr.name ?? "",
        isActive: pr.is_active ?? false,
        deletedAt: pr.deleted_at ?? null,
        createdAt: pr.created_at,
        updatedAt: pr.updated_at ?? pr.created_at,
      };
      // Raw SQL to avoid "column does not exist" when price_fixed / production_price_per_bale
      // are absent from the production DB.
      const rawLinesRes = await db.execute(sql`SELECT * FROM customer_proforma_lines WHERE proforma_id = ${id}`);
      const lines: any[] = ((rawLinesRes as any).rows ?? (rawLinesRes as unknown as any[])).map((l: any) => ({
        id: l.id,
        proformaId: l.proforma_id,
        articleCode: l.article_code ?? "",
        productName: l.product_name ?? "",
        quantity: Number(l.quantity) || 0,
        pricePerBale: l.price_per_bale ?? "0",
        productionPricePerBale: l.production_price_per_bale ?? "0",
        priceFixed: l.price_fixed ?? false,
        pricingMode: l.pricing_mode ?? "per_bale",
        pricePerKg: l.price_per_kg ?? null,
        createdAt: l.created_at,
      }));
      const articleCodes = [...new Set(lines.map((l: any) => l.articleCode).filter(Boolean))];
      const weightMap = new Map<string, string>();
      if (articleCodes.length > 0) {
        const baleProds = await db
          .select({
            articleCode: factoryBaleProducts.articleCode,
            weightPerBaleKg: factoryBaleProducts.weightPerBaleKg,
            name: factoryBaleProducts.name,
          })
          .from(factoryBaleProducts)
          .where(
            and(
              eq(factoryBaleProducts.companyId, companyId),
              inArray(factoryBaleProducts.articleCode, articleCodes as string[])
            )
          );
        baleProds.forEach((p: any) => {
          if (p.articleCode) weightMap.set(p.articleCode, p.weightPerBaleKg || "0");
        });
      }
      const enrichedLines = lines.map((l: any) => ({ ...l, weightPerBaleKg: weightMap.get(l.articleCode) || "0" }));
      res.json({ ...proforma, lines: enrichedLines });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/customer-proformas", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const customerId = req.query.customerId ? parseOptionalId(req.query.customerId) : null;
      if (!customerId) return res.status(400).json({ message: "customerId is required" });

      // SELECT * to avoid explicit-column failures when the Drizzle schema has
      // columns not yet migrated to production (e.g. is_active added later).
      const rawProformasRes = await db.execute(
        sql`SELECT * FROM customer_proformas
            WHERE company_id = ${companyId}
              AND customer_id = ${customerId}
              AND deleted_at IS NULL
            ORDER BY name ASC`
      );
      const proformas: any[] = ((rawProformasRes as any).rows ?? (rawProformasRes as unknown as any[])).map(
        (r: any) => ({
          id: r.id,
          companyId: r.company_id,
          customerId: r.customer_id,
          name: r.name ?? "",
          isActive: r.is_active ?? false,
          deletedAt: r.deleted_at ?? null,
          createdAt: r.created_at,
          updatedAt: r.updated_at ?? r.created_at,
        })
      );

      const proformaIds = proformas.map((p: any) => p.id);
      let lines: any[] = [];
      if (proformaIds.length > 0) {
        // ANY(${jsArray}) generates tuple syntax ANY(($1,$2,...)) which PostgreSQL
        // rejects.  Use IN (${sql.join(...)}) which produces valid IN ($1,$2,...).
        const idList = sql.join(
          proformaIds.map((id: number) => sql`${id}`),
          sql`,`
        );
        const rawLines = await db.execute(sql`SELECT * FROM customer_proforma_lines WHERE proforma_id IN (${idList})`);
        const rawRows: any[] = (rawLines as any).rows ?? (rawLines as unknown as any[]);
        lines = rawRows.map((l: any) => ({
          id: l.id,
          proformaId: l.proforma_id,
          articleCode: l.article_code ?? "",
          productName: l.product_name ?? "",
          quantity: Number(l.quantity) || 0,
          pricePerBale: l.price_per_bale ?? "0",
          productionPricePerBale: l.production_price_per_bale ?? "0",
          priceFixed: l.price_fixed ?? false,
          createdAt: l.created_at,
        }));
      }

      // Enrich lines with weightPerBaleKg and correct productName from factoryBaleProducts
      const articleCodes = [...new Set(lines.map((l: any) => l.articleCode).filter(Boolean))];
      const weightMap = new Map<string, string>();
      const nameMap = new Map<string, string>();
      if (articleCodes.length > 0) {
        const baleProds = await db
          .select({
            articleCode: factoryBaleProducts.articleCode,
            weightPerBaleKg: factoryBaleProducts.weightPerBaleKg,
            name: factoryBaleProducts.name,
          })
          .from(factoryBaleProducts)
          .where(
            and(
              eq(factoryBaleProducts.companyId, companyId),
              inArray(factoryBaleProducts.articleCode, articleCodes as string[])
            )
          );
        baleProds.forEach((p: any) => {
          if (p.articleCode) {
            weightMap.set(p.articleCode, p.weightPerBaleKg || "0");
            if (p.name) nameMap.set(p.articleCode, p.name);
          }
        });
      }

      const enrichedLines = lines.map((l: any) => ({
        ...l,
        weightPerBaleKg: weightMap.get(l.articleCode) || "0",
        productName: nameMap.get(l.articleCode) || l.productName,
      }));

      const result = proformas.map((p: any) => ({
        ...p,
        lines: enrichedLines.filter((l: any) => l.proformaId === p.id),
      }));

      res.json(result);
    } catch (error: any) {
      console.error("Error fetching customer proformas:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-proformas", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const parsed = insertCustomerProformaSchema.parse({ ...req.body, companyId });

      const [duplicate] = await db
        .select({ id: customerProformas.id })
        .from(customerProformas)
        .where(
          and(
            eq(customerProformas.companyId, companyId),
            eq(customerProformas.customerId, parsed.customerId),
            eq(customerProformas.name, parsed.name)
          )
        );
      if (duplicate) {
        return res.status(409).json({
          message: `A proforma named "${parsed.name}" already exists for this customer. Please choose a different name.`,
        });
      }

      const [proforma] = await db.insert(customerProformas).values(parsed).returning();
      // Sync reservations — no lines yet, but initialises a clean slate
      await syncProformaReservations(db, companyId, proforma.id);
      res.json(proforma);
    } catch (error: any) {
      console.error("Error creating customer proforma:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.put("/api/factory/customer-proformas/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const [existing] = await db
        .select()
        .from(customerProformas)
        .where(and(eq(customerProformas.id, id), eq(customerProformas.companyId, companyId)));
      if (!existing) return res.status(404).json({ message: "Proforma not found" });

      if (req.body.name && req.body.name !== existing.name) {
        const [duplicate] = await db
          .select({ id: customerProformas.id })
          .from(customerProformas)
          .where(
            and(
              eq(customerProformas.companyId, companyId),
              eq(customerProformas.customerId, existing.customerId),
              eq(customerProformas.name, req.body.name)
            )
          );
        if (duplicate) {
          return res.status(409).json({
            message: `A proforma named "${req.body.name}" already exists for this customer. Please choose a different name.`,
          });
        }
      }

      const [updated] = await db
        .update(customerProformas)
        .set({ ...req.body, updatedAt: new Date() })
        .where(and(eq(customerProformas.id, id), eq(customerProformas.companyId, companyId)))
        .returning();

      // Sync reservations — critical when isActive toggled (releases/restores reservation)
      await syncProformaReservations(db, companyId, id);
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating customer proforma:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/factory/customer-proformas/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });

      // Fetch proforma before deleting so we can log which customer it belongs to
      const [proformaBefore] = await db
        .select()
        .from(customerProformas)
        .where(and(eq(customerProformas.id, id), eq(customerProformas.companyId, companyId)));
      if (proformaBefore) {
        const [custBefore] = await db
          .select({ id: customers.id, legalName: customers.legalName, deletedAt: customers.deletedAt })
          .from(customers)
          .where(eq(customers.id, proformaBefore.customerId));
        console.log(
          `[PROFORMA DELETE] Deleting proforma id=${id} name="${proformaBefore.name}" customerId=${proformaBefore.customerId} customerName="${custBefore?.legalName}" customerDeletedAt=${custBefore?.deletedAt}`
        );
      }

      // Soft-delete: release reservations so stock returns to freeToPromise,
      // but keep proforma + lines intact for restore from Settings → Deleted Items.
      await db
        .update(customerProformas)
        .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(customerProformas.id, id), eq(customerProformas.companyId, companyId)));
      await syncProformaReservations(db, companyId, id);
      await db
        .delete(proformaStockReservations)
        .where(and(eq(proformaStockReservations.companyId, companyId), eq(proformaStockReservations.proformaId, id)));
      const [deleted] = await db
        .select()
        .from(customerProformas)
        .where(and(eq(customerProformas.id, id), eq(customerProformas.companyId, companyId)));

      if (!deleted) return res.status(404).json({ message: "Proforma not found" });

      // Verify customer still exists after proforma deletion
      if (proformaBefore) {
        const [custAfter] = await db
          .select({ id: customers.id, legalName: customers.legalName, deletedAt: customers.deletedAt })
          .from(customers)
          .where(eq(customers.id, proformaBefore.customerId));
        console.log(
          `[PROFORMA DELETE] After deletion: customerId=${proformaBefore.customerId} customerName="${custAfter?.legalName}" customerDeletedAt=${custAfter?.deletedAt}`
        );
      }

      res.json({ message: "Proforma deleted" });
    } catch (error: any) {
      console.error("Error deleting customer proforma:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Create a pending loading from a proforma — auto-adds matching bales from stock
  app.post("/api/factory/customer-proformas/:id/create-loading", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const proformaId = parseId(req.params.id);

      if (proformaId === null) return res.status(400).json({ message: "Invalid id" });
      const { locationId, orderDate } = req.body;
      if (!locationId) return res.status(400).json({ message: "locationId is required" });

      // Fetch the proforma
      const [proforma] = await db
        .select()
        .from(customerProformas)
        .where(and(eq(customerProformas.id, proformaId), eq(customerProformas.companyId, companyId)));
      if (!proforma) return res.status(404).json({ message: "Proforma not found" });
      if (!proforma.isActive)
        return res.status(400).json({ message: "Proforma is inactive — cannot create a loading from it" });

      // Fetch proforma lines
      const lines = await db
        .select()
        .from(customerProformaLines)
        .where(eq(customerProformaLines.proformaId, proformaId));
      if (lines.length === 0)
        return res.status(400).json({ message: "Proforma has no lines — add article codes first" });

      // ── Phase 4: compute how many bales are already in active/completed loadings for this proforma ──
      // alreadyLoaded = bales in any non-cancelled order tied to this proforma
      // (LOADING, PENDING_VERIFICATION, VERIFIED, FINALIZED) — FINALIZED bales are no longer IN_STOCK
      // so they won't be grabbed, but counting them ensures we don't exceed the proforma's total qty.
      const alreadyLoadedRaw = await db.execute(
        sql`SELECT fb.article_code as "articleCode", COUNT(*)::int as loaded
            FROM customer_order_bales cob
            JOIN factory_bales fb ON fb.id = cob.bale_id
            JOIN customer_orders co ON co.id = cob.order_id
            WHERE co.company_id = ${companyId}
              AND co.proforma_id_used = ${proformaId}
              AND co.deleted_at IS NULL
              AND co.status IN ('LOADING', 'PENDING_VERIFICATION', 'VERIFIED', 'FINALIZED')
            GROUP BY fb.article_code`
      );
      console.log(`[create-loading] proformaId=${proformaId} companyId=${companyId}`);
      const alreadyLoadedMap = new Map<string, number>(
        ((alreadyLoadedRaw as any).rows || (alreadyLoadedRaw as unknown as any[])).map((r: any) => [
          r.articleCode,
          Number(r.loaded),
        ])
      );

      // ── Validate: check if there is any remaining reservation capacity ──
      const articleIssues: string[] = [];
      for (const line of lines) {
        if (!line.articleCode) continue;
        const lineQty = Number(line.quantity) || 0;
        const alreadyLoaded = alreadyLoadedMap.get(line.articleCode) || 0;
        const remaining = Math.max(0, lineQty - alreadyLoaded);
        console.log(
          `[create-loading] line articleCode=${line.articleCode} lineId=${line.id} qty=${lineQty} alreadyLoaded=${alreadyLoaded} remaining=${remaining}`
        );
        if (remaining === 0) {
          articleIssues.push(`${line.articleCode}: proforma quantity (${lineQty}) already fully loaded`);
        }
      }
      // If ALL lines are exhausted, block creation
      const linesWithCapacity = lines.filter((l) => {
        if (!l.articleCode) return false;
        const lineQty = Number(l.quantity) || 0;
        const alreadyLoaded = alreadyLoadedMap.get(l.articleCode) || 0;
        return Math.max(0, lineQty - alreadyLoaded) > 0;
      });
      if (linesWithCapacity.length === 0) {
        return res.status(400).json({
          message:
            "All proforma lines are already fully loaded into active loading orders. No remaining reservation capacity.",
          details: articleIssues,
        });
      }

      // Pre-fetch product names for all article codes in this proforma
      const proformaArticleCodes = [...new Set(lines.map((l: any) => l.articleCode).filter(Boolean))];
      const proformaProductNameMap = new Map<string, string>();
      if (proformaArticleCodes.length > 0) {
        const proformaProducts = await db
          .select({ articleCode: factoryBaleProducts.articleCode, name: factoryBaleProducts.name })
          .from(factoryBaleProducts)
          .where(
            and(
              eq(factoryBaleProducts.companyId, companyId),
              inArray(factoryBaleProducts.articleCode, proformaArticleCodes)
            )
          );
        for (const p of proformaProducts) {
          if (p.articleCode) proformaProductNameMap.set(p.articleCode, p.name);
        }
      }

      // Create the LOADING order
      const [order] = await db
        .insert(customerOrders)
        .values({
          companyId,
          customerId: proforma.customerId,
          proformaIdUsed: proformaId,
          locationId: parseInt(locationId),
          orderDate: orderDate || getClientDate(req),
          status: "LOADING",
          loadingStartedAt: new Date(),
        })
        .returning();

      let totalBalesAdded = 0;
      const insufficientStock: string[] = [];

      for (const line of lines) {
        if (!line.articleCode) continue;
        const lineQty = Number(line.quantity) || 0;
        if (lineQty <= 0) continue;

        // ── Phase 4 core: only take up to remainingToLoad, not the full proforma qty ──
        const alreadyLoaded = alreadyLoadedMap.get(line.articleCode) || 0;
        const remainingToLoad = Math.max(0, lineQty - alreadyLoaded);
        if (remainingToLoad === 0) continue; // fully loaded — skip silently

        // Find available IN_STOCK bales at this location for this article code
        const available = await db
          .select()
          .from(factoryBales)
          .where(
            and(
              eq(factoryBales.companyId, companyId),
              eq(factoryBales.status, "IN_STOCK"),
              eq(factoryBales.erpLocationId, parseInt(locationId)),
              eq(factoryBales.articleCode, line.articleCode)
            )
          )
          .orderBy(factoryBales.id)
          .limit(remainingToLoad); // ← only up to the remaining reserved quantity

        if (available.length === 0) {
          insufficientStock.push(`${line.articleCode}: 0 eligible bales in stock (need ${remainingToLoad})`);
          continue;
        }

        for (const bale of available) {
          const resolvedBaleName =
            proformaProductNameMap.get(bale.articleCode || "") || bale.productName || bale.articleCode || bale.baleCode;
          const linePricingMode = (line as any).pricingMode ?? "per_bale";
          const linePerKg = parseFloat(String((line as any).pricePerKg ?? "0"));
          let resolvedPriceUsed: string;
          if (linePricingMode === "per_kg" && linePerKg > 0) {
            const baleWt = parseFloat(String(bale.weightKg || "0"));
            resolvedPriceUsed = (!isNaN(baleWt) ? baleWt * linePerKg : 0).toFixed(2);
          } else {
            resolvedPriceUsed = String(line.pricePerBale ?? "0");
          }
          await db.insert(customerOrderBales).values({
            orderId: order.id,
            baleId: bale.id,
            baleReference: bale.referenceNumber,
            locationId: parseInt(locationId),
            weight: bale.weightKg,
            articleCode: bale.articleCode,
            baleName: resolvedBaleName,
            priceUsed: resolvedPriceUsed,
          });
          // Transition bale: IN_STOCK → RESERVED_FOR_ORDER (physically in a loading order now)
          await db
            .update(factoryBales)
            .set({ status: "RESERVED_FOR_ORDER", updatedAt: new Date() })
            .where(eq(factoryBales.id, bale.id));
          totalBalesAdded++;
        }
      }

      await recalculateOrderTotals(db, order.id);

      // Sync reservations — loading consumed some of the reservation, update the table
      // reservedQty per article = max(0, lineQty - totalLoaded across ALL active orders for this proforma)
      await syncProformaReservations(db, companyId, proformaId);

      const [loadingCustomer] = await db
        .select({ legalName: customers.legalName })
        .from(customers)
        .where(eq(customers.id, proforma.customerId));
      const insufficientNote = insufficientStock.length > 0 ? ` (${insufficientStock.join(", ")})` : "";
      await writeDaybookEntry(db, {
        companyId,
        txDate: orderDate || getClientDate(req),
        txType: "LOADING_CREATED",
        referenceId: order.id,
        description: `Loading created from proforma "${proforma.name}" for ${loadingCustomer?.legalName || "customer"} — ${totalBalesAdded} bale(s) added${insufficientNote}`,
      });

      res.json({
        order,
        balesAdded: totalBalesAdded,
        ...(insufficientStock.length > 0 ? { warnings: insufficientStock } : {}),
      });
    } catch (error: any) {
      console.error("Error creating loading from proforma:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-proforma-lines", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const parsed = insertCustomerProformaLineSchema.parse(req.body);

      const [existingLine] = await db
        .select()
        .from(customerProformaLines)
        .where(
          and(
            eq(customerProformaLines.proformaId, parsed.proformaId),
            eq(customerProformaLines.articleCode, parsed.articleCode)
          )
        );
      if (existingLine) return res.status(400).json({ message: "Article code already exists in this proforma" });

      // factory_v2: warn if requested quantity exceeds free-to-promise (non-blocking)
      let stockWarning: string | undefined;
      if (await isFactoryV2Company(companyId)) {
        const ftp = await computeFreeToPromise(companyId, parsed.articleCode);
        if ((parsed.quantity ?? 0) > ftp) {
          stockWarning = `Insufficient free stock for ${parsed.articleCode}: requested ${parsed.quantity}, available ${ftp}`;
        }
      }

      const [line] = await db.insert(customerProformaLines).values(parsed).returning();
      // Sync — new line changes reservedNotYetLoaded for this proforma
      await syncProformaReservations(db, companyId, parsed.proformaId);

      // Auto-save price to customer price list
      const [proforma] = await db
        .select({ customerId: customerProformas.customerId })
        .from(customerProformas)
        .where(eq(customerProformas.id, parsed.proformaId))
        .limit(1);
      if (proforma?.customerId && parsed.articleCode && parsed.pricePerBale) {
        await autoSavePriceToPriceList(companyId, proforma.customerId, parsed.articleCode, parsed.pricePerBale).catch(
          () => {}
        );
      }

      res.json({ ...line, ...(stockWarning ? { stockWarning } : {}) });
    } catch (error: any) {
      console.error("Error creating proforma line:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.put("/api/factory/customer-proforma-lines/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });

      // Fetch the line first to get its proformaId
      const [existingLine] = await db
        .select()
        .from(customerProformaLines)
        .where(eq(customerProformaLines.id, id))
        .limit(1);
      if (!existingLine) return res.status(404).json({ message: "Proforma line not found" });

      const updateData: any = {};
      if (req.body.productName !== undefined) updateData.productName = req.body.productName;
      if (req.body.quantity !== undefined) updateData.quantity = parseInt(req.body.quantity);
      if (req.body.pricePerBale !== undefined) updateData.pricePerBale = req.body.pricePerBale;
      if (req.body.pricingMode !== undefined) updateData.pricingMode = req.body.pricingMode;
      if (req.body.pricePerKg !== undefined) updateData.pricePerKg = req.body.pricePerKg ?? null;

      // Auto-save weight to factoryBaleProducts so stock allocation stays in sync
      const newWeightPerBaleKg = req.body.weightPerBaleKg;
      if (newWeightPerBaleKg !== undefined && newWeightPerBaleKg !== "" && existingLine.articleCode) {
        await db
          .update(factoryBaleProducts)
          .set({ weightPerBaleKg: String(newWeightPerBaleKg) })
          .where(
            and(
              eq(factoryBaleProducts.companyId, companyId),
              eq(factoryBaleProducts.articleCode, existingLine.articleCode)
            )
          );
      }

      // factory_v2: warn if quantity increase exceeds free-to-promise (non-blocking)
      let stockWarning: string | undefined;
      if (updateData.quantity !== undefined && (await isFactoryV2Company(companyId))) {
        const delta = updateData.quantity - Number(existingLine.quantity);
        if (delta > 0) {
          const ftp = await computeFreeToPromise(companyId, existingLine.articleCode);
          if (delta > ftp) {
            stockWarning = `Insufficient free stock for ${existingLine.articleCode}: need ${delta} more, available ${ftp}`;
          }
        }
      }

      if (updateData.quantity !== undefined) {
        console.log(
          `[proforma-line PUT] lineId=${id} proformaId=${existingLine.proformaId} articleCode=${existingLine.articleCode} oldQty=${existingLine.quantity} newQty=${updateData.quantity}`
        );
      }

      const [updated] = await db
        .update(customerProformaLines)
        .set(updateData)
        .where(eq(customerProformaLines.id, id))
        .returning();

      if (!updated) return res.status(404).json({ message: "Proforma line not found" });
      // Sync — quantity change alters reservedNotYetLoaded
      await syncProformaReservations(db, companyId, existingLine.proformaId);

      // Auto-save price to customer price list if price was part of the update
      if (updateData.pricePerBale !== undefined && existingLine.articleCode) {
        const [proforma] = await db
          .select({ customerId: customerProformas.customerId })
          .from(customerProformas)
          .where(eq(customerProformas.id, existingLine.proformaId))
          .limit(1);
        if (proforma?.customerId) {
          await autoSavePriceToPriceList(
            companyId,
            proforma.customerId,
            existingLine.articleCode,
            updateData.pricePerBale
          ).catch(() => {});
        }
      }

      // Auto-reprice active orders: when pricingMode or pricePerKg changes on a proforma line,
      // immediately update price_used on all matching bales in LOADING/PENDING_VERIFICATION orders
      // and recalculate order totals so the list view shows the correct amount without a manual repair.
      const pricingChanged =
        updateData.pricingMode !== undefined ||
        updateData.pricePerKg !== undefined ||
        (newWeightPerBaleKg !== undefined && newWeightPerBaleKg !== "");
      if (pricingChanged && existingLine.articleCode) {
        try {
          const effectivePricingMode = updateData.pricingMode ?? updated.pricingMode ?? "per_bale";
          const effectivePricePerKg = updateData.pricePerKg ?? updated.pricePerKg ?? null;
          if (effectivePricingMode === "per_kg" && effectivePricePerKg) {
            const pkgRate = parseFloat(String(effectivePricePerKg));
            if (pkgRate > 0) {
              // Find active orders that use this proforma
              const activeOrders = await db
                .select({ id: customerOrders.id })
                .from(customerOrders)
                .where(
                  and(
                    eq(customerOrders.proformaIdUsed, existingLine.proformaId),
                    sql`${customerOrders.status} IN ('LOADING', 'PENDING_VERIFICATION')`
                  )
                );
              for (const order of activeOrders) {
                // Fetch bales for this article in this order
                const bales = await db
                  .select({ id: customerOrderBales.id, weight: customerOrderBales.weight })
                  .from(customerOrderBales)
                  .where(
                    and(
                      eq(customerOrderBales.orderId, order.id),
                      eq(customerOrderBales.articleCode, existingLine.articleCode)
                    )
                  );
                for (const bale of bales) {
                  const wt = parseFloat(String(bale.weight || "0"));
                  if (!isNaN(wt) && wt > 0) {
                    await db
                      .update(customerOrderBales)
                      .set({ priceUsed: (wt * pkgRate).toFixed(2) })
                      .where(eq(customerOrderBales.id, bale.id));
                  }
                }
                await recalculateOrderTotals(db, order.id);
              }
            }
          }
        } catch (_e) {
          /* non-blocking */
        }
      }

      res.json({ ...updated, ...(stockWarning ? { stockWarning } : {}) });
    } catch (error: any) {
      console.error("Error updating proforma line:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/factory/customer-proforma-lines/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });

      // Fetch the line first to get its proformaId before deletion
      const [lineToDelete] = await db
        .select()
        .from(customerProformaLines)
        .where(eq(customerProformaLines.id, id))
        .limit(1);
      if (!lineToDelete) return res.status(404).json({ message: "Proforma line not found" });

      const [deleted] = await db.delete(customerProformaLines).where(eq(customerProformaLines.id, id)).returning();
      if (!deleted) return res.status(404).json({ message: "Proforma line not found" });
      // Sync — removed line releases its reservation
      await syncProformaReservations(db, companyId, lineToDelete.proformaId);
      res.json({ message: "Proforma line deleted" });
    } catch (error: any) {
      console.error("Error deleting proforma line:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-proformas/bulk", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { customerId, name, isActive, lines } = req.body;
      if (!customerId || !name || !Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({
          message: `customerId, name, and at least one line are required. Got: customerId=${customerId}, name=${name}, lines=${Array.isArray(lines) ? lines.length : "not array"}`,
        });
      }

      const validLines = lines.filter((l: any) => l.articleCode && l.productName && parseInt(l.quantity) > 0);
      if (validLines.length === 0) {
        return res
          .status(400)
          .json({ message: "At least one line must have articleCode, productName, and quantity > 0" });
      }

      const parsed = insertCustomerProformaSchema.parse({ companyId, customerId, name, isActive: isActive || false });

      const result = await db.transaction(async (tx: any) => {
        const [proforma] = await tx.insert(customerProformas).values(parsed).returning();

        const lineValues = validLines.map((l: any) => ({
          proformaId: proforma.id,
          articleCode: l.articleCode,
          productName: l.productName,
          quantity: parseInt(l.quantity),
          pricePerBale: String(l.pricePerBale || "0"),
          productionPricePerBale: String(l.productionPricePerBale || "0"),
          pricingMode: l.pricingMode ?? "per_bale",
          pricePerKg:
            l.pricingMode === "per_kg" && l.pricePerKg != null && l.pricePerKg !== "" ? String(l.pricePerKg) : null,
        }));

        const insertedLines = await tx.insert(customerProformaLines).values(lineValues).returning();

        return { ...proforma, lines: insertedLines };
      });

      // Sync outside transaction — reservations are derived, not transactional
      await syncProformaReservations(db, companyId, result.id);

      // Auto-save all line prices to customer price list
      for (const l of validLines) {
        if (l.articleCode && l.pricePerBale) {
          await autoSavePriceToPriceList(companyId, customerId, l.articleCode, l.pricePerBale).catch(() => {});
        }
      }

      res.json(result);
    } catch (error: any) {
      console.error("Error bulk creating proforma:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.put("/api/factory/customer-proformas/:id/replace-lines", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const [proforma] = await db
        .select()
        .from(customerProformas)
        .where(and(eq(customerProformas.id, id), eq(customerProformas.companyId, companyId)));
      if (!proforma) return res.status(404).json({ message: "Proforma not found" });

      const { lines } = req.body;
      if (!Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ message: "At least one line is required" });
      }

      const validLines = lines.filter((l: any) => l.articleCode && l.productName && parseInt(l.quantity) > 0);
      if (validLines.length === 0) {
        return res
          .status(400)
          .json({ message: "At least one line must have articleCode, productName, and quantity > 0" });
      }

      const result = await db.transaction(async (tx: any) => {
        await tx.delete(customerProformaLines).where(eq(customerProformaLines.proformaId, id));
        const lineValues = validLines.map((l: any) => ({
          proformaId: id,
          articleCode: l.articleCode,
          productName: l.productName,
          quantity: parseInt(l.quantity),
          pricePerBale: String(l.pricePerBale || "0"),
          pricingMode: l.pricingMode ?? "per_bale",
          pricePerKg:
            l.pricingMode === "per_kg" && l.pricePerKg != null && l.pricePerKg !== "" ? String(l.pricePerKg) : null,
        }));
        const insertedLines = await tx.insert(customerProformaLines).values(lineValues).returning();
        return { ...proforma, lines: insertedLines };
      });

      // Sync — all lines replaced, recalculate reservation state
      await syncProformaReservations(db, companyId, id);
      res.json(result);
    } catch (error: any) {
      console.error("Error replacing proforma lines:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-proformas/:id/apply-catalog-prices", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });

      const lines = await db.select().from(customerProformaLines).where(eq(customerProformaLines.proformaId, id));
      if (!lines.length) return res.json({ updated: 0, skipped: 0 });

      const products = await db.select().from(factoryBaleProducts).where(eq(factoryBaleProducts.companyId, companyId));
      const priceByArticleCode = new Map<string, string>();
      for (const p of products) {
        if (p.articleCode && p.sellingPrice && parseFloat(String(p.sellingPrice)) > 0) {
          priceByArticleCode.set(p.articleCode.toLowerCase(), String(p.sellingPrice));
        }
      }

      let updated = 0;
      let skipped = 0;
      let fixed = 0;
      for (const line of lines) {
        if ((line as any).priceFixed) {
          fixed++;
          continue;
        }
        const newPrice = priceByArticleCode.get((line.articleCode || "").toLowerCase());
        if (newPrice) {
          await db
            .update(customerProformaLines)
            .set({ pricePerBale: newPrice })
            .where(eq(customerProformaLines.id, line.id));
          updated++;
        } else {
          skipped++;
        }
      }

      res.json({ updated, skipped, fixed });
    } catch (error: any) {
      console.error("Error applying catalog prices:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Apply production price from catalogue to all non-fixed lines
  app.post("/api/factory/customer-proformas/:id/apply-production-prices", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });

      const lines = await db.select().from(customerProformaLines).where(eq(customerProformaLines.proformaId, id));
      if (!lines.length) return res.json({ updated: 0, skipped: 0 });

      const products = await db.select().from(factoryBaleProducts).where(eq(factoryBaleProducts.companyId, companyId));
      const priceByArticleCode = new Map<string, string>();
      for (const p of products) {
        if (p.articleCode && p.productionPrice && parseFloat(String(p.productionPrice)) > 0) {
          priceByArticleCode.set(p.articleCode.toLowerCase(), String(p.productionPrice));
        }
      }

      let updated = 0;
      let skipped = 0;
      let fixed = 0;
      for (const line of lines) {
        if ((line as any).priceFixed) { fixed++; continue; }
        const newPrice = priceByArticleCode.get((line.articleCode || "").toLowerCase());
        if (newPrice) {
          await db.update(customerProformaLines).set({ pricePerBale: newPrice }).where(eq(customerProformaLines.id, line.id));
          updated++;
        } else {
          skipped++;
        }
      }

      res.json({ updated, skipped, fixed });
    } catch (error: any) {
      console.error("Error applying production prices:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Transfer a proforma to a different customer
  app.patch("/api/factory/customer-proformas/:id/transfer", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const { targetCustomerId } = req.body;
      if (!targetCustomerId) return res.status(400).json({ message: "targetCustomerId is required" });

      const [proforma] = await db
        .select()
        .from(customerProformas)
        .where(and(eq(customerProformas.id, id), eq(customerProformas.companyId, companyId)));
      if (!proforma) return res.status(404).json({ message: "Proforma not found" });

      const newCustomerId = parseInt(targetCustomerId);
      if (newCustomerId === proforma.customerId) {
        return res.status(400).json({ message: "Target customer is the same as the current customer" });
      }

      // Verify target customer belongs to this company
      const [targetCustomer] = await db
        .select({ id: customers.id, legalName: customers.legalName })
        .from(customers)
        .where(and(eq(customers.id, newCustomerId), eq(customers.companyId, companyId)));
      if (!targetCustomer) return res.status(404).json({ message: "Target customer not found" });

      // Check for name conflict on target customer
      const [conflict] = await db
        .select({ id: customerProformas.id })
        .from(customerProformas)
        .where(
          and(
            eq(customerProformas.companyId, companyId),
            eq(customerProformas.customerId, newCustomerId),
            eq(customerProformas.name, proforma.name)
          )
        );
      if (conflict) {
        return res.status(409).json({
          message: `Customer "${targetCustomer.legalName}" already has a proforma named "${proforma.name}". Rename it first before transferring.`,
        });
      }

      const [updated] = await db
        .update(customerProformas)
        .set({ customerId: newCustomerId, updatedAt: new Date() })
        .where(and(eq(customerProformas.id, id), eq(customerProformas.companyId, companyId)))
        .returning();

      const [fromCustomer] = await db
        .select({ legalName: customers.legalName })
        .from(customers)
        .where(eq(customers.id, proforma.customerId));

      console.log(
        `[PROFORMA TRANSFER] id=${id} name="${proforma.name}" from customer ${proforma.customerId} ("${fromCustomer?.legalName}") → ${newCustomerId} ("${targetCustomer.legalName}")`
      );

      res.json({ ...updated, targetCustomerName: targetCustomer.legalName });
    } catch (error: any) {
      console.error("Error transferring proforma:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Toggle price_fixed flag on a proforma line
  app.patch("/api/factory/customer-proforma-lines/:lineId/toggle-fixed", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const lineId = parseId(req.params.lineId);
      if (lineId === null) return res.status(400).json({ message: "Invalid id" });
      const [line] = await db.select().from(customerProformaLines).where(eq(customerProformaLines.id, lineId)).limit(1);
      if (!line) return res.status(404).json({ message: "Line not found" });
      const [updated] = await db
        .update(customerProformaLines)
        .set({ priceFixed: !(line as any).priceFixed })
        .where(eq(customerProformaLines.id, lineId))
        .returning();
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─── Stock Allocation endpoints ─────────────────────────────────────────────

  // GET /api/factory/stock-allocation — returns all article codes with IN_STOCK bale counts,
  // all proformas with their lines, existing reservations, and LOADING/PENDING_VERIFICATION/VERIFIED order quantities
  app.get("/api/factory/stock-allocation", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // 1. All proformas for this company
      const allProformas = await db
        .select({
          id: customerProformas.id,
          companyId: customerProformas.companyId,
          customerId: customerProformas.customerId,
          name: customerProformas.name,
          isActive: customerProformas.isActive,
          createdAt: customerProformas.createdAt,
        })
        .from(customerProformas)
        .where(eq(customerProformas.companyId, companyId))
        .orderBy(customerProformas.createdAt);

      const proformaIds = allProformas.map((p: any) => p.id);
      let allLines: any[] = [];
      if (proformaIds.length > 0) {
        allLines = await db
          .select({
            id: customerProformaLines.id,
            proformaId: customerProformaLines.proformaId,
            articleCode: customerProformaLines.articleCode,
            productName: customerProformaLines.productName,
            quantity: customerProformaLines.quantity,
            pricePerBale: customerProformaLines.pricePerBale,
          })
          .from(customerProformaLines)
          .where(inArray(customerProformaLines.proformaId, proformaIds));
      }

      // 2. IN_STOCK bale counts grouped by articleCode
      const inStockCountsRaw = await db.execute(
        sql`SELECT article_code as "articleCode", COUNT(*)::int as count FROM factory_bales WHERE company_id = ${companyId} AND status = 'IN_STOCK' GROUP BY article_code`
      );
      const inStockCounts = (inStockCountsRaw.rows || (inStockCountsRaw as unknown as any[])).map((r: any) => ({
        articleCode: r.articleCode,
        count: Number(r.count),
      }));

      // 3. Existing reservations for this company
      const reservations = await db
        .select({
          id: proformaStockReservations.id,
          companyId: proformaStockReservations.companyId,
          proformaId: proformaStockReservations.proformaId,
          articleCode: proformaStockReservations.articleCode,
        })
        .from(proformaStockReservations)
        .where(eq(proformaStockReservations.companyId, companyId));

      // 4. Active orders (LOADING, PENDING_VERIFICATION, VERIFIED)
      const activeOrdersRaw = await db.execute(
        sql`SELECT id, proforma_id_used as "proformaIdUsed", status FROM customer_orders WHERE company_id = ${companyId} AND status IN ('LOADING','PENDING_VERIFICATION','VERIFIED')`
      );
      const activeOrders = (activeOrdersRaw.rows || (activeOrdersRaw as unknown as any[])).map((o: any) => ({
        id: o.id,
        proformaIdUsed: o.proformaIdUsed,
        status: o.status,
      }));

      // For active orders, get bale article code counts from customer_order_bales
      let activeOrderBales: any[] = [];
      if (activeOrders.length > 0) {
        const orderIds = activeOrders.map((o: any) => o.id);
        const activeOrderBalesRaw = await db.execute(
          sql`SELECT order_id as "orderId", article_code as "articleCode", COUNT(*)::int as count FROM customer_order_bales WHERE order_id = ANY(${sqlArray(orderIds)}) GROUP BY order_id, article_code`
        );
        activeOrderBales = (activeOrderBalesRaw.rows || (activeOrderBalesRaw as unknown as any[])).map((b: any) => ({
          orderId: b.orderId,
          articleCode: b.articleCode,
          count: Number(b.count),
        }));
      }

      // 5. Customers lookup — use legalName (the customers table has no "name" column)
      const allCustomerIds = [...new Set(allProformas.map((p: any) => p.customerId))].filter(
        (id): id is number => id != null && !isNaN(Number(id))
      );
      let customerRows: any[] = [];
      if (allCustomerIds.length > 0) {
        customerRows = await db
          .select({ id: customers.id, legalName: customers.legalName })
          .from(customers)
          .where(inArray(customers.id, allCustomerIds));
      }
      const customerMap = new Map(customerRows.map((c: any) => [c.id, c.legalName]));

      // 6. Product names for all in-stock article codes (fills in names for codes not in any proforma)
      const allArticleCodes = [
        ...new Set([...inStockCounts.map((s: any) => s.articleCode), ...allLines.map((l: any) => l.articleCode)]),
      ];
      const productNamesMap: Record<string, string> = {};
      if (allArticleCodes.length > 0) {
        const prodRaw = await db.execute(
          sql`SELECT DISTINCT ON (article_code) article_code as "articleCode", name
              FROM factory_bale_products
              WHERE company_id = ${companyId}
                AND article_code = ANY(${sqlArray(allArticleCodes)})
              ORDER BY article_code`
        );
        (prodRaw.rows || (prodRaw as unknown as any[])).forEach((r: any) => {
          if (r.name) productNamesMap[r.articleCode] = r.name;
        });
      }

      res.json({
        proformas: allProformas.map((p: any) => ({
          id: p.id,
          companyId: p.companyId,
          customerId: p.customerId,
          name: p.name,
          isActive: p.isActive,
          createdAt: p.createdAt,
          customerName: customerMap.get(p.customerId) || `Customer #${p.customerId}`,
          lines: allLines.filter((l: any) => l.proformaId === p.id),
        })),
        inStockCounts,
        productNames: productNamesMap,
        reservations,
        activeOrders: activeOrders.map((o: any) => ({
          id: o.id,
          proformaIdUsed: o.proformaIdUsed,
          status: o.status,
          balesByArticle: activeOrderBales
            .filter((b: any) => b.orderId === o.id)
            .map((b: any) => ({ articleCode: b.articleCode, count: b.count })),
        })),
      });
    } catch (error: any) {
      console.error("Error fetching stock allocation:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/stock-allocation/loading-mode — returns active loadings with per-article bale counts
  app.get("/api/factory/stock-allocation/loading-mode", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // 1. Free bale counts (truly available, not assigned to any order)
      const freeStockRaw = await db.execute(
        sql`SELECT article_code as "articleCode", COUNT(*)::int as count
            FROM factory_bales
            WHERE company_id = ${companyId} AND status = 'IN_STOCK'
            GROUP BY article_code`
      );
      const freeStockCounts: { articleCode: string; count: number }[] = (
        freeStockRaw.rows || (freeStockRaw as unknown as any[])
      ).map((r: any) => ({
        articleCode: r.articleCode,
        count: Number(r.count),
      }));
      const freeStockMap = new Map(freeStockCounts.map((s) => [s.articleCode, s.count]));

      // 2. Active loadings (LOADING + PENDING_VERIFICATION)
      const loadingsRaw = await db.execute(
        sql`SELECT id, customer_id as "customerId", container_number as "containerNumber", status,
                   proforma_id_used as "proformaIdUsed"
            FROM customer_orders
            WHERE company_id = ${companyId} AND status IN ('LOADING','PENDING_VERIFICATION')
            ORDER BY id`
      );
      const loadings: {
        id: number;
        customerId: number;
        containerNumber: string | null;
        status: string;
        proformaIdUsed: number | null;
      }[] = (loadingsRaw.rows || (loadingsRaw as unknown as any[])).map((r: any) => ({
        id: r.id,
        customerId: r.customerId,
        containerNumber: r.containerNumber || null,
        status: r.status,
        proformaIdUsed: r.proformaIdUsed || null,
      }));

      // 3. Bale counts per loading per article code
      let loadingBales: { orderId: number; articleCode: string; count: number }[] = [];
      if (loadings.length > 0) {
        const ids = loadings.map((l: any) => l.id);
        const balesRaw = await db.execute(
          sql`SELECT cob.order_id as "orderId", fb.article_code as "articleCode", COUNT(*)::int as count
              FROM customer_order_bales cob
              JOIN factory_bales fb ON fb.id = cob.bale_id
              WHERE cob.order_id = ANY(${sqlArray(ids)})
              GROUP BY cob.order_id, fb.article_code`
        );
        loadingBales = (balesRaw.rows || (balesRaw as unknown as any[])).map((r: any) => ({
          orderId: r.orderId,
          articleCode: r.articleCode,
          count: Number(r.count),
        }));
      }

      // 3b. Proforma target quantities for each loading (via proformaIdUsed)
      const proformaIds = [...new Set(loadings.map((l: any) => l.proformaIdUsed))].filter(
        (id): id is number => id != null
      );
      let proformaLines: { proformaId: number; articleCode: string; quantity: number }[] = [];
      if (proformaIds.length > 0) {
        const plRaw = await db
          .select({
            proformaId: customerProformaLines.proformaId,
            articleCode: customerProformaLines.articleCode,
            quantity: customerProformaLines.quantity,
          })
          .from(customerProformaLines)
          .where(inArray(customerProformaLines.proformaId, proformaIds));
        proformaLines = plRaw.map((r: any) => ({
          proformaId: r.proformaId,
          articleCode: r.articleCode,
          quantity: Number(r.quantity),
        }));
      }

      // 4. Customer names
      const customerIds = [...new Set(loadings.map((l: any) => l.customerId))].filter((id): id is number => id != null);
      const customerMap = new Map<number, string>();
      if (customerIds.length > 0) {
        const custRows = await db
          .select({ id: customers.id, legalName: customers.legalName })
          .from(customers)
          .where(inArray(customers.id, customerIds));
        custRows.forEach((c: any) => customerMap.set(c.id, c.legalName));
      }

      // 5. Build total stock counts = free IN_STOCK + reserved in active loadings per article
      const totalStockMap = new Map<string, number>(freeStockMap);
      for (const b of loadingBales) {
        totalStockMap.set(b.articleCode, (totalStockMap.get(b.articleCode) || 0) + b.count);
      }
      const totalStockCounts = Array.from(totalStockMap.entries()).map(([articleCode, count]) => ({
        articleCode,
        count,
      }));

      // 6. Product name lookup from factory_bale_products
      //    Include all article codes: free stock, scanned bales, AND proforma targets.
      //    Filter by company_id to prevent name bleed-in from other companies.
      const articleCodeSet = new Set<string>([
        ...freeStockCounts.map((s: any) => s.articleCode),
        ...loadingBales.map((b: any) => b.articleCode),
        ...proformaLines.map((pl: any) => pl.articleCode),
      ]);
      const productNameByCode = new Map<string, string>();
      if (articleCodeSet.size > 0) {
        const codes = Array.from(articleCodeSet);
        const prodRaw = await db.execute(
          sql`SELECT DISTINCT ON (fbp.article_code) fbp.article_code as "articleCode", fbp.name
              FROM factory_bale_products fbp
              WHERE fbp.company_id = ${companyId}
                AND fbp.article_code = ANY(${sqlArray(codes)})
              ORDER BY fbp.article_code`
        );
        (prodRaw.rows || (prodRaw as unknown as any[])).forEach((r: any) => {
          if (r.name) productNameByCode.set(r.articleCode, r.name);
        });
      }

      res.json({
        // totalStockCounts: free IN_STOCK + reserved-in-loading — shown in "In Stock" column
        inStockCounts: totalStockCounts,
        // freeStockCounts: truly free bales — used to compute Remaining on the frontend
        freeStockCounts: freeStockCounts,
        loadings: loadings.map((l: any) => ({
          id: l.id,
          customerId: l.customerId,
          customerName: customerMap.get(l.customerId) || `Customer #${l.customerId}`,
          containerNumber: l.containerNumber,
          status: l.status,
          // balesByArticle: actual bales already scanned into this order
          balesByArticle: loadingBales
            .filter((b: any) => b.orderId === l.id)
            .map((b: any) => ({ articleCode: b.articleCode, count: b.count })),
          // proformaTargets: proforma line quantities (the target to load)
          proformaTargets: l.proformaIdUsed
            ? proformaLines
                .filter((pl: any) => pl.proformaId === l.proformaIdUsed)
                .map((pl: any) => ({ articleCode: pl.articleCode, quantity: pl.quantity }))
            : [],
        })),
        productNames: Object.fromEntries(productNameByCode),
      });
    } catch (error: any) {
      console.error("Error fetching loading-mode stock allocation:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/stock-allocation/reservations/toggle — toggle a reservation on/off
  app.post("/api/factory/stock-allocation/reservations/toggle", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { proformaId, articleCode } = req.body;
      if (!proformaId || !articleCode) return res.status(400).json({ message: "proformaId and articleCode required" });

      // Check if reservation exists
      const [existing] = await db
        .select()
        .from(proformaStockReservations)
        .where(
          and(
            eq(proformaStockReservations.companyId, companyId),
            eq(proformaStockReservations.proformaId, proformaId),
            eq(proformaStockReservations.articleCode, articleCode)
          )
        )
        .limit(1);

      if (existing) {
        await db.delete(proformaStockReservations).where(eq(proformaStockReservations.id, existing.id));
        res.json({ reserved: false });
      } else {
        await db.insert(proformaStockReservations).values({ companyId, proformaId, articleCode });
        res.json({ reserved: true });
      }
    } catch (error: any) {
      console.error("Error toggling reservation:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ─── End Stock Allocation ─────────────────────────────────────────────────────

  app.get("/api/factory/customer-proformas/:id/export/excel", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const [proforma] = await db
        .select()
        .from(customerProformas)
        .where(and(eq(customerProformas.id, id), eq(customerProformas.companyId, companyId)));
      if (!proforma) return res.status(404).json({ message: "Proforma not found" });

      const rawLines = await db.select().from(customerProformaLines).where(eq(customerProformaLines.proformaId, id));

      const [customer] = await db.select().from(customers).where(eq(customers.id, proforma.customerId));
      const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
      const [settings] = await db
        .select()
        .from(companySettings)
        .where(eq(companySettings.companyId, companyId))
        .catch(() => [null]);

      // Fetch weight per bale + canonical name from factoryBaleProducts by articleCode
      const articleCodes = [...new Set(rawLines.map((l: any) => l.articleCode).filter(Boolean))];
      const wMap = new Map<string, number>();
      const nameMap = new Map<string, string>();
      if (articleCodes.length > 0) {
        const prods = await db
          .select({
            articleCode: factoryBaleProducts.articleCode,
            weightPerBaleKg: factoryBaleProducts.weightPerBaleKg,
            name: factoryBaleProducts.name,
          })
          .from(factoryBaleProducts)
          .where(
            and(
              eq(factoryBaleProducts.companyId, companyId),
              inArray(factoryBaleProducts.articleCode, articleCodes as string[])
            )
          );
        prods.forEach((p: any) => {
          if (p.articleCode) {
            wMap.set(p.articleCode, parseFloat(p.weightPerBaleKg || "0"));
            nameMap.set(p.articleCode, p.name || "");
          }
        });
      }

      const { hideProformaPrice: hideSellingExcel } = await getExportPriceVisibility(req);

      const baseCurrency = (company as any)?.baseCurrency || "USD";
      const currencySymbolMap: Record<string, string> = {
        USD: "$ ",
        GBP: "£",
        EUR: "€",
        CFA: "CFA ",
        XOF: "CFA ",
        XAF: "CFA ",
        CAD: "CA$ ",
        AUD: "A$ ",
        CHF: "CHF ",
        JPY: "¥",
        INR: "₹",
        AED: "AED ",
        MXN: "MX$ ",
        BRL: "R$ ",
        ZAR: "R",
        SGD: "S$ ",
        HKD: "HK$ ",
        NOK: "kr ",
        SEK: "kr ",
        DKK: "kr ",
      };
      const currSym = currencySymbolMap[baseCurrency.toUpperCase()] ?? baseCurrency + " ";
      const fmtPrice = (n: number) => currSym + (n % 1 === 0 ? n.toLocaleString() : n.toFixed(2));
      const fmtKg = (n: number) => (n % 1 === 0 ? String(n) : n.toFixed(2));

      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Proforma Invoice");

      const COL_COUNT = hideSellingExcel ? 6 : 8;
      const baseCols: any[] = [
        { key: "num", width: 6 },
        { key: "articleCode", width: 18 },
        { key: "productName", width: 32 },
        { key: "qty", width: 12 },
        { key: "kgPerBale", width: 13 },
      ];
      if (!hideSellingExcel) baseCols.push({ key: "pricePerBale", width: 14 });
      baseCols.push({ key: "totalKg", width: 13 });
      if (!hideSellingExcel) baseCols.push({ key: "totalPrice", width: 15 });
      sheet.columns = baseCols;

      try {
        const pxLogo = path.join(process.cwd(), "server", "hmd-logo.png");
        if (fs.existsSync(pxLogo)) {
          const pxBuf = fs.readFileSync(pxLogo);
          const pxId = workbook.addImage({ buffer: pxBuf as Buffer, extension: "jpeg" });
          const pxLogoRow = sheet.addRow([]);
          pxLogoRow.height = 90;
          sheet.addImage(pxId, { tl: { col: 2.5, row: 0 }, ext: { width: 300, height: 90 } });
        }
      } catch {}
      const r1 = sheet.addRow(["HMD INTERNATIONAL GROUP"]);
      r1.getCell(1).font = { bold: true, size: 16, color: { argb: "FF1F3864" } };
      r1.getCell(1).alignment = { horizontal: "center" };
      sheet.mergeCells(r1.number, 1, r1.number, COL_COUNT);

      const r2 = sheet.addRow([`Customer: ${customer?.legalName || "N/A"}`]);
      r2.getCell(1).font = { size: 11 };
      sheet.mergeCells(r2.number, 1, r2.number, COL_COUNT);

      const dateStr = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
      const r3 = sheet.addRow([`Date: ${dateStr}`]);
      r3.getCell(1).font = { size: 10, color: { argb: "FF555555" } };
      sheet.mergeCells(r3.number, 1, r3.number, COL_COUNT);

      const r4 = sheet.addRow([`Proforma: ${proforma.name}`]);
      r4.getCell(1).font = { size: 10, color: { argb: "FF555555" } };
      sheet.mergeCells(r4.number, 1, r4.number, COL_COUNT);

      sheet.addRow([]);

      const hdrCells = ["#", "Article Code", "Product Name", "Qty (Bales)", "Kg / Bale"];
      if (!hideSellingExcel) hdrCells.push("Price / Bale");
      hdrCells.push("Total KG");
      if (!hideSellingExcel) hdrCells.push("Total Price");
      const hdrRow = sheet.addRow(hdrCells);
      hdrRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
        cell.alignment = { horizontal: "center" };
      });

      let totalQty = 0,
        totalKgAll = 0,
        totalPriceAll = 0;
      rawLines.forEach((line: any, idx: number) => {
        const qty = parseInt(String(line.quantity));
        const kgPerBale = wMap.get(line.articleCode) || 0;
        const price = parseFloat(String(line.pricePerBale));
        const totalKg = qty * kgPerBale;
        const totalPrice = qty * price;
        totalQty += qty;
        totalKgAll += totalKg;
        totalPriceAll += totalPrice;

        const rowArr: any[] = [
          idx + 1,
          line.articleCode,
          nameMap.get(line.articleCode) || line.productName || "",
          qty,
          fmtKg(kgPerBale),
        ];
        if (!hideSellingExcel) rowArr.push(fmtPrice(price));
        rowArr.push(fmtKg(totalKg));
        if (!hideSellingExcel) rowArr.push(fmtPrice(totalPrice));
        const dr = sheet.addRow(rowArr);
        dr.getCell(4).alignment = { horizontal: "right" };
        dr.getCell(5).alignment = { horizontal: "right" };
        dr.getCell(6).alignment = { horizontal: "right" };
        if (!hideSellingExcel) {
          dr.getCell(7).alignment = { horizontal: "right" };
          dr.getCell(8).alignment = { horizontal: "right" };
        }
        if (idx % 2 === 1) {
          dr.eachCell((cell) => {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } };
          });
        }
      });

      sheet.addRow([]);
      const totArr: any[] = ["", "", "GRAND TOTAL", totalQty, ""];
      if (!hideSellingExcel) totArr.push("");
      totArr.push(fmtKg(totalKgAll));
      if (!hideSellingExcel) totArr.push(fmtPrice(totalPriceAll));
      const totRow = sheet.addRow(totArr);
      totRow.eachCell((cell) => {
        cell.font = { bold: true };
      });
      totRow.getCell(4).alignment = { horizontal: "right" };
      totRow.getCell(hideSellingExcel ? 6 : 7).alignment = { horizontal: "right" };
      if (!hideSellingExcel) totRow.getCell(8).alignment = { horizontal: "right" };

      // Build buffer BEFORE setting headers so ExcelJS errors can still return a clean JSON 500.
      const xlsBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", contentDisposition(buildSafeFilename(["proforma", proforma.name], "xlsx")));
      res.setHeader("Content-Length", xlsBuffer.byteLength);
      res.end(xlsBuffer);
    } catch (error: any) {
      console.error("Error exporting proforma to Excel:", error);
      if (!res.headersSent) res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/customer-proformas/:id/export/pdf", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const [proforma] = await db
        .select()
        .from(customerProformas)
        .where(and(eq(customerProformas.id, id), eq(customerProformas.companyId, companyId)));
      if (!proforma) return res.status(404).json({ message: "Proforma not found" });

      const rawLines = await db.select().from(customerProformaLines).where(eq(customerProformaLines.proformaId, id));

      const [customer] = await db.select().from(customers).where(eq(customers.id, proforma.customerId));
      const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
      const [settings] = await db
        .select()
        .from(companySettings)
        .where(eq(companySettings.companyId, companyId))
        .catch(() => [null]);

      // Fetch weight per bale + canonical name from factoryBaleProducts by articleCode
      const articleCodes = [...new Set(rawLines.map((l: any) => l.articleCode).filter(Boolean))];
      const wMap = new Map<string, number>();
      const nameMap = new Map<string, string>();
      if (articleCodes.length > 0) {
        const prods = await db
          .select({
            articleCode: factoryBaleProducts.articleCode,
            weightPerBaleKg: factoryBaleProducts.weightPerBaleKg,
            name: factoryBaleProducts.name,
          })
          .from(factoryBaleProducts)
          .where(
            and(
              eq(factoryBaleProducts.companyId, companyId),
              inArray(factoryBaleProducts.articleCode, articleCodes as string[])
            )
          );
        prods.forEach((p: any) => {
          if (p.articleCode) {
            wMap.set(p.articleCode, parseFloat(p.weightPerBaleKg || "0"));
            nameMap.set(p.articleCode, p.name || "");
          }
        });
      }

      const { hideProformaPrice: hideSellingPdf } = await getExportPriceVisibility(req);

      const baseCurrencyPdf = (company as any)?.baseCurrency || "USD";
      const currencySymbolMapPdf: Record<string, string> = {
        USD: "$ ",
        GBP: "£",
        EUR: "€",
        CFA: "CFA ",
        XOF: "CFA ",
        XAF: "CFA ",
        CAD: "CA$ ",
        AUD: "A$ ",
        CHF: "CHF ",
        JPY: "¥",
        INR: "₹",
        AED: "AED ",
        MXN: "MX$ ",
        BRL: "R$ ",
        ZAR: "R",
        SGD: "S$ ",
        HKD: "HK$ ",
        NOK: "kr ",
        SEK: "kr ",
        DKK: "kr ",
      };
      const currSymPdf = currencySymbolMapPdf[baseCurrencyPdf.toUpperCase()] ?? baseCurrencyPdf + " ";
      const fmtPricePdf = (n: number) => currSymPdf + (n % 1 === 0 ? n.toLocaleString() : n.toFixed(2));
      const fmtKgPdf = (n: number) => (n % 1 === 0 ? String(n) : n.toFixed(2));

      const PDFDocument = (await import("pdfkit")).default;
      const fs = await import("fs");

      const doc = new PDFDocument({ margin: 40, size: "A4" });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", contentDisposition(buildSafeFilename(["proforma", proforma.name], "pdf")));
      doc.pipe(res);

      // ── Header ──
      const hmdProformaLogo = path.join(process.cwd(), "server", "hmd-logo.png");
      const headerY = 40;

      const logoW = 220;
      if (fs.existsSync(hmdProformaLogo)) {
        try {
          doc.image(hmdProformaLogo, (doc.page.width - logoW) / 2, headerY, { width: logoW });
        } catch {}
      }
      // Title goes below the logo — use doc.y which pdfkit advances after placing the image
      const titleY = Math.max(doc.y, headerY + 10) + 6;
      doc
        .fontSize(10)
        .font("Helvetica")
        .fillColor("#555555")
        .text("PROFORMA INVOICE", 40, titleY, { width: 515, align: "center" });

      const headerBottom = doc.y + 4;
      doc
        .moveTo(40, headerBottom + 4)
        .lineTo(555, headerBottom + 4)
        .lineWidth(0.5)
        .strokeColor("#cccccc")
        .stroke();
      doc.lineWidth(1).strokeColor("#000000");

      // ── Meta info ──
      const metaY = headerBottom + 12;
      const dateStr = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
      doc.fillColor("#000000").fontSize(10).font("Helvetica");
      doc
        .text(`Customer:`, 40, metaY, { continued: true })
        .font("Helvetica-Bold")
        .text(` ${customer?.legalName || "N/A"}`);
      doc
        .font("Helvetica")
        .text(`Proforma:`, 40, doc.y + 2, { continued: true })
        .font("Helvetica-Bold")
        .text(` ${proforma.name}`);
      doc
        .font("Helvetica")
        .text(`Date:`, 40, doc.y + 2, { continued: true })
        .font("Helvetica-Bold")
        .text(` ${dateStr}`);

      doc.moveDown(1);

      // ── Table ──
      // Columns: # | Article Code | Product Name | Qty | Kg/Bale | [Price/Bale] | Total KG | [Total Price]
      // x positions (left edge), total usable width = 515 (40..555)
      let colX: number[], colW: number[], colHdr: string[], colAlign: Array<"left" | "right" | "center">;
      if (hideSellingPdf) {
        colX = [40, 62, 132, 310, 355, 403];
        colW = [22, 70, 178, 45, 48, 152];
        colHdr = ["#", "Code", "Product Name", "Qty", "Kg/Bale", "Total KG"];
        colAlign = ["center", "center", "center", "center", "center", "center"];
      } else {
        colX = [40, 62, 132, 310, 355, 403, 455, 508];
        colW = [22, 70, 178, 45, 48, 52, 53, 47];
        colHdr = ["#", "Code", "Product Name", "Qty", "Kg/Bale", "Pr/Bale", "Total KG", "Total Price"];
        colAlign = ["center", "center", "center", "center", "center", "center", "center", "center"];
      }

      const tableTop = doc.y + 4;

      // Header row background
      doc.rect(40, tableTop, 515, 14).fill("#1F3864");
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8);
      colHdr.forEach((h, i) => {
        doc.text(h, colX[i] + 2, tableTop + 3, { width: colW[i] - 4, align: colAlign[i] });
      });

      doc.fillColor("#000000").font("Helvetica").fontSize(8);
      let y = tableTop + 16;
      let totalQty = 0,
        totalKgAll = 0,
        totalPriceAll = 0;

      rawLines.forEach((line: any, idx: number) => {
        const qty = parseInt(String(line.quantity));
        const kgPerBale = wMap.get(line.articleCode) || 0;
        const price = parseFloat(String(line.pricePerBale));
        const totalKg = qty * kgPerBale;
        const totalPrice = qty * price;
        totalQty += qty;
        totalKgAll += totalKg;
        totalPriceAll += totalPrice;

        if (y > 770) {
          doc.addPage();
          y = 40;
        }

        const rowH = 14;
        if (idx % 2 === 1) {
          doc.rect(40, y, 515, rowH).fill("#F8F8F8");
          doc.fillColor("#000000");
        }

        const vals = hideSellingPdf
          ? [
              String(idx + 1),
              line.articleCode,
              nameMap.get(line.articleCode) || line.productName || "",
              String(qty),
              fmtKgPdf(kgPerBale),
              fmtKgPdf(totalKg),
            ]
          : [
              String(idx + 1),
              line.articleCode,
              nameMap.get(line.articleCode) || line.productName || "",
              String(qty),
              fmtKgPdf(kgPerBale),
              fmtPricePdf(price),
              fmtKgPdf(totalKg),
              fmtPricePdf(totalPrice),
            ];
        vals.forEach((v, i) => {
          doc.text(v, colX[i] + 2, y + 3, { width: colW[i] - 4, align: colAlign[i] });
        });
        y += rowH;
      });

      // Separator line
      y += 2;
      doc.moveTo(40, y).lineTo(555, y).lineWidth(0.5).strokeColor("#888888").stroke();
      y += 6;
      doc.lineWidth(1).strokeColor("#000000");

      // Grand total row
      doc.rect(40, y, 515, 16).fill("#EFF3FB");
      doc.fillColor("#000000").font("Helvetica-Bold").fontSize(8);
      const totVals = hideSellingPdf
        ? ["", "", "GRAND TOTAL", String(totalQty), "", fmtKgPdf(totalKgAll)]
        : ["", "", "GRAND TOTAL", String(totalQty), "", "", fmtKgPdf(totalKgAll), fmtPricePdf(totalPriceAll)];
      totVals.forEach((v, i) => {
        if (v) doc.text(v, colX[i] + 2, y + 4, { width: colW[i] - 4, align: colAlign[i] });
      });

      doc.end();
    } catch (error: any) {
      console.error("Error exporting proforma to PDF:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // CUSTOMER PRICE LISTS (agreed prices per customer)
  // ───────────────────────────────────────────────

  // GET  /api/factory/customer-price-lists/:customerId
  app.get("/api/factory/customer-price-lists/:customerId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const customerId = parseInt(req.params.customerId, 10);
      if (isNaN(customerId)) return res.status(400).json({ message: "Invalid customerId" });
      const result = await pool.query(
        `SELECT cpl.article_code, cpl.price_per_bale, cpl.updated_at,
                COALESCE(fbp.name, '') AS item_name
         FROM customer_price_lists cpl
         LEFT JOIN factory_bale_products fbp
           ON fbp.company_id = $1 AND fbp.article_code = cpl.article_code AND fbp.deleted_at IS NULL
         WHERE cpl.company_id = $1 AND cpl.customer_id = $2
         ORDER BY cpl.article_code`,
        [companyId, customerId]
      );
      return res.json(result.rows);
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  // POST /api/factory/customer-price-lists/:customerId/from-proforma/:proformaId
  // Copies all line prices from an existing proforma into the customer's agreed price list
  app.post(
    "/api/factory/customer-price-lists/:customerId/from-proforma/:proformaId",
    requireAuth,
    async (req: any, res: any) => {
      try {
        const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });
        const customerId = parseInt(req.params.customerId, 10);
        const proformaId = parseInt(req.params.proformaId, 10);
        if (isNaN(customerId) || isNaN(proformaId)) return res.status(400).json({ message: "Invalid parameters" });

        // Verify the proforma belongs to this company & customer
        const proformaCheck = await pool.query(
          `SELECT id FROM customer_proformas WHERE id = $1 AND company_id = $2 AND customer_id = $3`,
          [proformaId, companyId, customerId]
        );
        if (!proformaCheck.rowCount || proformaCheck.rowCount === 0) {
          return res.status(404).json({ message: "Proforma not found" });
        }

        // Fetch the proforma lines
        const linesRes = await pool.query(
          `SELECT article_code, price_per_bale FROM customer_proforma_lines WHERE proforma_id = $1 AND article_code IS NOT NULL AND price_per_bale IS NOT NULL`,
          [proformaId]
        );
        if (linesRes.rows.length === 0) return res.json({ saved: 0 });

        // Upsert each line into customer_price_lists
        let saved = 0;
        let backfilled = 0;
        for (const row of linesRes.rows) {
          const price = parseFloat(row.price_per_bale);
          if (isNaN(price) || price <= 0) continue;

          // 1. Save / update the agreed price list entry
          await pool.query(
            `INSERT INTO customer_price_lists (company_id, customer_id, article_code, price_per_bale, updated_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (company_id, customer_id, article_code)
           DO UPDATE SET price_per_bale = EXCLUDED.price_per_bale, updated_at = now()`,
            [companyId, customerId, row.article_code, price]
          );
          saved++;

          // 2. Backfill ALL existing proforma lines for this customer + article_code
          //    (active and inactive, including the source proforma itself)
          const backfillRes = await pool.query(
            `UPDATE customer_proforma_lines cpl
           SET price_per_bale = $1
           FROM customer_proformas cp
           WHERE cpl.proforma_id = cp.id
             AND cp.company_id   = $2
             AND cp.customer_id  = $3
             AND cpl.article_code = $4`,
            [price, companyId, customerId, row.article_code]
          );
          backfilled += backfillRes.rowCount ?? 0;
        }
        return res.json({ saved, backfilled });
      } catch (e: any) {
        return res.status(500).json({ message: e.message });
      }
    }
  );

  // PUT /api/factory/customer-price-lists/:customerId
  // Bulk upsert — body: [{ articleCode, pricePerBale }]
  app.put("/api/factory/customer-price-lists/:customerId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const customerId = parseInt(req.params.customerId, 10);
      if (isNaN(customerId)) return res.status(400).json({ message: "Invalid customerId" });
      const lines: { articleCode: string; pricePerBale: string | number }[] = req.body;
      if (!Array.isArray(lines)) return res.status(400).json({ message: "Body must be an array" });
      let saved = 0;
      for (const line of lines) {
        if (!line.articleCode) continue;
        const price = parseFloat(String(line.pricePerBale));
        if (isNaN(price) || price <= 0) continue;
        await pool.query(
          `INSERT INTO customer_price_lists (company_id, customer_id, article_code, price_per_bale, updated_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (company_id, customer_id, article_code)
           DO UPDATE SET price_per_bale = EXCLUDED.price_per_bale, updated_at = now()`,
          [companyId, customerId, line.articleCode, price]
        );
        saved++;
      }
      return res.json({ saved });
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  // DELETE /api/factory/customer-price-lists/:customerId/:articleCode
  app.delete("/api/factory/customer-price-lists/:customerId/:articleCode", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const customerId = parseInt(req.params.customerId, 10);
      if (isNaN(customerId)) return res.status(400).json({ message: "Invalid customerId" });
      const articleCode = req.params.articleCode;
      await pool.query(
        `DELETE FROM customer_price_lists WHERE company_id = $1 AND customer_id = $2 AND article_code = $3`,
        [companyId, customerId, articleCode]
      );
      return res.json({ deleted: true });
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  // ───────────────────────────────────────────────
  // CUSTOMER ORDERS CRUD + FINALIZE
  // ───────────────────────────────────────────────
}
