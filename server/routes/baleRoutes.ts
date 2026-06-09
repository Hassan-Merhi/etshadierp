import type { Express } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { cache } from "../lib/simpleCache";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../auth";
import { upload, logAudit, getCurrentExchangeRate, calculateHistoricalLocationInventory, syncEmployeeBalancesFromEntries } from "./_helpers";
import {
  inventory, stockItems, stockGroups, stockItemCodeAliases,
  stockItemLocationPrices, stockTransferVouchers, stockTransferItems,
  stockAdjustmentVouchers, stockAdjustmentItems,
  containers, containerOffloads, containerOffloadItems, containerSales,
  containerCharges, containerTrackingImportRowSchema, updateContainerTrackingSchema,
  bankAccounts, fixedAssets, insertBankAccountSchema, insertFixedAssetSchema,
  insertStockGroupSchema, insertStockItemSchema, insertStockItemCodeAliasSchema,
  insertContainerSchema, offloadRequestSchema,
  purchaseOrders, poLineItems, insertContainerSaleSchema,
  vouchers, voucherEntries, salesItems, insertVoucherSchema, insertVoucherEntrySchema,
  insertSalesItemSchema,
  suppliers, customers, customerBalances, locations, employees, userLocations,
  auditLog, interCompanyTransfers, insertInterCompanyTransferSchema,
  ledgerAccounts, insertLedgerAccountSchema, 
  companies, users, userCompanyRoles, companySettings, insertCompanySettingsSchema,
  FEATURE_KEYS, fiscalPeriodClosures,
  wasteDispatches, wasteDispatchItems, insertWasteDispatchSchema,
  bales, baleProducts, baleProductCategories, baleTransfers,
  factoryBales, factoryBaleProducts, baleLabelPrints,
  factoryWorkers,
  factoryPressingBatches, factoryMixBatches, factoryMixBatchSources, factoryContainers, factorySuppliers,
  productionRawStock, mixBatches, productionBales,
  pressingBatches, baleTransferItems, systemSettings,
  factoryRawStock, erpPayrollRuns, referenceSequences, baleSequences,
  customerOrders, customerOrderBales,
  insertBaleSchema, insertBaleTransferSchema,
  
  dashboardCashAccounts, dashboardPayableAccounts, dashboardAccountSelections,
  insertDashboardCashAccountSchema, insertDashboardPayableAccountSchema,
  insertDashboardAccountSelectionSchema,
  creditNoteItems, 
  pendingBarcodes, insertPendingBarcodeSchema,
  storedFiles, spreadsheets, liveSpreadsheets,
  agentAccounts, insertAgentAccountSchema,
  salaryAdvances, salaryAdvanceDeductions,
  insertSalaryAdvanceSchema, insertSalaryAdvanceDeductionSchema,
  chatMessages,
  
  factorySettings as fSettings,
  factoryDaybookEntries as fde,
  factoryBaleSequences,
} from "@shared/schema";
import {
  eq, and, or, desc, asc, lt, gt, ne, inArray, sql, isNull, isNotNull, not, gte, lte, like, ilike,
} from "drizzle-orm";
import { format } from "date-fns";
import { z } from "zod";
import { readExcel, sheetToJson, createWorkbook, jsonToSheet, aoaToSheet, writeWorkbook } from "../excelHelper";
import { adjustInventory, reverseInventoryByExactValue } from "../inventoryHelper";
import { classifyNetPositionAccounts, getAccountNetBalance } from "../netPositionHelper";
import path from "path";
import fs from "fs";

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

      const validatedBales = balesData.map((b: any) => 
        insertBaleSchema.parse({ ...b, companyId })
      );

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

      const preview = await Promise.all(rows.map(async (row) => {
        const barcode = String(row.barcode || "").trim();
        const newPrice = parseFloat(String(row.price || ""));
        if (!barcode) return { barcode, status: "invalid", currentPrice: null, newPrice: null };
        if (isNaN(newPrice) || newPrice < 0) return { barcode, status: "invalid_price", currentPrice: null, newPrice: null };
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
      }));

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

  // Pending Barcodes API Routes - for pre-printing barcode labels
  app.get("/api/pending-barcodes", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const barcodes = await storage.getAllPendingBarcodes(companyId);
      res.json(barcodes);
    } catch (error: any) {
      console.error("Error fetching pending barcodes:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/pending-barcodes/:barcode", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const barcode = await storage.getPendingBarcodeByCode(req.params.barcode, companyId);
      if (!barcode) {
        return res.status(404).json({ message: "Barcode not found" });
      }
      res.json(barcode);
    } catch (error: any) {
      console.error("Error fetching pending barcode:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/pending-barcodes", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const data = insertPendingBarcodeSchema.parse({ ...req.body, companyId });
      const barcode = await storage.createPendingBarcode(data);
      res.json(barcode);
    } catch (error: any) {
      console.error("Error creating pending barcode:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/pending-barcodes/import", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const barcodes = req.body.barcodes || [];
      if (!Array.isArray(barcodes)) {
        return res.status(400).json({ message: "Invalid data format" });
      }
      const created = await storage.bulkCreatePendingBarcodes(
        barcodes.map((b: any) => ({
          companyId,
          barcode: b.barcode || b.code || b,
          category: b.category || null,
          grade: b.grade || null,
          origin: b.origin || null,
          printed: false,
          used: false,
        }))
      );
      res.json({ success: true, count: created.length, barcodes: created });
    } catch (error: any) {
      console.error("Error importing pending barcodes:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/pending-barcodes/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid barcode ID" });
      const barcode = await storage.updatePendingBarcode(id, req.body);
      res.json(barcode);
    } catch (error: any) {
      console.error("Error updating pending barcode:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/pending-barcodes/mark-printed", requireAuth, async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids)) {
        return res.status(400).json({ message: "ids must be an array" });
      }
      await storage.markBarcodesAsPrinted(ids);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error marking barcodes as printed:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/pending-barcodes/:id", requireAuth, async (req, res) => {
    try {
      const _bid = parseInt(req.params.id, 10);
      if (isNaN(_bid)) return res.status(400).json({ message: "Invalid barcode ID" });
      await storage.deletePendingBarcode(_bid);
      res.status(204).send();
    } catch (error: any) {
      console.error("Error deleting pending barcode:", error);
      res.status(400).json({ message: error.message });
    }
  });
  // Bale Product Categories API Routes
  app.get("/api/bale-product-categories", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const categories = await storage.getAllBaleProductCategories(companyId);
      res.json(categories);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/bale-product-categories", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const data = insertBaleProductCategorySchema.parse({ ...req.body, companyId });
      const existing = await storage.getBaleProductCategoryByName(data.name, companyId);
      if (existing) return res.status(409).json({ message: `Category "${data.name}" already exists` });
      const created = await storage.createBaleProductCategory(data);
      res.json(created);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/bale-product-categories/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid category ID" });
      const existing = await storage.getBaleProductCategoryById(id);
      if (!existing) return res.status(404).json({ message: "Category not found" });
      const updated = await storage.updateBaleProductCategory(id, req.body);
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/bale-product-categories/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid category ID" });
      const existing = await storage.getBaleProductCategoryById(id);
      if (!existing) return res.status(404).json({ message: "Category not found" });
      await storage.deleteBaleProductCategory(id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Bale Products API Routes
  app.get("/api/bale-products", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const products = await storage.getAllBaleProducts(companyId);
      res.json(products);
    } catch (error: any) {
      console.error("Error fetching bale products:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/bale-products/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid product ID" });
      }

      const product = await storage.getBaleProductById(id);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }

      res.json(product);
    } catch (error: any) {
      console.error("Error fetching bale product:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/bale-products", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      let articleCode = req.body.articleCode || "";
      if (!articleCode && req.body.itemNumber) {
        const num = parseInt(String(req.body.itemNumber));
        if (!isNaN(num) && num >= 1 && num <= 99) {
          articleCode = `HMD${String(num).padStart(2, '0')}000`;
        }
      }
      const code = req.body.code || articleCode || `AUTO-${Date.now()}`;
      const data = insertBaleProductSchema.parse({ ...req.body, companyId, articleCode: articleCode || undefined, code });

      if (articleCode) {
        const existingByArticle = await storage.getBaleProductByArticleCode(articleCode, companyId);
        if (existingByArticle) {
          return res.status(409).json({ message: "Article code already exists" });
        }
      }

      const product = await storage.createBaleProduct(data);
      res.json(product);
    } catch (error: any) {
      console.error("Error creating bale product:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/bale-products/:id", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid product ID" });
      }

      const existing = await storage.getBaleProductById(id);
      if (!existing) {
        return res.status(404).json({ message: "Product not found" });
      }

      if (existing.companyId !== companyId) {
        return res.status(403).json({ message: "Access denied" });
      }
      const data = insertBaleProductSchema.partial().parse(req.body);

      const product = await storage.updateBaleProduct(id, data);
      res.json(product);
    } catch (error: any) {
      console.error("Error updating bale product:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/bale-products/:id", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid product ID" });
      }

      const existing = await storage.getBaleProductById(id);
      if (!existing) {
        return res.status(404).json({ message: "Product not found" });
      }

      if (existing.companyId !== companyId) {
        return res.status(403).json({ message: "Access denied" });
      }

      await storage.deleteBaleProduct(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting bale product:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/bale-products/import-excel", requireAuth, upload.single("file"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const workbook = await readExcel(req.file.buffer);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rows = sheetToJson(worksheet);

      let created = 0;
      let updated = 0;
      let categoriesCreated = 0;

      await db.transaction(async (tx) => {
        const categoryCache: Record<string, number> = {};
        const existingCategories = await tx.select().from(baleProductCategories).where(eq(baleProductCategories.companyId, companyId));
        for (const cat of existingCategories) {
          categoryCache[cat.name.toLowerCase()] = cat.id;
        }

        for (const row of rows as any[]) {
          const itemNumber = row.itemNumber || row.item_number || row.ItemNumber;
          let articleCode = row.articleCode || row.article_code || row.ArticleCode || "";
          if (!articleCode && itemNumber) {
            const num = parseInt(String(itemNumber));
            if (!isNaN(num) && num >= 1 && num <= 99) {
              articleCode = `HMD${String(num).padStart(2, '0')}000`;
            }
          }

          if (!articleCode) continue;

          const name = row.name || row.Name || row.product_name || "";
          if (!name) continue;

          const categoryName = (row.category || row.Category || row.category_name || "").toString().trim();
          let categoryId: number | null = null;

          if (categoryName) {
            const lowerCat = categoryName.toLowerCase();
            if (categoryCache[lowerCat]) {
              categoryId = categoryCache[lowerCat];
            } else {
              const [newCat] = await tx.insert(baleProductCategories).values({
                companyId,
                name: categoryName,
                isActive: true,
              }).returning();
              categoryCache[lowerCat] = newCat.id;
              categoryId = newCat.id;
              categoriesCreated++;
            }
          }

          const code = row.code || row.Code || row.product_code || articleCode;
          const description = row.description || row.Description || "";
          const weightPerBaleKg = row.weightPerBaleKg || row.weight_per_bale_kg || row.weight || undefined;
          const active = row.active === undefined ? true : Boolean(row.active);

          const [existing] = await tx.select().from(baleProducts).where(
            and(eq(baleProducts.articleCode, articleCode), eq(baleProducts.companyId, companyId))
          );

          if (existing) {
            await tx.update(baleProducts).set({
              name,
              description: description || existing.description,
              weightPerBaleKg: weightPerBaleKg ? String(weightPerBaleKg) : existing.weightPerBaleKg,
              categoryId: categoryId ?? existing.categoryId,
              active,
              updatedAt: sql`now()`,
            }).where(eq(baleProducts.id, existing.id));
            updated++;
          } else {
            await tx.insert(baleProducts).values({
              companyId,
              code,
              articleCode,
              name,
              description,
              weightPerBaleKg: weightPerBaleKg ? String(weightPerBaleKg) : undefined,
              categoryId,
              active,
            });
            created++;
          }
        }
      });

      res.json({ success: true, created, updated, categoriesCreated, count: created + updated });
    } catch (error: any) {
      console.error("Error importing bale products from Excel:", error);
      res.status(400).json({ message: error.message });
    }
  });

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
      .for('update');
    const [baleSeq] = await tx
      .select()
      .from(factoryBaleSequences)
      .where(eq(factoryBaleSequences.companyId, companyId));

    const seqMax = Math.max(refSeq?.nextNumber ?? 0, baleSeq?.nextNumber ?? 0);
    const safeNext = Math.max(dbMax + 1, seqMax);
    const referenceNumber = `REF${String(safeNext).padStart(6, '0')}`;

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
              await tx
                .update(factoryBales)
                .set({ referenceNumber })
                .where(eq(factoryBales.id, bale.productionBaleId));
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
      const companyId = req.session.currentCompanyId || (req.session as any).factoryCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const articleCode = decodeURIComponent(req.params.articleCode);
      const product = await storage.getBaleProductByArticleCode(articleCode, companyId);
      const labelPrints = await storage.getBaleLabelPrintsByArticle(articleCode, companyId);

      // Enrich each label print with bale status so non-admin users can see deleted bales
      const refNumbers = labelPrints.map((lp) => lp.referenceNumber).filter(Boolean);
      let baleStatusMap: Record<string, string> = {};
      if (refNumbers.length > 0) {
        const baleRows = await db
          .select({ referenceNumber: factoryBales.referenceNumber, status: factoryBales.status })
          .from(factoryBales)
          .where(and(
            eq(factoryBales.companyId, companyId),
            inArray(factoryBales.referenceNumber, refNumbers),
          ));
        for (const b of baleRows) {
          if (b.referenceNumber) baleStatusMap[b.referenceNumber] = b.status;
        }
      }

      const enrichedLabelPrints = labelPrints.map((lp) => ({
        ...lp,
        baleStatus: baleStatusMap[lp.referenceNumber] ?? null,
      }));

      res.json({ product: product || null, labelPrints: enrichedLabelPrints });
    } catch (error: any) {
      console.error("Error looking up article:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Lookup by REFERENCE number
  app.get("/api/lookup/reference/:referenceNumber", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId || (req.session as any).factoryCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const referenceNumber = decodeURIComponent(req.params.referenceNumber).toUpperCase();
      const labelPrint = await storage.getBaleLabelPrintByReference(referenceNumber, companyId);

      // If no label print exists, try to find the bale directly in factory_bales
      // (bales can exist without a label print if entered manually / imported)
      if (!labelPrint) {
        const [directBale] = await db
          .select()
          .from(factoryBales)
          .where(and(eq(factoryBales.referenceNumber, referenceNumber), eq(factoryBales.companyId, companyId)))
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
          const [wk] = await db.select({ fullName: factoryWorkers.fullName }).from(factoryWorkers).where(eq(factoryWorkers.id, directBale.finalizedBy)).limit(1);
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
            status: directBale.status,
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
          const [wk] = await db.select({ fullName: factoryWorkers.fullName }).from(factoryWorkers).where(eq(factoryWorkers.id, factoryBale.finalizedBy)).limit(1);
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
                  const supplierRows = supplierIds.length > 0
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
                      supplierName: c.supplierId ? (supplierMap.get(c.supplierId) || null) : null,
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
      let loadedOnOrder: any = null;
      const [orderBaleRow] = await db
        .select()
        .from(customerOrderBales)
        .where(eq(customerOrderBales.baleReference, referenceNumber))
        .limit(1);

      if (orderBaleRow) {
        const [order] = await db
          .select()
          .from(customerOrders)
          .leftJoin(customers, eq(customerOrders.customerId, customers.id))
          .where(eq(customerOrders.id, orderBaleRow.orderId))
          .limit(1);

        if (order) {
          loadedOnOrder = {
            orderId: order.customer_orders.id,
            invoiceNumber: order.customer_orders.invoiceNumber,
            orderDate: order.customer_orders.orderDate,
            status: order.customer_orders.status,
            containerNumber: order.customer_orders.containerNumber,
            shippingCompany: order.customer_orders.shippingCompany,
            containerNotes: order.customer_orders.containerNotes,
            loadingStartedAt: order.customer_orders.loadingStartedAt,
            loadingFinalizedAt: order.customer_orders.loadingFinalizedAt,
            grandTotal: order.customer_orders.grandTotal,
            totalQtyBales: order.customer_orders.totalQtyBales,
            customerName: order.customers?.legalName || null,
            priceUsed: orderBaleRow.priceUsed,
            baleWeight: orderBaleRow.weight,
            scannedBy: orderBaleRow.scannedBy || null,
          };
        }
      }

      // Mark isInLoadingOrder on baleInfo so callers (e.g. Ground Scan) can show the right status
      if (baleInfo && loadedOnOrder?.status === "LOADING") {
        baleInfo.isInLoadingOrder = true;
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
      const companyId = req.session.currentCompanyId || (req.session as any).factoryCompanyId;
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
        .where(
          and(
            eq(baleLabelPrints.referenceNumber, referenceNumber),
            eq(baleLabelPrints.companyId, companyId)
          )
        )
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
  app.delete("/api/lookup/reference/:referenceNumber/delete-everywhere", requireAuth, requireRole("Admin", "Owner", "Developer"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId || (req.session as any).factoryCompanyId;
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
          return res.status(409).json({ message: "This bale is linked to a finalized/locked order and cannot be deleted from here." });
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
  });

  // Admin: Change the linked bale product (article code / product name) for a reference
  app.patch("/api/lookup/reference/:referenceNumber/change-product", requireAuth, requireRole("Admin", "Owner", "Developer"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId || (req.session as any).factoryCompanyId;
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
          return res.status(409).json({ message: "This bale is linked to a finalized/locked order and cannot be changed." });
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
          .set({ productId: newProduct.id, articleCode: newArticleCode, baleCode: newBaleCode, productName: newProductName, updatedAt: new Date() })
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
  });

  // Company Settings API Routes
  app.get("/api/company-settings", requireAuth, async (req, res) => {
    try {
      const { companyId: queryCompanyId } = req.query;
      const companyId = queryCompanyId
        ? parseInt(queryCompanyId as string)
        : req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const settings = await cache(`company_settings:${companyId}`, 30_000, () =>
        storage.getCompanySettings(companyId).then((s) => s || { companyId }),
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
      const companyId = bodyCompanyId
        ? parseInt(bodyCompanyId as string)
        : req.session.currentCompanyId;
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
        return res.status(400).json({ message: "Received weight is required. Container has no saved Total KG - please provide a value." });
      }
      if (!finalCostPerKg || parseFloat(finalCostPerKg) <= 0) {
        return res.status(400).json({ message: "Cost per kg is required. Container has no saved Rate per KG - please provide a value." });
      }

      const existing = await db
        .select()
        .from(productionRawStock)
        .where(and(eq(productionRawStock.companyId, companyId), eq(productionRawStock.containerId, parseInt(containerId))));

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

      const offloadedIdList = offloadedIds.map(r => r.containerId);

      const allContainers = await db
        .select()
        .from(containers)
        .where(
          and(
            eq(containers.companyId, companyId),
            eq(containers.status, "AVAILABLE")
          )
        );

      const available = allContainers.filter(c => !offloadedIdList.includes(c.id));
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

      const hasSources = (sources && Array.isArray(sources) && sources.length > 0);
      const hasBatchSources = (batchSources && Array.isArray(batchSources) && batchSources.length > 0);

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
        const batchCode = batchData.batchCode || `MB-${year}-${String(batchNum).padStart(3, '0')}`;

        let totalWeightKg = 0;
        let totalCost = 0;
        const validatedSources: Array<{ containerId?: number; sourceBatchId?: number; weightKg: number; costPerKg: number; totalCost: number }> = [];

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
              .where(and(
                eq(productionRawStock.companyId, companyId),
                eq(productionRawStock.containerId, cId)
              ))
              .for("update");

            if (!rawStock) {
              throw new Error(`Container ${cId} not found in production raw stock. Offload it first.`);
            }

            const remaining = parseFloat(rawStock.receivedKg) - parseFloat(rawStock.usedKg);
            if (wKg > remaining + 0.001) {
              throw new Error(`Container ${rawStock.containerId} only has ${remaining.toFixed(3)} kg remaining, requested ${wKg}`);
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
              .where(and(
                eq(mixBatches.id, srcBatchId),
                eq(mixBatches.companyId, companyId)
              ))
              .for("update");

            if (!srcBatch) {
              throw new Error(`Source batch ${srcBatchId} not found`);
            }

            const srcTotal = parseFloat(srcBatch.totalWeightKg);
            const srcUsed = parseFloat(srcBatch.usedKg);
            const srcRemaining = srcTotal - srcUsed;

            if (wKg > srcRemaining + 0.001) {
              throw new Error(`Batch ${srcBatch.batchCode} only has ${srcRemaining.toFixed(3)} kg remaining, requested ${wKg}`);
            }

            // Deduct from source batch's usedKg
            const newUsed = srcUsed + wKg;
            await tx
              .update(mixBatches)
              .set({
                usedKg: newUsed.toFixed(3),
                status: (newUsed >= srcTotal - 0.001) ? "COMPLETED" : srcBatch.status,
              })
              .where(eq(mixBatches.id, srcBatchId));

            const srcCostPerKg = parseFloat(srcBatch.costPerKg);
            const sCost = wKg * srcCostPerKg;
            totalWeightKg += wKg;
            totalCost += sCost;
            validatedSources.push({ sourceBatchId: srcBatchId, weightKg: wKg, costPerKg: srcCostPerKg, totalCost: sCost });
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
        mixBatchId 
      });

      const source = await storage.addMixBatchSource(data);
      res.json(source);
    } catch (error: any) {
      console.error("Error adding mix batch source:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // Production Bales API Routes
  app.get("/api/production-bales", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const filters: any = {};
      if (req.query.mixBatchId) filters.mixBatchId = parseInt(req.query.mixBatchId as string);
      if (req.query.status) filters.status = req.query.status as string;
      if (req.query.category) filters.category = req.query.category as string;
      if (req.query.grade) filters.grade = req.query.grade as string;

      const bales = await storage.getAllProductionBales(companyId, filters);
      res.json(bales);
    } catch (error: any) {
      console.error("Error fetching production bales:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/production-bales/barcode/:barcode", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const bale = await storage.getProductionBaleByBarcode(req.params.barcode, companyId);
      
      if (!bale) {
        return res.status(404).json({ message: "Bale not found" });
      }

      res.json(bale);
    } catch (error: any) {
      console.error("Error fetching bale by barcode:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/production-bales/create-batch", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { mixBatchId, productId, locationId, quantity, weightPerBale, mode } = req.body;

      const isPressing = mode === "pressing";

      if (!productId || !quantity || !weightPerBale) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      if (!isPressing && !mixBatchId) {
        return res.status(400).json({ message: "Mix batch is required for counting mode" });
      }

      if (!isPressing && !locationId) {
        return res.status(400).json({ message: "Location is required for counting mode" });
      }

      const numBales = parseInt(quantity);
      const weight = parseFloat(weightPerBale);

      if (isNaN(numBales) || numBales < 1 || numBales > 1000) {
        return res.status(400).json({ message: "Quantity must be between 1 and 1000" });
      }

      if (isNaN(weight) || weight <= 0 || weight > 500) {
        return res.status(400).json({ message: "Weight must be between 1 and 500 kg" });
      }

      // Get product for bale code
      const [product] = await db.select().from(baleProducts).where(eq(baleProducts.id, productId));
      if (!product || product.companyId !== companyId) {
        return res.status(404).json({ message: "Product not found" });
      }

      let batch: any = null;
      let costPerKg = 0;
      let totalCostPerBale = "0";

      if (mixBatchId) {
        batch = await storage.getMixBatchById(mixBatchId, companyId);
        if (!batch) {
          return res.status(404).json({ message: "Mix batch not found" });
        }

        const totalWeight = weight * numBales;
        const remainingKg = parseFloat(batch.totalWeightKg) - parseFloat(batch.usedKg || "0");
        if (totalWeight > remainingKg + 0.001) {
          return res.status(400).json({ 
            message: `Not enough remaining in mix batch. Available: ${remainingKg.toFixed(3)} kg, Requested: ${totalWeight.toFixed(3)} kg` 
          });
        }
        costPerKg = parseFloat(batch.costPerKg);
        totalCostPerBale = (weight * costPerKg).toFixed(2);
      }

      const totalWeight = weight * numBales;

      // Wrap everything in a transaction for atomicity
      const result = await db.transaction(async (tx) => {
        const createdBales = [];

        let pressingBatchId: number | null = null;
        if (isPressing) {
          const [pb] = await tx
            .insert(pressingBatches)
            .values({
              companyId,
              mixBatchId: mixBatchId || null,
              productId,
              expectedCount: numBales,
              status: "PENDING",
              createdBy: (req.session as any).userId || null,
            })
            .returning();
          pressingBatchId = pb.id;
        }
        
        // Create bales with unique barcodes (all within transaction)
        for (let i = 0; i < numBales; i++) {
          // Generate unique barcode within transaction
          const [sequence] = await tx
            .select()
            .from(baleSequences)
            .where(eq(baleSequences.companyId, companyId))
            .for('update'); // Lock the row

          let barcode: string;
          if (!sequence) {
            // Create new sequence
            const [newSeq] = await tx
              .insert(baleSequences)
              .values({ companyId, nextNumber: 2 })
              .returning();
            barcode = `HD${String(newSeq.nextNumber - 1).padStart(5, '0')}`;
          } else {
            // Increment and use
            barcode = `HD${String(sequence.nextNumber).padStart(5, '0')}`;
            await tx
              .update(baleSequences)
              .set({ nextNumber: sequence.nextNumber + 1 })
              .where(eq(baleSequences.id, sequence.id));
          }

          // Create bale within transaction
          const baleData = {
            companyId,
            mixBatchId: mixBatchId || null,
            productId,
            locationId: isPressing ? null : locationId,
            pressingBatchId,
            baleCode: product.code,
            barcodeValue: barcode,
            quantity: 1,
            weightKg: weight.toString(),
            costPerKg: costPerKg > 0 ? costPerKg.toString() : "0",
            totalCost: costPerKg > 0 ? totalCostPerBale : "0",
            status: isPressing ? "PENDING" : "IN_STOCK",
            pressedAt: new Date(),
          };
          
          const [bale] = await tx
            .insert(productionBales)
            .values(baleData)
            .returning();
          createdBales.push(bale);
        }

        if (batch && mixBatchId) {
          const newUsedKg = parseFloat(batch.usedKg || "0") + totalWeight;
          await tx
            .update(mixBatches)
            .set({
              usedKg: newUsedKg.toFixed(3),
              updatedAt: sql`now()`,
            })
            .where(eq(mixBatches.id, mixBatchId));
        }

        return { bales: createdBales, pressingBatchId };
      });

      res.json({ bales: result.bales, success: true, count: result.bales.length, pressingBatchId: result.pressingBatchId });
    } catch (error: any) {
      console.error("Error creating production bales:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/production-bales/pending", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const pending = await db
        .select({
          bale: productionBales,
          product: baleProducts,
          mixBatch: mixBatches,
        })
        .from(productionBales)
        .leftJoin(baleProducts, eq(productionBales.productId, baleProducts.id))
        .leftJoin(mixBatches, eq(productionBales.mixBatchId, mixBatches.id))
        .where(and(
          eq(productionBales.companyId, companyId),
          eq(productionBales.status, "PENDING")
        ))
        .orderBy(desc(productionBales.createdAt));

      res.json(pending);
    } catch (error: any) {
      console.error("Error fetching pending bales:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/production-bales/lookup/:barcode", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const barcode = req.params.barcode.trim();

      const results = await db
        .select({
          bale: productionBales,
          product: baleProducts,
          mixBatch: mixBatches,
        })
        .from(productionBales)
        .leftJoin(baleProducts, eq(productionBales.productId, baleProducts.id))
        .leftJoin(mixBatches, eq(productionBales.mixBatchId, mixBatches.id))
        .where(and(
          eq(productionBales.companyId, companyId),
          or(
            eq(productionBales.barcodeValue, barcode),
            eq(productionBales.baleCode, barcode)
          )
        ));

      if (results.length === 0) {
        return res.status(404).json({ message: "Bale not found" });
      }

      res.json(results[0]);
    } catch (error: any) {
      console.error("Error looking up bale:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/pressing-batches", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const batches = await db
        .select({
          batch: pressingBatches,
          product: baleProducts,
          mixBatch: mixBatches,
        })
        .from(pressingBatches)
        .leftJoin(baleProducts, eq(pressingBatches.productId, baleProducts.id))
        .leftJoin(mixBatches, eq(pressingBatches.mixBatchId, mixBatches.id))
        .where(eq(pressingBatches.companyId, companyId))
        .orderBy(desc(pressingBatches.createdAt));

      const batchesWithBales = await Promise.all(
        batches.map(async (b) => {
          const bales = await db
            .select()
            .from(productionBales)
            .where(and(
              eq(productionBales.pressingBatchId, b.batch.id),
              eq(productionBales.companyId, companyId)
            ));
          return {
            ...b,
            bales,
            pendingCount: bales.filter(bl => bl.status === "PENDING").length,
            finalizedCount: bales.filter(bl => bl.status !== "PENDING").length,
          };
        })
      );

      res.json(batchesWithBales);
    } catch (error: any) {
      console.error("Error fetching pressing batches:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/pressing-batches/:id", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const batchId = parseInt(req.params.id, 10);
      if (isNaN(batchId)) return res.status(400).json({ message: "Invalid batch ID" });

      const [batchRow] = await db
        .select({
          batch: pressingBatches,
          product: baleProducts,
          mixBatch: mixBatches,
        })
        .from(pressingBatches)
        .leftJoin(baleProducts, eq(pressingBatches.productId, baleProducts.id))
        .leftJoin(mixBatches, eq(pressingBatches.mixBatchId, mixBatches.id))
        .where(and(
          eq(pressingBatches.id, batchId),
          eq(pressingBatches.companyId, companyId)
        ));

      if (!batchRow) return res.status(404).json({ message: "Pressing batch not found" });

      const bales = await db
        .select()
        .from(productionBales)
        .where(and(
          eq(productionBales.pressingBatchId, batchId),
          eq(productionBales.companyId, companyId)
        ));

      res.json({
        ...batchRow,
        bales,
        pendingCount: bales.filter(b => b.status === "PENDING").length,
        finalizedCount: bales.filter(b => b.status !== "PENDING").length,
      });
    } catch (error: any) {
      console.error("Error fetching pressing batch:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/production-bales/finalize", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { pressingBatchId, scannedBaleIds, locationId, mixBatchId } = req.body;
      if (!locationId) return res.status(400).json({ message: "Location is required" });
      if (!pressingBatchId) return res.status(400).json({ message: "Pressing batch ID is required" });
      if (!mixBatchId) return res.status(400).json({ message: "Mix batch is required for raw material consumption" });
      if (!Array.isArray(scannedBaleIds) || scannedBaleIds.length === 0) {
        return res.status(400).json({ message: "No bale IDs provided" });
      }

      const [batch] = await db
        .select()
        .from(pressingBatches)
        .where(and(
          eq(pressingBatches.id, parseInt(pressingBatchId)),
          eq(pressingBatches.companyId, companyId)
        ));

      if (!batch) return res.status(404).json({ message: "Pressing batch not found" });
      if (batch.status === "FINALIZED") return res.status(400).json({ message: "This pressing batch has already been finalized" });

      const mixBatch = await storage.getMixBatchById(parseInt(mixBatchId), companyId);
      if (!mixBatch) return res.status(404).json({ message: "Mix batch not found" });

      const pendingBales = await db
        .select()
        .from(productionBales)
        .where(and(
          eq(productionBales.pressingBatchId, batch.id),
          eq(productionBales.companyId, companyId),
          eq(productionBales.status, "PENDING")
        ));

      const expectedCount = pendingBales.length;
      const scannedIds = scannedBaleIds.map((id: any) => parseInt(id));

      if (scannedIds.length !== expectedCount) {
        return res.status(400).json({
          message: `Count mismatch: expected ${expectedCount}, scanned ${scannedIds.length}`,
          expected: expectedCount,
          scanned: scannedIds.length,
        });
      }

      const pendingBaleIds = new Set(pendingBales.map(b => b.id));
      const invalidIds = scannedIds.filter((id: number) => !pendingBaleIds.has(id));
      if (invalidIds.length > 0) {
        return res.status(400).json({
          message: `Some scanned bales do not belong to this pressing batch or are not pending`,
          invalidIds,
        });
      }

      const scannedBaleRecords = pendingBales.filter(b => scannedIds.includes(b.id));
      const totalWeight = scannedBaleRecords.reduce((sum, b) => sum + parseFloat(b.weightKg || "0"), 0);
      const mixRemainingKg = parseFloat(mixBatch.totalWeightKg) - parseFloat(mixBatch.usedKg || "0");
      if (totalWeight > mixRemainingKg + 0.001) {
        return res.status(400).json({
          message: `Not enough remaining in mix batch. Available: ${mixRemainingKg.toFixed(3)} kg, Required: ${totalWeight.toFixed(3)} kg`,
        });
      }

      const costPerKg = parseFloat(mixBatch.costPerKg);

      const updated = await db.transaction(async (tx) => {
        const finalizedBales: any[] = [];
        for (const baleId of scannedIds) {
          const baleRecord = scannedBaleRecords.find(b => b.id === baleId);
          const baleWeight = parseFloat(baleRecord?.weightKg || "0");
          const baleTotalCost = (baleWeight * costPerKg).toFixed(2);

          const [updatedBale] = await tx
            .update(productionBales)
            .set({
              locationId: parseInt(locationId),
              mixBatchId: parseInt(mixBatchId),
              costPerKg: costPerKg.toString(),
              totalCost: baleTotalCost,
              status: "IN_STOCK",
              updatedAt: new Date(),
            })
            .where(and(
              eq(productionBales.id, baleId),
              eq(productionBales.companyId, companyId),
              eq(productionBales.status, "PENDING")
            ))
            .returning();

          if (updatedBale) finalizedBales.push(updatedBale);
        }

        const newUsedKg = parseFloat(mixBatch.usedKg || "0") + totalWeight;
        await tx
          .update(mixBatches)
          .set({
            usedKg: newUsedKg.toFixed(3),
            updatedAt: sql`now()`,
          })
          .where(eq(mixBatches.id, parseInt(mixBatchId)));

        await tx
          .update(pressingBatches)
          .set({
            status: "FINALIZED",
            mixBatchId: parseInt(mixBatchId),
            finalizedAt: new Date(),
            finalizedLocationId: parseInt(locationId),
          })
          .where(eq(pressingBatches.id, batch.id));

        return finalizedBales;
      });

      res.json({ updated: updated.length, bales: updated, pressingBatchId: batch.id });
    } catch (error: any) {
      console.error("Error finalizing bales:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/production-bales", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const data = insertProductionBaleSchema.parse({ ...req.body, companyId });

      const bale = await storage.createProductionBale(data);
      res.json(bale);
    } catch (error: any) {
      console.error("Error creating production bale:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/production-bales/bulk", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const balesData = req.body.bales || [];

      if (!Array.isArray(balesData)) {
        return res.status(400).json({ message: "Invalid data format" });
      }

      const validatedBales = balesData.map((b: any) => 
        insertProductionBaleSchema.parse({ ...b, companyId })
      );

      const created = await storage.bulkCreateProductionBales(validatedBales);
      res.json({ success: true, count: created.length, bales: created });
    } catch (error: any) {
      console.error("Error bulk creating bales:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/production-bales/next-barcode", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const barcode = await storage.getNextBaleBarcode(companyId);
      res.json({ barcode });
    } catch (error: any) {
      console.error("Error generating barcode:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/production-bales/scan", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { barcodeValue, weightKg, category, grade, warehouseLocation } = req.body;

      if (!barcodeValue || !weightKg || !category || !grade) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const bale = await storage.updateProductionBaleFromScan(
        barcodeValue,
        companyId,
        { weightKg, category, grade, warehouseLocation }
      );

      res.json(bale);
    } catch (error: any) {
      console.error("Error updating bale from scan:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/generate-barcode", requireAuth, async (req, res) => {
    try {
      const { text } = req.body;
      
      if (!text) {
        return res.status(400).json({ message: "Barcode text is required" });
      }

      const bwipjs = await getBwipjs();
      
      // Render to PNG buffer
      const png = await bwipjs.toBuffer({
        bcid: "code128",
        text: text,
        scale: 3,
        height: 10,
        includetext: true,
        textxalign: "center",
      });

      // Convert to base64 data URL
      const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
      res.json({ dataUrl });
    } catch (error: any) {
      console.error("Error generating barcode:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET endpoint to return barcode as PNG image (for print labels)
  app.get("/api/barcode/:code", requireAuth, async (req, res) => {
    try {
      const code = decodeURIComponent(req.params.code);
      
      if (!code) {
        return res.status(400).json({ message: "Barcode code is required" });
      }

      const bwipjs = await getBwipjs();
      
      const png = await bwipjs.toBuffer({
        bcid: "code128",
        text: code,
        scale: 14,
        height: 40,
        includetext: false,
        textxalign: "center",
        barcolor: "000000",
      });

      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(png);
    } catch (error: any) {
      console.error("Error generating barcode image:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/production-bales/:id", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid bale ID" });
      await storage.deleteProductionBale(id, companyId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting production bale:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/production-bales/:id/status", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid bale ID" });
      const { status } = req.body;
      const validStatuses = ["PENDING", "LABEL_PRINTED", "PRESSED", "IN_STOCK", "RESERVED", "SOLD"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
      }
      const { eq, and } = await import("drizzle-orm");

      const [updated] = await db
        .update(productionBales)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(productionBales.id, id), eq(productionBales.companyId, companyId)))
        .returning();

      if (!updated) {
        return res.status(404).json({ message: "Bale not found" });
      }

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating bale status:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/production-bales/bulk-status", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { ids, status } = req.body;
      const validStatuses = ["PENDING", "LABEL_PRINTED", "PRESSED", "IN_STOCK", "RESERVED", "SOLD"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
      }
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "No bale IDs provided" });
      }
      const { eq, and, inArray } = await import("drizzle-orm");

      const updated = await db
        .update(productionBales)
        .set({ status, updatedAt: new Date() })
        .where(and(
          inArray(productionBales.id, ids.map((id: any) => parseInt(id))),
          eq(productionBales.companyId, companyId)
        ))
        .returning();

      res.json({ updated: updated.length });
    } catch (error: any) {
      console.error("Error bulk updating bale status:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/production-bales/import-excel", requireAuth, upload.single("file"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      // Parse Excel file
      const workbook = await readExcel(req.file.buffer);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rows = sheetToJson(worksheet);
      const mixBatchId = req.body.mixBatchId ? parseInt(req.body.mixBatchId) : undefined;

      // Map Excel rows to bale data
      const balesData = rows.map((row: any) => {
        return insertProductionBaleSchema.parse({
          companyId,
          mixBatchId,
          baleCode: row.bale_code || row.baleCode || "",
          barcodeValue: row.barcode_value || row.barcodeValue || row.barcode || row.bale_code || row.baleCode || "",
          category: row.category || "",
          grade: row.grade || "",
          weightKg: row.weight_kg?.toString() || row.weightKg?.toString() || row.weight?.toString() || "0",
          costPerKg: row.cost_per_kg?.toString() || row.costPerKg?.toString() || "0",
          totalCost: row.total_cost?.toString() || row.totalCost?.toString() || "0",
          warehouseLocation: row.warehouse_location || row.warehouseLocation || "",
          status: row.status || "LABEL_PRINTED",
        });
      });

      const created = await storage.bulkCreateProductionBales(balesData);
      res.json({ success: true, count: created.length, bales: created });
    } catch (error: any) {
      console.error("Error importing Excel:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // Customer Balance API Routes
  app.get("/api/customers/:id/balance", requireAuth, async (req, res) => {
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
        .where(
          and(
            eq(inventory.locationId, locationId),
            sql`CAST(${inventory.quantity} AS NUMERIC) > 0`
          )
        );
      
      // Strip cost fields for POS users
      const sanitizedItems = isPOS
        ? items.map(({ averageRate, ...rest }) => rest)
        : items;
      
      res.json(sanitizedItems);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Bale Transfer Routes
  app.get("/api/bale-transfers", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const transfers = await db
        .select({
          id: baleTransfers.id,
          companyId: baleTransfers.companyId,
          sourceLocationId: baleTransfers.sourceLocationId,
          destinationLocationId: baleTransfers.destinationLocationId,
          transferDate: baleTransfers.transferDate,
          notes: baleTransfers.notes,
          createdBy: baleTransfers.createdBy,
          updatedBy: baleTransfers.updatedBy,
          status: baleTransfers.status,
          createdAt: baleTransfers.createdAt,
          updatedAt: baleTransfers.updatedAt,
          sourceLocationName: sql<string>`(SELECT name FROM locations WHERE id = ${baleTransfers.sourceLocationId})`,
          destinationLocationName: sql<string>`(SELECT name FROM locations WHERE id = ${baleTransfers.destinationLocationId})`,
          itemCount: sql<number>`(SELECT COUNT(*) FROM bale_transfer_items WHERE transfer_id = ${baleTransfers.id})::int`,
        })
        .from(baleTransfers)
        .where(eq(baleTransfers.companyId, companyId))
        .orderBy(desc(baleTransfers.createdAt));

      res.json(transfers);
    } catch (error: any) {
      console.error("Error fetching bale transfers:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/bale-transfers", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { sourceLocationId, destinationLocationId, transferDate, notes, items } = req.body;

      if (!sourceLocationId || !destinationLocationId || !transferDate || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "Missing required fields: sourceLocationId, destinationLocationId, transferDate, and items array" });
      }
      const createdBy = (req.session as any).username || "system";

      const result = await db.transaction(async (tx) => {
        const [transfer] = await tx
          .insert(baleTransfers)
          .values({
            companyId,
            sourceLocationId,
            destinationLocationId,
            transferDate,
            notes: notes || null,
            createdBy,
            status: "PENDING",
          })
          .returning();

        for (const item of items) {
          await tx.insert(baleTransferItems).values({
            transferId: transfer.id,
            productionBaleId: item.productionBaleId,
            quantity: item.quantity || 1,
            weightKg: item.weightKg.toString(),
            costPerKg: item.costPerKg.toString(),
            totalCost: item.totalCost.toString(),
          });

          await tx
            .update(productionBales)
            .set({
              locationId: destinationLocationId,
              status: "IN_STOCK",
              updatedAt: sql`now()`,
            })
            .where(eq(productionBales.id, item.productionBaleId));
        }

        return transfer;
      });

      // Write to factory daybook if this company has factory settings
      try {
        const [fSetting] = await db.select().from(fSettings).where(eq(fSettings.companyId, companyId));
        if (fSetting) {
          const totalCost = items.reduce((s: number, it: any) => s + parseFloat(it.totalCost || "0"), 0);
          await db.insert(fde).values({
            companyId,
            txDate: transferDate,
            txType: "BALE_TRANSFER",
            referenceId: result.id,
            referenceTable: "bale_transfers",
            description: notes || `Bale transfer #${result.id}`,
            currencyCode: "USD",
            amountCurrency: String(totalCost),
            fxRateToUsd: "1",
            amountUsd: String(totalCost),
            createdBy: null,
          });
        }
      } catch (dbErr) {
        console.error("Factory daybook write failed (non-fatal):", dbErr);
      }

      res.json({ success: true, transferId: result.id, transfer: result });
    } catch (error: any) {
      console.error("Error creating bale transfer:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/bale-transfers/:id", requireAuth, async (req, res) => {
    try {
      const transferId = parseInt(req.params.id);
      if (isNaN(transferId)) return res.status(400).json({ message: "Invalid transfer ID" });

      const [transfer] = await db
        .select({
          id: baleTransfers.id,
          companyId: baleTransfers.companyId,
          sourceLocationId: baleTransfers.sourceLocationId,
          destinationLocationId: baleTransfers.destinationLocationId,
          transferDate: baleTransfers.transferDate,
          notes: baleTransfers.notes,
          createdBy: baleTransfers.createdBy,
          updatedBy: baleTransfers.updatedBy,
          status: baleTransfers.status,
          createdAt: baleTransfers.createdAt,
          updatedAt: baleTransfers.updatedAt,
          sourceLocationName: sql<string>`(SELECT name FROM locations WHERE id = ${baleTransfers.sourceLocationId})`,
          destinationLocationName: sql<string>`(SELECT name FROM locations WHERE id = ${baleTransfers.destinationLocationId})`,
        })
        .from(baleTransfers)
        .where(eq(baleTransfers.id, transferId));

      if (!transfer) return res.status(404).json({ message: "Transfer not found" });

      const items = await db
        .select({
          id: baleTransferItems.id,
          transferId: baleTransferItems.transferId,
          productionBaleId: baleTransferItems.productionBaleId,
          quantity: baleTransferItems.quantity,
          weightKg: baleTransferItems.weightKg,
          costPerKg: baleTransferItems.costPerKg,
          totalCost: baleTransferItems.totalCost,
          createdAt: baleTransferItems.createdAt,
          baleCode: productionBales.baleCode,
          barcodeValue: productionBales.barcodeValue,
          baleCategory: productionBales.category,
          baleGrade: productionBales.grade,
          baleStatus: productionBales.status,
          productName: baleProducts.name,
          productCode: baleProducts.code,
        })
        .from(baleTransferItems)
        .leftJoin(productionBales, eq(baleTransferItems.productionBaleId, productionBales.id))
        .leftJoin(baleProducts, eq(productionBales.productId, baleProducts.id))
        .where(eq(baleTransferItems.transferId, transferId));

      res.json({ ...transfer, items });
    } catch (error: any) {
      console.error("Error fetching bale transfer:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/bale-transfers/:id/complete", requireAuth, async (req, res) => {
    try {
      const transferId = parseInt(req.params.id);
      if (isNaN(transferId)) return res.status(400).json({ message: "Invalid transfer ID" });

      const [transfer] = await db
        .select()
        .from(baleTransfers)
        .where(eq(baleTransfers.id, transferId));

      if (!transfer) return res.status(404).json({ message: "Transfer not found" });

      const [updated] = await db
        .update(baleTransfers)
        .set({
          status: "COMPLETED",
          updatedBy: (req.session as any).username || "system",
          updatedAt: sql`now()`,
        })
        .where(eq(baleTransfers.id, transferId))
        .returning();

      res.json({ success: true, transfer: updated });
    } catch (error: any) {
      console.error("Error completing bale transfer:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/bale-transfers/:id", requireAuth, async (req, res) => {
    try {
      const transferId = parseInt(req.params.id);
      if (isNaN(transferId)) return res.status(400).json({ message: "Invalid transfer ID" });

      const [transfer] = await db
        .select()
        .from(baleTransfers)
        .where(eq(baleTransfers.id, transferId));

      if (!transfer) return res.status(404).json({ message: "Transfer not found" });

      if (transfer.status !== "PENDING") {
        return res.status(400).json({ message: "Only PENDING transfers can be deleted" });
      }

      await db.transaction(async (tx) => {
        const items = await tx
          .select()
          .from(baleTransferItems)
          .where(eq(baleTransferItems.transferId, transferId));

        for (const item of items) {
          await tx
            .update(productionBales)
            .set({
              locationId: transfer.sourceLocationId,
              updatedAt: sql`now()`,
            })
            .where(eq(productionBales.id, item.productionBaleId));
        }

        await tx.delete(baleTransferItems).where(eq(baleTransferItems.transferId, transferId));
        await tx.delete(baleTransfers).where(eq(baleTransfers.id, transferId));
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting bale transfer:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/bale-transfers/:id", requireAuth, async (req, res) => {
    try {
      const { items, status, notes } = req.body;
      const transferId = parseInt(req.params.id, 10);
      if (isNaN(transferId)) return res.status(400).json({ message: "Invalid transfer ID" });
      
      await storage.updateBaleTransfer(transferId, {
        status,
        notes,
        updatedBy: (req.session as any).username || "system"
      });

      if (items) {
        for (const item of items) {
          if (item.id) {
            await storage.updateBaleTransferItem(item.id, {
              weightKg: item.weightKg.toString(),
              costPerKg: item.costPerKg.toString(),
              totalCost: item.totalCost.toString()
            });
          } else {
            await storage.createBaleTransferItem({
              transferId,
              productionBaleId: item.productionBaleId,
              quantity: item.quantity,
              weightKg: item.weightKg.toString(),
              costPerKg: item.costPerKg.toString(),
              totalCost: item.totalCost.toString()
            });
          }
        }
      }

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/bales-by-location/:locationId", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      
      const _locId = parseInt(req.params.locationId, 10);
      if (isNaN(_locId)) return res.status(400).json({ message: "Invalid location ID" });
      const bales = await storage.getProductionBalesByLocation(companyId, _locId);
      res.json(bales.map(b => ({
        id: b.id,
        baleCode: b.baleCode,
        category: b.category,
        grade: b.grade,
        weightKg: b.weightKg,
        costPerKg: b.costPerKg,
        totalCost: b.totalCost
      })));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Orphaned Records Cleanup API - Find and reassign vouchers with deleted locations + unbalanced vouchers
}
