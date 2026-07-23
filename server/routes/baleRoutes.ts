import type { Express } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { cache } from "../lib/simpleCache";
import { requireAuth, requireRole } from "../auth";
import { logAudit } from "./_helpers";
import {
  inventory,
  stockItems,
  containers,
  suppliers,
  customers,
  locations,
  auditLog,
  insertCompanySettingsSchema,
  factoryBales,
  factoryBaleProducts,
  baleLabelPrints,
  factoryWorkers,
  factoryPressingBatches,
  factoryMixBatches,
  factoryMixBatchSources,
  factoryContainers,
  factorySuppliers,
  productionRawStock,
  mixBatches,
  referenceSequences,
  customerOrders,
  customerOrderBales,
  insertBaleSchema,
  factoryBaleSequences,
  mixBatchSources,
  insertMixBatchSourceSchema,
} from "@shared/schema";
import { eq, and, or, desc, inArray, sql, ilike } from "drizzle-orm";

// Module-level bwip-js cache — loaded once on first barcode request, then reused.
// This avoids the cold-start latency of re-importing the library on every request.
let _bwipjs: any = null;
async function getBwipjs(): Promise<any> {
  if (!_bwipjs) {
    // @ts-ignore - bwip-js types are incomplete
    _bwipjs = await import("bwip-js");
  }
  return _bwipjs;
}
import { registerBaleProductRoutes } from "./baleProductRoutes";
import { registerBaleTransferRoutes } from "./baleTransferRoutes";
import { registerProductionBaleRoutes } from "./productionBaleRoutes";

export function registerBaleRoutes(app: Express) {
  // Pre-warm bwip-js at server startup so the first barcode render is instant.
  getBwipjs().catch(() => {});
  app.get("/api/bales", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const bales = await storage.getAllBales(companyId);
      res.json(bales);
    } catch (error: any) {
      console.error("Error fetching bales:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/bales/:id", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid bale ID" });
      const bale = await storage.getBaleById(id);

      if (!bale) {
        return res.status(404).json({ message: "Bale not found" });
      }

      // Check company ownership
      if (bale.companyId !== companyId) {
        return res.status(403).json({ message: "Access denied" });
      }

      res.json(bale);
    } catch (error: any) {
      console.error("Error fetching bale:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/bales/barcode/:barcode", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const barcode = req.params.barcode;
      const bale = await storage.getBaleByBarcode(barcode, companyId);

      if (!bale) {
        return res.status(404).json({ message: "Bale not found" });
      }

      res.json(bale);
    } catch (error: any) {
      console.error("Error fetching bale by barcode:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/bales", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const data = insertBaleSchema.parse({ ...req.body, companyId });

      // Check for duplicate barcode
      const existing = await storage.getBaleByBarcode(data.barcode, companyId);
      if (existing) {
        return res.status(409).json({ message: "Barcode already exists" });
      }

      const bale = await storage.createBale(data);
      res.json(bale);
    } catch (error: any) {
      console.error("Error creating bale:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/bales/:id", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid bale ID" });
      const existing = await storage.getBaleById(id);

      if (!existing) {
        return res.status(404).json({ message: "Bale not found" });
      }

      // Check company ownership
      if (existing.companyId !== companyId) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Prevent companyId changes
      const { companyId: _, ...updateData } = req.body;
      const bale = await storage.updateBale(id, updateData);
      res.json(bale);
    } catch (error: any) {
      console.error("Error updating bale:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/bales/:id", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid bale ID" });
      const existing = await storage.getBaleById(id);

      if (!existing) {
        return res.status(404).json({ message: "Bale not found" });
      }

      // Check company ownership
      if (existing.companyId !== companyId) {
        return res.status(403).json({ message: "Access denied" });
      }

      await storage.deleteBale(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting bale:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/bales/import", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const balesData = req.body.bales || [];

      if (!Array.isArray(balesData)) {
        return res.status(400).json({ message: "Invalid data format" });
      }

      const validatedBales = balesData.map((b: any) => insertBaleSchema.parse({ ...b, companyId }));

      const created = await storage.bulkCreateBales(validatedBales);
      res.json({ success: true, count: created.length, bales: created });
    } catch (error: any) {
      console.error("Error importing bales:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // Price import from Excel: preview + apply
  app.post("/api/bales/price-import/preview", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const rows: { barcode: string; price: string }[] = req.body.rows || [];
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "No rows provided" });
      }

      const preview = await Promise.all(
        rows.map(async (row) => {
          const barcode = String(row.barcode || "").trim();
          const newPrice = parseFloat(String(row.price || ""));
          if (!barcode) return { barcode, status: "invalid", currentPrice: null, newPrice: null };
          if (isNaN(newPrice) || newPrice < 0)
            return { barcode, status: "invalid_price", currentPrice: null, newPrice: null };
          const bale = await storage.getBaleByBarcode(barcode, companyId);
          if (!bale) return { barcode, status: "not_found", currentPrice: null, newPrice };
          const currentPrice = bale.price ? parseFloat(bale.price) : null;
          const noChange = currentPrice !== null && Math.abs(currentPrice - newPrice) < 0.001;
          return {
            id: bale.id,
            barcode,
            category: bale.category,
            grade: bale.grade,
            status: noChange ? "no_change" : "will_update",
            currentPrice,
            newPrice,
          };
        })
      );

      res.json({ preview });
    } catch (error: any) {
      console.error("Error in price-import preview:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/bales/price-import/apply", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const rows: { id: number; price: string }[] = req.body.rows || [];
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "No rows provided" });
      }

      let updated = 0;
      for (const row of rows) {
        const id = parseInt(String(row.id));
        const price = parseFloat(String(row.price));
        if (isNaN(id) || isNaN(price) || price < 0) continue;
        const bale = await storage.getBaleById(id);
        if (!bale || bale.companyId !== companyId) continue;
        await storage.updateBale(id, { price: String(price) });
        updated++;
      }

      res.json({ success: true, updated });
    } catch (error: any) {
      console.error("Error in price-import apply:", error);
      res.status(500).json({ message: error.message });
    }
  });

  registerBaleProductRoutes(app);

  // Helper: generate a reference number that is guaranteed not to clash with any
  // existing factory_bales ref for this company, by taking the max across both
  // sequence tables and the actual data.
  async function generateSafeRef(tx: any, companyId: number): Promise<string> {
    // Find the true max numeric ref already in use for this company
    const [maxRow] = await tx
      .select({
        m: sql<number>`COALESCE(MAX(CAST(REGEXP_REPLACE(reference_number, '[^0-9]', '', 'g') AS BIGINT)), 0)`,
      })
      .from(factoryBales)
      .where(and(eq(factoryBales.companyId, companyId), sql`reference_number ~ '^REF[0-9]+'`));
    const dbMax = Number(maxRow?.m) || 0;

    // Also check both sequence tables
    const [refSeq] = await tx
      .select()
      .from(referenceSequences)
      .where(eq(referenceSequences.companyId, companyId))
      .for("update");
    const [baleSeq] = await tx.select().from(factoryBaleSequences).where(eq(factoryBaleSequences.companyId, companyId));

    const seqMax = Math.max(refSeq?.nextNumber ?? 0, baleSeq?.nextNumber ?? 0);
    const safeNext = Math.max(dbMax + 1, seqMax);
    const referenceNumber = `REF${String(safeNext).padStart(6, "0")}`;

    // Update (or insert) referenceSequences so next call gets safeNext+1
    if (refSeq) {
      await tx
        .update(referenceSequences)
        .set({ nextNumber: safeNext + 1 })
        .where(eq(referenceSequences.id, refSeq.id));
    } else {
      await tx.insert(referenceSequences).values({ companyId, nextNumber: safeNext + 1 });
    }

    return referenceNumber;
  }

  // Bale Label Prints - pre-allocate a batch of reference numbers for offline label printing
  app.post("/api/bale-label-prints/allocate-pool", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const count = Math.min(Math.max(parseInt(req.body?.count ?? "200", 10) || 200, 1), 500);
      const refs = await db.transaction(async (tx) => {
        const result: string[] = [];
        for (let i = 0; i < count; i++) {
          result.push(await generateSafeRef(tx, companyId));
        }
        return result;
      });
      res.json({ refs });
    } catch (error: any) {
      console.error("Error allocating label ref pool:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Bale Label Prints - create label print records with unique reference numbers
  app.post("/api/bale-label-prints", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { bales } = req.body;
      if (!bales || !Array.isArray(bales) || bales.length === 0) {
        return res.status(400).json({ message: "No bales provided" });
      }

      const labelPrints = await db.transaction(async (tx) => {
        const results = [];
        for (const bale of bales) {
          let referenceNumber: string;

          // If the bale already has a reference number (assigned by stock-entry),
          // reuse it — do NOT generate a new one or we'll collide with factory_bales unique constraint.
          if (bale.productionBaleId) {
            const [existingBale] = await tx
              .select({ referenceNumber: factoryBales.referenceNumber })
              .from(factoryBales)
              .where(eq(factoryBales.id, bale.productionBaleId));

            if (existingBale?.referenceNumber) {
              // Bale already has a reference (e.g. assigned by stock-entry) — reuse it
              referenceNumber = existingBale.referenceNumber;
            } else {
              // Bale has no ref yet (e.g. pressing batch bale) — generate one safely
              referenceNumber = await generateSafeRef(tx, companyId);
              await tx.update(factoryBales).set({ referenceNumber }).where(eq(factoryBales.id, bale.productionBaleId));
            }
          } else if (bale.referenceNumber) {
            // Pre-allocated offline ref — use it directly (sequence was already advanced)
            referenceNumber = bale.referenceNumber;
          } else {
            // No productionBaleId — standalone label print, generate from sequence
            referenceNumber = await generateSafeRef(tx, companyId);
          }

          const [labelPrint] = await tx
            .insert(baleLabelPrints)
            .values({
              companyId,
              productionBaleId: bale.productionBaleId || null,
              productId: bale.productId || null,
              articleCode: bale.articleCode,
              referenceNumber,
              pieces: bale.pieces || 1,
              approxWeightKg: String(bale.approxWeightKg),
              printedByUserId: req.session.userId || null,
              printedAt: new Date(),
            })
            .returning();

          results.push(labelPrint);
        }
        return results;
      });

      res.json({ labelPrints });
    } catch (error: any) {
      console.error("Error creating bale label prints:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/bale-label-prints/reprint", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { baleId } = req.body;
      if (!baleId) return res.status(400).json({ message: "baleId required" });
      const [existing] = await db
        .select()
        .from(baleLabelPrints)
        .where(and(eq(baleLabelPrints.companyId, companyId), eq(baleLabelPrints.productionBaleId, baleId)));
      if (existing) {
        await db
          .update(baleLabelPrints)
          .set({ printedAt: new Date(), printedByUserId: req.session.userId || null })
          .where(eq(baleLabelPrints.id, existing.id));
      } else {
        const [bale] = await db.select().from(factoryBales).where(eq(factoryBales.id, baleId));
        if (bale) {
          const product = bale.productId
            ? (await db.select().from(factoryBaleProducts).where(eq(factoryBaleProducts.id, bale.productId)))[0]
            : null;
          const refNum = bale.referenceNumber || `REPRINT-${baleId}`;
          await db.insert(baleLabelPrints).values({
            companyId,
            productionBaleId: baleId,
            productId: bale.productId || null,
            articleCode: product?.articleCode || bale.category || "UNKNOWN",
            referenceNumber: refNum,
            pieces: bale.quantity || 1,
            approxWeightKg: String(bale.weightKg || 0),
            printedByUserId: req.session.userId || null,
            printedAt: new Date(),
          });
        }
      }
      res.json({ success: true, printedAt: new Date().toISOString() });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Lookup by ARTICLE code
  app.get("/api/lookup/article/:articleCode", requireAuth, async (req, res) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const articleCode = decodeURIComponent(req.params.articleCode);

      // Search for a matching product in BOTH catalogs in parallel
      const [erpProduct, labelPrints, factoryProductRows] = await Promise.all([
        storage.getBaleProductByArticleCode(articleCode, companyId),
        storage.getBaleLabelPrintsByArticle(articleCode, companyId),
        // factoryBales.productId points to factory_bale_products, not bale_products
        // Use case-insensitive match so article codes with mixed case are still found.
        db
          .select({ id: factoryBaleProducts.id, name: factoryBaleProducts.name, code: factoryBaleProducts.code, articleCode: factoryBaleProducts.articleCode, active: factoryBaleProducts.active })
          .from(factoryBaleProducts)
          .where(and(eq(factoryBaleProducts.companyId, companyId), ilike(factoryBaleProducts.articleCode, articleCode))),
      ]);

      // Use ERP product for display if found; fall back to factory product
      const factoryProduct = factoryProductRows[0] ?? null;
      const displayProduct = erpProduct || (factoryProduct ? { ...factoryProduct, weightPerBaleKg: null, description: null, categoryId: null } : null);

      // IDs in factory_bale_products that match this article code
      const factoryProductIds = factoryProductRows.map((p) => p.id);

      // Enrich each label print with bale status so non-admin users can see deleted bales
      const refNumbers = labelPrints.map((lp) => lp.referenceNumber).filter(Boolean);
      const coveredRefs = new Set(refNumbers);
      const baleStatusMap: Record<string, string> = {};
      if (refNumbers.length > 0) {
        const baleRows = await db
          .select({ referenceNumber: factoryBales.referenceNumber, status: factoryBales.status })
          .from(factoryBales)
          .where(and(eq(factoryBales.companyId, companyId), inArray(factoryBales.referenceNumber, refNumbers)));
        for (const b of baleRows) {
          if (b.referenceNumber) baleStatusMap[b.referenceNumber] = b.status;
        }
      }

      const enrichedLabelPrints = labelPrints.map((lp) => ({
        ...lp,
        baleStatus: baleStatusMap[lp.referenceNumber] ?? null,
      }));

      // Also find bales in factory_bales that have this articleCode (directly on the bale row,
      // or via productId → factory_bale_products) but have NO label print entry yet.
      // These are manually imported bales, system-created bales, or produced bales never printed.
      let directBalesWhereClause;
      if (factoryProductIds.length > 0) {
        directBalesWhereClause = and(
          eq(factoryBales.companyId, companyId),
          or(
            sql`LOWER(${factoryBales.articleCode}) = LOWER(${articleCode})`,
            inArray(factoryBales.productId, factoryProductIds)
          )
        );
      } else {
        directBalesWhereClause = and(
          eq(factoryBales.companyId, companyId),
          sql`LOWER(${factoryBales.articleCode}) = LOWER(${articleCode})`
        );
      }

      const directBalesRaw = await db
        .select({
          id: factoryBales.id,
          referenceNumber: factoryBales.referenceNumber,
          weightKg: factoryBales.weightKg,
          status: factoryBales.status,
          createdAt: factoryBales.createdAt,
        })
        .from(factoryBales)
        .where(directBalesWhereClause);

      // Only include bales not already covered by a label print
      const uncoveredBales = directBalesRaw.filter(
        (b) => b.referenceNumber && !coveredRefs.has(b.referenceNumber)
      );

      // Synthesize label-print-like entries (negative ID to avoid collision with real print IDs)
      const syntheticEntries = uncoveredBales.map((b) => ({
        id: -(b.id),
        referenceNumber: b.referenceNumber,
        approxWeightKg: b.weightKg,
        articleCode,
        companyId,
        printedAt: null,
        scannedAt: null,
        scannedByUserId: null,
        scannedByName: null,
        baleStatus: b.status,
        _synthetic: true,
      }));

      // Merge: real label prints first, then synthetic entries sorted by reference number
      const allEntries = [
        ...enrichedLabelPrints,
        ...syntheticEntries.sort((a, b) => a.referenceNumber.localeCompare(b.referenceNumber)),
      ];

      res.json({ product: displayProduct || null, labelPrints: allEntries });
    } catch (error: any) {
      console.error("Error looking up article:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Lookup by REFERENCE number
  app.get("/api/lookup/reference/:referenceNumber", requireAuth, async (req, res) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const referenceNumber = decodeURIComponent(req.params.referenceNumber).toUpperCase();
      const labelPrint = await storage.getBaleLabelPrintByReference(referenceNumber, companyId);

      // If no label print exists, try to find the bale directly in factory_bales
      // (bales can exist without a label print if entered manually / imported)
      // Use case-insensitive comparison so lowercase refs in DB are still found.
      if (!labelPrint) {
        const [directBale] = await db
          .select()
          .from(factoryBales)
          .where(and(
            eq(factoryBales.companyId, companyId),
            sql`LOWER(${factoryBales.referenceNumber}) = LOWER(${referenceNumber})`
          ))
          .limit(1);

        if (!directBale) {
          return res.status(404).json({ message: "Reference number not found" });
        }

        // Build a minimal response from the bale row alone
        let locationInfo: any = null;
        if (directBale.erpLocationId) {
          const [loc] = await db
            .select({ id: locations.id, name: locations.name, city: locations.city, state: locations.state })
            .from(locations)
            .where(eq(locations.id, directBale.erpLocationId))
            .limit(1);
          if (loc) locationInfo = loc;
        }

        let product = null;
        if (directBale.productId) {
          product = await storage.getBaleProductById(directBale.productId);
        } else if (directBale.articleCode) {
          product = await storage.getBaleProductByArticleCode(directBale.articleCode, companyId);
        }

        // Use stored workerName first (denormalized); fall back to join if not yet populated
        let directWorkerName: string | null = directBale.workerName ?? null;
        if (!directWorkerName && directBale.finalizedBy) {
          const [wk] = await db
            .select({ fullName: factoryWorkers.fullName })
            .from(factoryWorkers)
            .where(eq(factoryWorkers.id, directBale.finalizedBy))
            .limit(1);
          if (wk) directWorkerName = wk.fullName;
        }

        // Check if this bale is in an active LOADING order
        const [directOrderBale] = await db
          .select({ orderId: customerOrderBales.orderId })
          .from(customerOrderBales)
          .where(eq(customerOrderBales.baleReference, referenceNumber))
          .limit(1);
        let directLoadedOnOrder: any = null;
        let directIsInLoadingOrder = false;
        if (directOrderBale) {
          const [directOrder] = await db
            .select({ status: customerOrders.status })
            .from(customerOrders)
            .where(eq(customerOrders.id, directOrderBale.orderId))
            .limit(1);
          if (directOrder?.status === "LOADING") directIsInLoadingOrder = true;
          directLoadedOnOrder = directOrder || null;
        }

        // If the bale's stored status is IN_STOCK but it's already on a finalized order,
        // derive the correct effective status so the Bale Explorer shows it accurately.
        const _finalizedStatuses = ["FINALIZED", "DISPATCHED", "SOLD"];
        const directEffectiveStatus =
          directBale.status === "IN_STOCK" &&
          directLoadedOnOrder?.status &&
          _finalizedStatuses.includes(directLoadedOnOrder.status)
            ? "SOLD"
            : directBale.status;

        // Fetch audit history for this bale
        const directAuditHistory = await db
          .select({
            id: auditLog.id,
            action: auditLog.action,
            username: auditLog.username,
            changes: auditLog.changes,
            createdAt: auditLog.createdAt,
          })
          .from(auditLog)
          .where(and(eq(auditLog.tableName, "factory_bales"), eq(auditLog.recordId, directBale.id)))
          .orderBy(desc(auditLog.createdAt))
          .limit(30);

        return res.json({
          labelPrint: null,
          product: product || null,
          baleInfo: {
            id: directBale.id,
            baleCode: directBale.baleCode,
            articleCode: product?.articleCode || directBale.articleCode || null,
            productName: directBale.productName,
            status: directEffectiveStatus,
            isInLoadingOrder: directIsInLoadingOrder,
            weightKg: directBale.weightKg,
            costPerKg: directBale.costPerKg,
            totalCost: directBale.totalCost,
            grade: directBale.grade,
            stockEntryDate: directBale.stockEntryDate,
            pressedAt: directBale.pressedAt,
            finalizedAt: directBale.finalizedAt,
            workerName: directWorkerName,
            createdAt: directBale.createdAt,
            updatedAt: directBale.updatedAt,
            deletedAt: directBale.deletedAt,
          },
          locationInfo,
          pressingBatch: null,
          mixBatch: null,
          containers_used: [],
          loadedOnOrder: directLoadedOnOrder,
          auditHistory: directAuditHistory,
        });
      }

      let printedByName = null;
      let scannedByName = null;
      if (labelPrint.printedByUserId) {
        const printedUser = await storage.getUser(labelPrint.printedByUserId);
        printedByName = printedUser?.username || null;
      }
      if (labelPrint.scannedByUserId) {
        const scannedUser = await storage.getUser(labelPrint.scannedByUserId);
        scannedByName = scannedUser?.username || null;
      }

      let product = null;
      if (labelPrint.productId) {
        product = await storage.getBaleProductById(labelPrint.productId);
      } else {
        product = await storage.getBaleProductByArticleCode(labelPrint.articleCode, companyId);
      }

      // ── Enrich with factory_bales data (matched by referenceNumber) ──
      let baleInfo: any = null;
      let locationInfo: any = null;
      let pressingBatch: any = null;
      let mixBatch: any = null;
      let containers_used: any[] = [];

      const [factoryBale] = await db
        .select()
        .from(factoryBales)
        .where(and(eq(factoryBales.referenceNumber, referenceNumber), eq(factoryBales.companyId, companyId)))
        .limit(1);

      if (factoryBale) {
        // Use the name stored on the bale row directly — this matches what the bale history page shows.
        const resolvedProductName = factoryBale.productName;

        // Use stored workerName first (denormalized); fall back to join if not yet populated
        let workerName: string | null = factoryBale.workerName ?? null;
        if (!workerName && factoryBale.finalizedBy) {
          const [wk] = await db
            .select({ fullName: factoryWorkers.fullName })
            .from(factoryWorkers)
            .where(eq(factoryWorkers.id, factoryBale.finalizedBy))
            .limit(1);
          if (wk) workerName = wk.fullName;
        }

        baleInfo = {
          id: factoryBale.id,
          baleCode: factoryBale.baleCode,
          productName: resolvedProductName,
          status: factoryBale.status,
          weightKg: factoryBale.weightKg,
          costPerKg: factoryBale.costPerKg,
          totalCost: factoryBale.totalCost,
          grade: factoryBale.grade,
          stockEntryDate: factoryBale.stockEntryDate,
          pressedAt: factoryBale.pressedAt,
          finalizedAt: factoryBale.finalizedAt,
          workerName,
          createdAt: factoryBale.createdAt,
          updatedAt: factoryBale.updatedAt,
          deletedAt: factoryBale.deletedAt,
        };

        // Get location
        if (factoryBale.erpLocationId) {
          const [loc] = await db
            .select({ id: locations.id, name: locations.name, city: locations.city, state: locations.state })
            .from(locations)
            .where(eq(locations.id, factoryBale.erpLocationId))
            .limit(1);
          if (loc) locationInfo = loc;
        }

        // Get pressing batch
        if (factoryBale.pressingBatchId) {
          const [pb] = await db
            .select()
            .from(factoryPressingBatches)
            .where(eq(factoryPressingBatches.id, factoryBale.pressingBatchId))
            .limit(1);
          if (pb) {
            pressingBatch = {
              id: pb.id,
              status: pb.status,
              expectedCount: pb.expectedCount,
              finalizedAt: pb.finalizedAt,
              notes: pb.notes,
            };

            // Get mix batch
            if (pb.mixBatchId) {
              const [mb] = await db
                .select()
                .from(factoryMixBatches)
                .where(eq(factoryMixBatches.id, pb.mixBatchId))
                .limit(1);
              if (mb) {
                mixBatch = {
                  id: mb.id,
                  batchCode: mb.batchCode,
                  batchNumber: mb.batchNumber,
                  name: mb.name,
                  batchDate: mb.batchDate,
                  totalWeightKg: mb.totalWeightKg,
                  costPerKg: mb.costPerKg,
                  status: mb.status,
                  operatorUser: mb.operatorUser,
                };

                // Get container sources for this mix batch
                const sources = await db
                  .select()
                  .from(factoryMixBatchSources)
                  .where(eq(factoryMixBatchSources.mixBatchId, mb.id));

                const containerIds = [...new Set(sources.filter((s) => s.containerId).map((s) => s.containerId!))];
                if (containerIds.length > 0) {
                  const containerRows = await db
                    .select()
                    .from(factoryContainers)
                    .where(inArray(factoryContainers.id, containerIds));

                  const supplierIds = [...new Set(containerRows.filter((c) => c.supplierId).map((c) => c.supplierId!))];
                  const supplierRows =
                    supplierIds.length > 0
                      ? await db.select().from(factorySuppliers).where(inArray(factorySuppliers.id, supplierIds))
                      : [];
                  const supplierMap = new Map(supplierRows.map((s) => [s.id, s.name]));

                  containers_used = containerRows.map((c) => {
                    const src = sources.find((s) => s.containerId === c.id);
                    return {
                      id: c.id,
                      containerNumber: c.containerNumber,
                      origin: c.origin,
                      arrivalDate: c.arrivalDate,
                      status: c.status,
                      supplierName: c.supplierId ? supplierMap.get(c.supplierId) || null : null,
                      weightKgUsed: src?.weightKg || null,
                      currencyCode: c.currencyCode,
                      ratePerKg: c.ratePerKg,
                    };
                  });
                }
              }
            }
          }
        }
      }

      // ── Check if this bale was loaded onto an outbound customer order ──
      // Fetch ALL assignments for this bale reference and pick the best-status one.
      // A bale can appear in multiple orders (e.g. moved from a cancelled order to a
      // finalized invoice). Without ordering we'd show the oldest/cancelled one first.
      const statusPriority: Record<string, number> = {
        FINALIZED: 0,
        SOLD: 1,
        DISPATCHED: 2,
        VERIFIED: 3,
        PENDING_VERIFICATION: 4,
        LOADING: 5,
        DRAFT: 6,
        CANCELLED: 7,
      };
      let loadedOnOrder: any = null;
      const orderBaleRows = await db
        .select()
        .from(customerOrderBales)
        .where(eq(customerOrderBales.baleReference, referenceNumber));

      if (orderBaleRows.length > 0) {
        // Fetch all matching orders in one query
        const orderIds = orderBaleRows.map((r) => r.orderId);
        const orders = await db
          .select()
          .from(customerOrders)
          .leftJoin(customers, eq(customerOrders.customerId, customers.id))
          .where(inArray(customerOrders.id, orderIds));

        if (orders.length > 0) {
          // Pick the order with the best (lowest priority number) status
          const bestOrder = orders.sort((a, b) => {
            const pa = statusPriority[a.customer_orders.status] ?? 99;
            const pb = statusPriority[b.customer_orders.status] ?? 99;
            return pa - pb;
          })[0];
          const matchingBaleRow = orderBaleRows.find((r) => r.orderId === bestOrder.customer_orders.id);
          if (matchingBaleRow) {
            loadedOnOrder = {
              orderId: bestOrder.customer_orders.id,
              invoiceNumber: bestOrder.customer_orders.invoiceNumber,
              orderDate: bestOrder.customer_orders.orderDate,
              status: bestOrder.customer_orders.status,
              containerNumber: bestOrder.customer_orders.containerNumber,
              shippingCompany: bestOrder.customer_orders.shippingCompany,
              containerNotes: bestOrder.customer_orders.containerNotes,
              loadingStartedAt: bestOrder.customer_orders.loadingStartedAt,
              loadingFinalizedAt: bestOrder.customer_orders.loadingFinalizedAt,
              grandTotal: bestOrder.customer_orders.grandTotal,
              totalQtyBales: bestOrder.customer_orders.totalQtyBales,
              customerName: bestOrder.customers?.legalName || null,
              priceUsed: matchingBaleRow.priceUsed,
              baleWeight: matchingBaleRow.weight,
              scannedBy: matchingBaleRow.scannedBy || null,
            };
          }
        }
      }

      // Mark isInLoadingOrder on baleInfo so callers (e.g. Ground Scan) can show the right status
      if (baleInfo && loadedOnOrder?.status === "LOADING") {
        baleInfo.isInLoadingOrder = true;
      }

      // If the bale's stored status is IN_STOCK but it's already on a finalized order,
      // derive the correct effective status so the Bale Explorer shows it accurately.
      if (
        baleInfo &&
        baleInfo.status === "IN_STOCK" &&
        loadedOnOrder?.status &&
        ["FINALIZED", "DISPATCHED", "SOLD"].includes(loadedOnOrder.status)
      ) {
        baleInfo.status = "SOLD";
      }

      // Fetch audit history for this bale
      let auditHistory: any[] = [];
      if (baleInfo?.id) {
        auditHistory = await db
          .select({
            id: auditLog.id,
            action: auditLog.action,
            username: auditLog.username,
            changes: auditLog.changes,
            createdAt: auditLog.createdAt,
          })
          .from(auditLog)
          .where(and(eq(auditLog.tableName, "factory_bales"), eq(auditLog.recordId, baleInfo.id)))
          .orderBy(desc(auditLog.createdAt))
          .limit(30);
      }

      res.json({
        labelPrint: { ...labelPrint, printedByName, scannedByName },
        product: product || null,
        baleInfo,
        locationInfo,
        pressingBatch,
        mixBatch,
        containers_used,
        loadedOnOrder,
        auditHistory,
      });
    } catch (error: any) {
      console.error("Error looking up reference:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Mark a label as scanned
  app.post("/api/lookup/reference/:referenceNumber/scan", requireAuth, async (req, res) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const referenceNumber = decodeURIComponent(req.params.referenceNumber).toUpperCase();

      const [updated] = await db
        .update(baleLabelPrints)
        .set({
          scannedByUserId: req.session.userId || null,
          scannedAt: new Date(),
        })
        .where(and(eq(baleLabelPrints.referenceNumber, referenceNumber), eq(baleLabelPrints.companyId, companyId)))
        .returning();

      if (!updated) {
        return res.status(404).json({ message: "Reference number not found" });
      }

      const scannedUser = await storage.getUser(req.session.userId!);
      res.json({ ...updated, scannedByName: scannedUser?.username || null });
    } catch (error: any) {
      console.error("Error scanning label:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Admin: Delete bale/reference everywhere (soft-delete the factory bale)
  app.delete(
    "/api/lookup/reference/:referenceNumber/delete-everywhere",
    requireAuth,
    requireRole("Admin", "Owner", "Developer"),
    async (req, res) => {
      try {
        const companyId = (req.session as any).factoryCompanyId || req.session.currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });

        const referenceNumber = decodeURIComponent(req.params.referenceNumber).toUpperCase();

        const [bale] = await db
          .select()
          .from(factoryBales)
          .where(and(eq(factoryBales.referenceNumber, referenceNumber), eq(factoryBales.companyId, companyId)))
          .limit(1);

        if (!bale) return res.status(404).json({ message: "Bale not found for this reference" });

        // Guard: refuse if bale is on a finalized/locked customer order
        const [orderBaleRow] = await db
          .select()
          .from(customerOrderBales)
          .where(eq(customerOrderBales.baleReference, referenceNumber))
          .limit(1);

        if (orderBaleRow) {
          const [order] = await db
            .select({ status: customerOrders.status })
            .from(customerOrders)
            .where(eq(customerOrders.id, orderBaleRow.orderId))
            .limit(1);
          if (order && ["FINALIZED", "VERIFIED", "DISPATCHED", "SOLD"].includes(order.status)) {
            return res
              .status(409)
              .json({ message: "This bale is linked to a finalized/locked order and cannot be deleted from here." });
          }
        }

        const deletedAt = new Date();
        await db
          .update(factoryBales)
          .set({ status: "DELETED", deletedAt, updatedAt: deletedAt })
          .where(and(eq(factoryBales.referenceNumber, referenceNumber), eq(factoryBales.companyId, companyId)));

        // Write audit entry so "Deleted by" info is available on the barcode lookup
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId,
          action: "delete",
          tableName: "factory_bales",
          recordId: bale.id,
          recordIdentifier: referenceNumber,
          changes: { status: { old: bale.status, new: "DELETED" } },
        });

        res.json({ message: "Bale deleted from linked records" });
      } catch (error: any) {
        console.error("Error deleting bale everywhere:", error);
        res.status(500).json({ message: error.message });
      }
    }
  );

  // Admin: Change the linked bale product (article code / product name) for a reference
  app.patch(
    "/api/lookup/reference/:referenceNumber/change-product",
    requireAuth,
    requireRole("Admin", "Owner", "Developer"),
    async (req, res) => {
      try {
        const companyId = (req.session as any).factoryCompanyId || req.session.currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });

        const referenceNumber = decodeURIComponent(req.params.referenceNumber).toUpperCase();
        const { newProductId } = req.body;

        if (!newProductId || typeof newProductId !== "number") {
          return res.status(400).json({ message: "newProductId (number) is required" });
        }

        const [bale] = await db
          .select()
          .from(factoryBales)
          .where(and(eq(factoryBales.referenceNumber, referenceNumber), eq(factoryBales.companyId, companyId)))
          .limit(1);

        if (!bale) return res.status(404).json({ message: "Bale not found for this reference" });

        // Guard: locked order
        const [orderBaleRow] = await db
          .select()
          .from(customerOrderBales)
          .where(eq(customerOrderBales.baleReference, referenceNumber))
          .limit(1);

        if (orderBaleRow) {
          const [order] = await db
            .select({ status: customerOrders.status })
            .from(customerOrders)
            .where(eq(customerOrders.id, orderBaleRow.orderId))
            .limit(1);
          if (order && ["FINALIZED", "VERIFIED", "DISPATCHED", "SOLD"].includes(order.status)) {
            return res
              .status(409)
              .json({ message: "This bale is linked to a finalized/locked order and cannot be changed." });
          }
        }

        const [newProduct] = await db
          .select()
          .from(factoryBaleProducts)
          .where(and(eq(factoryBaleProducts.id, newProductId), eq(factoryBaleProducts.companyId, companyId)))
          .limit(1);

        if (!newProduct) return res.status(404).json({ message: "Target product not found" });

        const newArticleCode = newProduct.articleCode || newProduct.code;
        const newBaleCode = newProduct.code;
        const newProductName = newProduct.name;

        await db.transaction(async (tx) => {
          await tx
            .update(factoryBales)
            .set({
              productId: newProduct.id,
              articleCode: newArticleCode,
              baleCode: newBaleCode,
              productName: newProductName,
              updatedAt: new Date(),
            })
            .where(and(eq(factoryBales.referenceNumber, referenceNumber), eq(factoryBales.companyId, companyId)));

          await tx
            .update(baleLabelPrints)
            .set({ articleCode: newArticleCode })
            .where(and(eq(baleLabelPrints.referenceNumber, referenceNumber), eq(baleLabelPrints.companyId, companyId)));
        });

        res.json({ message: "Bale product changed", newArticleCode, newProductName });
      } catch (error: any) {
        console.error("Error changing bale product:", error);
        res.status(500).json({ message: error.message });
      }
    }
  );

  // Company Settings API Routes
  app.get("/api/company-settings", requireAuth, async (req, res) => {
    try {
      const { companyId: queryCompanyId } = req.query;
      const companyId = queryCompanyId ? parseInt(queryCompanyId as string) : req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const settings = await cache(`company_settings:${companyId}`, 30_000, () =>
        storage.getCompanySettings(companyId).then((s) => s || { companyId })
      );
      res.json(settings);
    } catch (error: any) {
      console.error("Error fetching company settings:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/company-settings", requireAuth, async (req, res) => {
    try {
      const { companyId: bodyCompanyId } = req.body;
      const companyId = bodyCompanyId ? parseInt(bodyCompanyId as string) : req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const data = insertCompanySettingsSchema.parse({ ...req.body, companyId });

      const settings = await storage.upsertCompanySettings(data);
      cache.del(`company_settings:${companyId}`);
      res.json(settings);
    } catch (error: any) {
      console.error("Error updating company settings:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // Production Raw Stock API Routes
  app.get("/api/production-raw-stock", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const rawStockRows = await db
        .select({
          id: productionRawStock.id,
          companyId: productionRawStock.companyId,
          containerId: productionRawStock.containerId,
          receivedKg: productionRawStock.receivedKg,
          usedKg: productionRawStock.usedKg,
          costPerKg: productionRawStock.costPerKg,
          offloadedAt: productionRawStock.offloadedAt,
          containerNumber: containers.containerNumber,
          supplierId: containers.supplierId,
          supplierName: suppliers.legalName,
        })
        .from(productionRawStock)
        .leftJoin(containers, eq(productionRawStock.containerId, containers.id))
        .leftJoin(suppliers, eq(containers.supplierId, suppliers.id))
        .where(eq(productionRawStock.companyId, companyId))
        .orderBy(desc(productionRawStock.offloadedAt));

      const result = rawStockRows.map((row) => {
        const received = parseFloat(row.receivedKg);
        const used = parseFloat(row.usedKg);
        const remaining = received - used;
        const cost = parseFloat(row.costPerKg);
        return {
          ...row,
          remainingKg: remaining.toFixed(3),
          valueRemaining: (remaining * cost).toFixed(2),
        };
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error fetching production raw stock:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/production-raw-stock/offload", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { containerId } = req.body;
      if (!containerId) {
        return res.status(400).json({ message: "Missing required field: containerId" });
      }

      const container = await storage.getContainerById(parseInt(containerId));
      if (!container || container.companyId !== companyId) {
        return res.status(404).json({ message: "Container not found" });
      }

      const finalReceivedKg = req.body.receivedKg || container.totalKg || null;
      const finalCostPerKg = req.body.costPerKg || container.ratePerKg || null;

      if (!finalReceivedKg || parseFloat(finalReceivedKg) <= 0) {
        return res
          .status(400)
          .json({ message: "Received weight is required. Container has no saved Total KG - please provide a value." });
      }
      if (!finalCostPerKg || parseFloat(finalCostPerKg) <= 0) {
        return res
          .status(400)
          .json({ message: "Cost per kg is required. Container has no saved Rate per KG - please provide a value." });
      }

      const existing = await db
        .select()
        .from(productionRawStock)
        .where(
          and(eq(productionRawStock.companyId, companyId), eq(productionRawStock.containerId, parseInt(containerId)))
        );

      if (existing.length > 0) {
        return res.status(409).json({ message: "Container already offloaded to production raw stock" });
      }

      const [record] = await db
        .insert(productionRawStock)
        .values({
          companyId,
          containerId: parseInt(containerId),
          receivedKg: finalReceivedKg.toString(),
          costPerKg: finalCostPerKg.toString(),
          usedKg: "0",
        })
        .returning();

      res.json(record);
    } catch (error: any) {
      console.error("Error offloading container:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/production-raw-stock/available-containers", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const offloadedIds = await db
        .select({ containerId: productionRawStock.containerId })
        .from(productionRawStock)
        .where(eq(productionRawStock.companyId, companyId));

      const offloadedIdList = offloadedIds.map((r) => r.containerId);

      const allContainers = await db
        .select()
        .from(containers)
        .where(and(eq(containers.companyId, companyId), eq(containers.status, "AVAILABLE")));

      const available = allContainers.filter((c) => !offloadedIdList.includes(c.id));
      res.json(available);
    } catch (error: any) {
      console.error("Error fetching available containers:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Mix Batches API Routes
  app.get("/api/mix-batches", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const batches = await storage.getAllMixBatches(companyId);
      res.json(batches);
    } catch (error: any) {
      console.error("Error fetching mix batches:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/mix-batches/:id", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid mix batch ID" });
      }

      const batch = await storage.getMixBatchById(id, companyId);

      if (!batch) {
        return res.status(404).json({ message: "Mix batch not found" });
      }

      res.json(batch);
    } catch (error: any) {
      console.error("Error fetching mix batch:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/mix-batches", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      const userId = req.session.userId;
      if (!companyId || !userId) return res.status(400).json({ message: "No company or user session" });

      const { sources, batchSources, name, ...batchData } = req.body;

      const hasSources = sources && Array.isArray(sources) && sources.length > 0;
      const hasBatchSources = batchSources && Array.isArray(batchSources) && batchSources.length > 0;

      if (!hasSources && !hasBatchSources) {
        return res.status(400).json({ message: "At least one container or batch source is required" });
      }

      const result = await db.transaction(async (tx) => {
        const year = new Date().getFullYear();
        const existingBatches = await tx
          .select({ id: mixBatches.id })
          .from(mixBatches)
          .where(eq(mixBatches.companyId, companyId));
        const batchNum = existingBatches.length + 1;
        const batchCode = batchData.batchCode || `MB-${year}-${String(batchNum).padStart(3, "0")}`;

        let totalWeightKg = 0;
        let totalCost = 0;
        const validatedSources: Array<{
          containerId?: number;
          sourceBatchId?: number;
          weightKg: number;
          costPerKg: number;
          totalCost: number;
        }> = [];

        // Process container sources
        if (hasSources) {
          for (const source of sources) {
            const cId = parseInt(source.containerId);
            const wKg = parseFloat(source.weightKg);
            const cPKg = parseFloat(source.costPerKg);

            if (isNaN(cId) || isNaN(wKg) || isNaN(cPKg) || wKg <= 0) {
              throw new Error("Invalid container source data");
            }

            const [rawStock] = await tx
              .select()
              .from(productionRawStock)
              .where(and(eq(productionRawStock.companyId, companyId), eq(productionRawStock.containerId, cId)))
              .for("update");

            if (!rawStock) {
              throw new Error(`Container ${cId} not found in production raw stock. Offload it first.`);
            }

            const remaining = parseFloat(rawStock.receivedKg) - parseFloat(rawStock.usedKg);
            if (wKg > remaining + 0.001) {
              throw new Error(
                `Container ${rawStock.containerId} only has ${remaining.toFixed(3)} kg remaining, requested ${wKg}`
              );
            }

            const newUsed = parseFloat(rawStock.usedKg) + wKg;
            await tx
              .update(productionRawStock)
              .set({ usedKg: newUsed.toFixed(3) })
              .where(eq(productionRawStock.id, rawStock.id));

            const sCost = wKg * cPKg;
            totalWeightKg += wKg;
            totalCost += sCost;
            validatedSources.push({ containerId: cId, weightKg: wKg, costPerKg: cPKg, totalCost: sCost });
          }
        }

        // Process existing batch sources
        if (hasBatchSources) {
          for (const bSrc of batchSources) {
            const srcBatchId = parseInt(bSrc.sourceBatchId);
            const wKg = parseFloat(bSrc.weightKg);

            if (isNaN(srcBatchId) || isNaN(wKg) || wKg <= 0) {
              throw new Error("Invalid batch source data");
            }

            const [srcBatch] = await tx
              .select()
              .from(mixBatches)
              .where(and(eq(mixBatches.id, srcBatchId), eq(mixBatches.companyId, companyId)))
              .for("update");

            if (!srcBatch) {
              throw new Error(`Source batch ${srcBatchId} not found`);
            }

            const srcTotal = parseFloat(srcBatch.totalWeightKg);
            const srcUsed = parseFloat(srcBatch.usedKg);
            const srcRemaining = srcTotal - srcUsed;

            if (wKg > srcRemaining + 0.001) {
              throw new Error(
                `Batch ${srcBatch.batchCode} only has ${srcRemaining.toFixed(3)} kg remaining, requested ${wKg}`
              );
            }

            // Deduct from source batch's usedKg
            const newUsed = srcUsed + wKg;
            await tx
              .update(mixBatches)
              .set({
                usedKg: newUsed.toFixed(3),
                status: newUsed >= srcTotal - 0.001 ? "COMPLETED" : srcBatch.status,
              })
              .where(eq(mixBatches.id, srcBatchId));

            const srcCostPerKg = parseFloat(srcBatch.costPerKg);
            const sCost = wKg * srcCostPerKg;
            totalWeightKg += wKg;
            totalCost += sCost;
            validatedSources.push({
              sourceBatchId: srcBatchId,
              weightKg: wKg,
              costPerKg: srcCostPerKg,
              totalCost: sCost,
            });
          }
        }

        const blendedCostPerKg = totalWeightKg > 0 ? totalCost / totalWeightKg : 0;

        const [batch] = await tx
          .insert(mixBatches)
          .values({
            companyId,
            batchCode,
            name: name || batchCode,
            totalWeightKg: totalWeightKg.toFixed(3),
            usedKg: "0",
            costPerKg: blendedCostPerKg.toFixed(4),
            totalCost: totalCost.toFixed(2),
            notes: batchData.notes || null,
            status: "ACTIVE",
          })
          .returning();

        for (const src of validatedSources) {
          await tx.insert(mixBatchSources).values({
            mixBatchId: batch.id,
            containerId: src.containerId || null,
            sourceBatchId: src.sourceBatchId || null,
            weightKg: src.weightKg.toFixed(3),
            costPerKg: src.costPerKg.toFixed(4),
            totalCost: src.totalCost.toFixed(2),
          });
        }

        return batch;
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error creating mix batch:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/mix-batches/:id/sources", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid mix batch ID" });
      }

      const sources = await storage.getMixBatchSources(id, companyId);
      res.json(sources);
    } catch (error: any) {
      console.error("Error fetching mix batch sources:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/mix-batches/:id/sources", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const mixBatchId = parseInt(req.params.id);
      if (isNaN(mixBatchId)) {
        return res.status(400).json({ message: "Invalid mix batch ID" });
      }

      // Verify the mix batch belongs to this company
      const batch = await storage.getMixBatchById(mixBatchId, companyId);
      if (!batch) {
        return res.status(404).json({ message: "Mix batch not found" });
      }
      const data = insertMixBatchSourceSchema.parse({
        ...req.body,
        mixBatchId,
      });

      const source = await storage.addMixBatchSource(data);
      res.json(source);
    } catch (error: any) {
      console.error("Error adding mix batch source:", error);
      res.status(400).json({ message: error.message });
    }
  });

  registerProductionBaleRoutes(app);


  // Customer Balance API Routes
  app.get("/api/customers/:id/balance", requireAuth, async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const customerId = parseInt(req.params.id);
      if (isNaN(customerId)) {
        return res.status(400).json({ message: "Invalid customer ID" });
      }

      const balance = await storage.getCustomerBalance(customerId, companyId);
      res.json({ customerId, balance });
    } catch (error: any) {
      console.error("Error fetching customer balance:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/customers/:id/statement", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const customerId = parseInt(req.params.id);
      if (isNaN(customerId)) {
        return res.status(400).json({ message: "Invalid customer ID" });
      }

      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;

      const statement = await storage.getCustomerStatement(customerId, companyId, startDate, endDate);
      res.json(statement);
    } catch (error: any) {
      console.error("Error fetching customer statement:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/inventory-by-location/:locationId", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // Check if user is POS role
      const isPOS = req.session.currentRole === "POS";

      const locationId = parseInt(req.params.locationId);
      if (isNaN(locationId)) return res.status(400).json({ message: "Invalid location ID" });

      const items = await db
        .select({
          id: inventory.id,
          stockItemId: inventory.stockItemId,
          quantity: inventory.quantity,
          averageRate: inventory.averageRate,
          stockItemName: stockItems.name,
          stockItemCode: stockItems.code,
        })
        .from(inventory)
        .innerJoin(stockItems, eq(inventory.stockItemId, stockItems.id))
        .where(and(eq(inventory.locationId, locationId), sql`CAST(${inventory.quantity} AS NUMERIC) > 0`));

      // Strip cost fields for POS users
      const sanitizedItems = isPOS ? items.map(({ averageRate, ...rest }) => rest) : items;

      res.json(sanitizedItems);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  registerBaleTransferRoutes(app);

  app.get("/api/bales-by-location/:locationId", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const _locId = parseInt(req.params.locationId, 10);
      if (isNaN(_locId)) return res.status(400).json({ message: "Invalid location ID" });
      const bales = await storage.getProductionBalesByLocation(companyId, _locId);
      res.json(
        bales.map((b) => ({
          id: b.id,
          baleCode: b.baleCode,
          category: b.category,
          grade: b.grade,
          weightKg: b.weightKg,
          costPerKg: b.costPerKg,
          totalCost: b.totalCost,
        }))
      );
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Orphaned Records Cleanup API - Find and reassign vouchers with deleted locations + unbalanced vouchers
}
