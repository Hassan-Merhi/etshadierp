import { getClientDate } from "../../lib/dateUtils";
import type { Express } from "express";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { classifyNetPositionAccounts } from "../../netPositionHelper";
import { adjustInventory } from "../../inventoryHelper";
import {
  writeDaybookEntry, getOrFetchFxRateToUsd, getOrCreateLedgerAccount,
  isLegacySHA256Hash, verifySupervisorPassword,
} from "./_helpers";
import {
  factorySuppliers, factoryCategories, factoryBaleProducts,
  factoryContainers, factoryRawStock, factoryMixBatches,
  factoryMixBatchSources, factoryDailyUsages, factoryPressingBatches,
  factoryBales, factoryBaleSequences, factoryContainerCommissions,
  baleLabelPrints, stockItems, stockGroups, users,
  insertFactorySupplierSchema, insertFactoryCategorySchema,
  insertFactoryBaleProductSchema, insertFactoryContainerSchema,
  insertFactoryRawStockSchema, insertFactoryMixBatchSchema,
  insertFactoryMixBatchSourceSchema, insertFactoryPressingBatchSchema,
  insertFactoryBaleSchema, customerProformas, customerProformaLines,
  customerOrders, customerOrderLines, customerOrderBales,
  customerOrderCharges, customerInvoiceSequences, customerBalances,
  customers, insertCustomerSchema, ledgerAccounts, voucherEntries,
  companies, locations, userCompanyRoles, insertCustomerProformaSchema,
  insertCustomerProformaLineSchema, insertCustomerOrderSchema,
  factoryFxRates, insertFactoryFxRateSchema, factoryDaybookEntries,
  containerDocumentTypes, containerDocuments, containerFreight,
  containerFreightPayments, factoryDaybookEntryEdits,
  containers, factoryUserProfiles, factoryUserPageAccess,
  insertUserSchema, directMessages, insertDirectMessageSchema,
  userPresence, factoryDutyAuditLog, factoryOffloadAdditionalCharges,
  factoryContainerOtherCharges, companySettings, factorySettings,
  factoryWorkers, factoryWorkerCategories, insertFactoryWorkerCategorySchema,
  factoryRawMaterialAdjustments, factoryPayrolls, factoryWorkerDocuments,
  factoryAlerts, employees, factoryWasteEntries, factoryBalePhotos,
  factoryDailyKpiSnapshots, factorySupplierScoreSnapshots,
  factoryBaleCostSnapshots, factoryContainerProfitSnapshots,
  bankAccounts, inventory, exchangeRates, vouchers, suppliers,
  containerSales, factorySupplierPayments, insertFactorySupplierPaymentSchema,
  factorySupplierFxTransfers, insertFactorySupplierFxTransferSchema,
  factoryFxAllocations, baleRecodeSessions, baleRecodeItems,
  factoryWorkerAdvances, factoryAdvanceRepayments, factoryBaleWasteDispatches,
  factoryPosSales, factoryPosSaleItems, proformaStockReservations,
} from "@shared/schema";
import { eq, and, or, asc, desc, sql, inArray, ilike, ne, isNull, not, gte, lte, lt, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import CryptoJS from "crypto-js";
import multer from "multer";
import path from "path";
import fs from "fs";

export function registerFactoryProductsRoutes(app: Express) {
  app.get("/api/factory/categories", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const results = await db
        .select()
        .from(factoryCategories)
        .where(eq(factoryCategories.companyId, companyId))
        .orderBy(factoryCategories.name);

      res.json(results);
    } catch (error: any) {
      console.error("Error fetching factory categories:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/categories", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const parsed = insertFactoryCategorySchema.parse({ ...req.body, companyId });
      const [category] = await db.insert(factoryCategories).values(parsed).returning();
      res.json(category);
    } catch (error: any) {
      console.error("Error creating factory category:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/factory/categories/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [updated] = await db
        .update(factoryCategories)
        .set({ ...req.body, updatedAt: new Date() })
        .where(and(eq(factoryCategories.id, id), eq(factoryCategories.companyId, companyId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Category not found" });
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating factory category:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/factory/categories/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [updated] = await db
        .update(factoryCategories)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(factoryCategories.id, id), eq(factoryCategories.companyId, companyId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Category not found" });
      res.json(updated);
    } catch (error: any) {
      console.error("Error deleting factory category:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 3. Factory Bale Products CRUD + Import
  // ───────────────────────────────────────────────

  app.get("/api/factory/bale-products", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const results = await db
        .select()
        .from(factoryBaleProducts)
        .where(eq(factoryBaleProducts.companyId, companyId))
        .orderBy(factoryBaleProducts.id);

      res.json(results);
    } catch (error: any) {
      console.error("Error fetching factory bale products:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/bale-products/generate-code", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const grade = req.query.grade as string;
      const gradeToPrefix: Record<string, string> = {
        "CREAM": "HMD10",
        "#1": "HMD11",
        "#2": "HMD12",
        "#3": "HMD13",
        "#4": "HMD14",
        "Garbage": "HMD16",
      };

      if (!grade || !gradeToPrefix[grade]) {
        return res.status(400).json({ message: "Valid grade is required (CREAM, #1, #2, #3, #4, Garbage)" });
      }

      const prefix = gradeToPrefix[grade];
      const prefixLen = prefix.length;
      const [maxResult] = await db
        .select({ maxNum: sql<number>`COALESCE(MAX(CAST(SUBSTRING(${factoryBaleProducts.articleCode} FROM ${prefixLen + 1}) AS INTEGER)), 0)` })
        .from(factoryBaleProducts)
        .where(and(
          eq(factoryBaleProducts.companyId, companyId),
          sql`${factoryBaleProducts.articleCode} LIKE ${prefix + '%'}`,
          sql`SUBSTRING(${factoryBaleProducts.articleCode} FROM ${prefixLen + 1}) ~ '^[0-9]+$'`
        ));

      let nextNum = (maxResult?.maxNum || 0) + 1;
      let candidateCode = `${prefix}${String(nextNum).padStart(3, "0")}`;
      let attempts = 0;
      while (attempts < 100) {
        const candidateCodeClean = candidateCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().substring(0, 50);
        const [dupArticle] = await db
          .select({ id: factoryBaleProducts.id })
          .from(factoryBaleProducts)
          .where(and(eq(factoryBaleProducts.companyId, companyId), eq(factoryBaleProducts.articleCode, candidateCode)));
        const [dupCode] = await db
          .select({ id: factoryBaleProducts.id })
          .from(factoryBaleProducts)
          .where(and(eq(factoryBaleProducts.companyId, companyId), eq(factoryBaleProducts.code, candidateCodeClean)));
        if (!dupArticle && !dupCode) break;
        nextNum++;
        candidateCode = `${prefix}${String(nextNum).padStart(3, "0")}`;
        attempts++;
      }

      res.json({ articleCode: candidateCode });
    } catch (error: any) {
      console.error("Error generating article code:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/bale-products/merge-stats — must be before /:id to avoid interception
  app.get("/api/factory/bale-products/merge-stats", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const rows = await db.execute(sql`
        SELECT
          fbp.id,
          fbp.code,
          fbp.article_code AS "articleCode",
          fbp.name,
          fbp.active,
          fbp.category_id AS "categoryId",
          COUNT(fb.id) FILTER (WHERE fb.status NOT IN ('REMOVED','DELETED')) AS "totalBales",
          COUNT(fb.id) FILTER (WHERE fb.status = 'IN_STOCK') AS "inStockBales"
        FROM factory_bale_products fbp
        LEFT JOIN factory_bales fb ON fb.product_id = fbp.id AND fb.company_id = ${companyId}
        WHERE fbp.company_id = ${companyId}
        GROUP BY fbp.id, fbp.code, fbp.article_code, fbp.name, fbp.active, fbp.category_id
        ORDER BY fbp.id ASC
      `);

      res.json(rows.rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/bale-products/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(404).json({ message: "Product not found" });
      const [product] = await db
        .select()
        .from(factoryBaleProducts)
        .where(and(eq(factoryBaleProducts.id, id), eq(factoryBaleProducts.companyId, companyId)));

      if (!product) return res.status(404).json({ message: "Product not found" });
      res.json(product);
    } catch (error: any) {
      console.error("Error fetching factory bale product:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/bale-product-detail/:productId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const productId = parseInt(req.params.productId);
      if (!productId) return res.status(400).json({ message: "Invalid product ID" });

      const [product] = await db.select().from(factoryBaleProducts)
        .where(and(eq(factoryBaleProducts.id, productId), eq(factoryBaleProducts.companyId, companyId)));
      if (!product) return res.status(404).json({ message: "Product not found" });

      const articleCode = product.articleCode;

      // 1. Pressed/Printed: bales grouped by entry date
      const allBales = await db.select({
        createdAt: factoryBales.createdAt,
        pressedAt: factoryBales.pressedAt,
        weightKg: factoryBales.weightKg,
        totalCost: factoryBales.totalCost,
        status: factoryBales.status,
      }).from(factoryBales)
        .where(and(
          eq(factoryBales.companyId, companyId),
          eq(factoryBales.productId, productId),
          inArray(factoryBales.status, ['IN_STOCK', 'SOLD', 'REMOVED', 'DELETED', 'DISPATCHED'])
        ))
        .orderBy(factoryBales.createdAt);

      const pressedMap = new Map<string, { date: string; qty: number; totalWeight: number; totalCost: number }>();
      for (const bale of allBales) {
        const dateKey = ((bale.pressedAt || bale.createdAt) as Date).toISOString().split('T')[0];
        const existing = pressedMap.get(dateKey) || { date: dateKey, qty: 0, totalWeight: 0, totalCost: 0 };
        existing.qty += 1;
        existing.totalWeight += parseFloat(bale.weightKg as any) || 0;
        existing.totalCost += parseFloat(bale.totalCost as any) || 0;
        pressedMap.set(dateKey, existing);
      }
      const pressed = Array.from(pressedMap.values()).sort((a, b) => b.date.localeCompare(a.date));

      // 2. Sales: finalized orders for this article code
      const sales: any[] = [];
      // 3. Loaded/OTW: loading-status orders for this article code
      const loaded: any[] = [];

      if (articleCode) {
        const orderBalesForProduct = await db.select({
          orderId: customerOrderBales.orderId,
          weight: customerOrderBales.weight,
          priceUsed: customerOrderBales.priceUsed,
        }).from(customerOrderBales)
          .where(eq(customerOrderBales.articleCode, articleCode));

        if (orderBalesForProduct.length > 0) {
          const orderIds = [...new Set(orderBalesForProduct.map((b: any) => b.orderId))];

          const allRelevantOrders = await db.select({
            id: customerOrders.id,
            invoiceNumber: customerOrders.invoiceNumber,
            orderDate: customerOrders.orderDate,
            customerId: customerOrders.customerId,
            status: customerOrders.status,
            containerNumber: customerOrders.containerNumber,
          }).from(customerOrders)
            .where(and(
              eq(customerOrders.companyId, companyId),
              inArray(customerOrders.id, orderIds)
            ));

          for (const order of allRelevantOrders) {
            const balesInOrder = orderBalesForProduct.filter((b: any) => b.orderId === order.id);
            const qty = balesInOrder.length;
            const total = balesInOrder.reduce((s: number, b: any) => s + parseFloat(b.priceUsed || '0'), 0);
            const pricePerBale = qty > 0 ? total / qty : 0;

            const [customer] = await db.select({ legalName: customers.legalName }).from(customers)
              .where(eq(customers.id, order.customerId));

            const entry = {
              orderId: order.id,
              invoiceNumber: order.invoiceNumber || `Order #${order.id}`,
              orderDate: order.orderDate,
              containerNumber: order.containerNumber,
              customerName: customer?.legalName || 'Unknown',
              qty,
              pricePerBale: pricePerBale.toFixed(2),
              total: total.toFixed(2),
              status: order.status,
            };

            if (order.status === 'FINALIZED') {
              sales.push(entry);
            } else if (['LOADING', 'PENDING_VERIFICATION', 'VERIFIED'].includes(order.status)) {
              loaded.push(entry);
            }
          }

          sales.sort((a: any, b: any) => b.orderDate.localeCompare(a.orderDate));
          loaded.sort((a: any, b: any) => b.orderDate.localeCompare(a.orderDate));
        }
      }

      // Current stock: IN_STOCK + FINALIZED bales grouped by location
      const inStockBales = await db.select({
        id: factoryBales.id,
        weightKg: factoryBales.weightKg,
        erpLocationId: factoryBales.erpLocationId,
      }).from(factoryBales)
        .where(and(
          eq(factoryBales.companyId, companyId),
          eq(factoryBales.productId, productId),
          eq(factoryBales.status, 'IN_STOCK')
        ));

      const locStockMap = new Map<number, { locationId: number; locationName: string; qty: number; totalWeight: number }>();
      for (const bale of inStockBales) {
        const locId = bale.erpLocationId ?? 0;
        const existing = locStockMap.get(locId) ?? { locationId: locId, locationName: 'Unknown', qty: 0, totalWeight: 0 };
        existing.qty += 1;
        existing.totalWeight += parseFloat(bale.weightKg as any) || 0;
        locStockMap.set(locId, existing);
      }
      const locIds = [...locStockMap.keys()].filter(id => id > 0);
      if (locIds.length > 0) {
        const locRecords = await db.select({ id: locations.id, name: locations.name })
          .from(locations)
          .where(inArray(locations.id, locIds));
        for (const loc of locRecords) {
          const entry = locStockMap.get(loc.id);
          if (entry) entry.locationName = loc.name;
        }
      }
      const currentStock = {
        totalQty: inStockBales.length,
        totalWeight: inStockBales.reduce((s, b) => s + (parseFloat(b.weightKg as any) || 0), 0),
        locations: Array.from(locStockMap.values()).sort((a, b) => b.qty - a.qty),
      };

      return res.json({ product, pressed, sales, loaded, currentStock });
    } catch (error: any) {
      console.error("Error fetching bale product detail:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/bale-products", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const callerRole = req.user?.role || "";
      const isPrivileged = ["Admin", "Owner", "Developer"].includes(callerRole);
      if (!isPrivileged) {
        const { adminAuth } = req.body;
        if (!adminAuth?.username || !adminAuth?.password) {
          return res.status(403).json({ message: "Admin authorization required to create products" });
        }
        const [adminUser] = await db.select().from(users).where(eq(users.username, adminAuth.username));
        if (!adminUser || !adminUser.active) {
          return res.status(403).json({ message: "Invalid admin credentials" });
        }
        const passwordValid = await verifySupervisorPassword(adminAuth.password, adminUser.password);
        if (!passwordValid) {
          return res.status(403).json({ message: "Invalid admin credentials" });
        }
        const [adminRole] = await db.select().from(userCompanyRoles)
          .where(and(eq(userCompanyRoles.userId, adminUser.id), eq(userCompanyRoles.companyId, companyId)));
        if (!adminRole || !["Admin", "Owner", "Developer"].includes(adminRole.role)) {
          return res.status(403).json({ message: "The provided user does not have admin access to this company" });
        }
      }

      let code = req.body.code;
      let articleCode = req.body.articleCode;
      const grade = req.body.grade;

      const gradeToPrefix: Record<string, string> = {
        "CREAM": "HMD10",
        "#1": "HMD11",
        "#2": "HMD12",
        "#3": "HMD13",
        "#4": "HMD14",
        "Garbage": "HMD16",
      };

      if (!articleCode && grade && gradeToPrefix[grade]) {
        const prefix = gradeToPrefix[grade];
        const prefixLen = prefix.length;
        const [maxResult] = await db
          .select({ maxNum: sql<number>`COALESCE(MAX(CAST(SUBSTRING(${factoryBaleProducts.articleCode} FROM ${prefixLen + 1}) AS INTEGER)), 0)` })
          .from(factoryBaleProducts)
          .where(and(
            eq(factoryBaleProducts.companyId, companyId),
            sql`${factoryBaleProducts.articleCode} LIKE ${prefix + '%'}`,
            sql`SUBSTRING(${factoryBaleProducts.articleCode} FROM ${prefixLen + 1}) ~ '^[0-9]+$'`
          ));
        let nextNum = (maxResult?.maxNum || 0) + 1;
        let candidateCode = `${prefix}${String(nextNum).padStart(3, "0")}`;
        let attempts = 0;
        while (attempts < 100) {
          const candidateCodeClean = candidateCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().substring(0, 50);
          const [dupArticle] = await db
            .select({ id: factoryBaleProducts.id })
            .from(factoryBaleProducts)
            .where(and(eq(factoryBaleProducts.companyId, companyId), eq(factoryBaleProducts.articleCode, candidateCode)));
          const [dupCode] = await db
            .select({ id: factoryBaleProducts.id })
            .from(factoryBaleProducts)
            .where(and(eq(factoryBaleProducts.companyId, companyId), eq(factoryBaleProducts.code, candidateCodeClean)));
          if (!dupArticle && !dupCode) break;
          nextNum++;
          candidateCode = `${prefix}${String(nextNum).padStart(3, "0")}`;
          attempts++;
        }
        articleCode = candidateCode;
      } else if (!articleCode) {
        const noGradePrefix = "HMD00";
        const noGradePrefixLen = noGradePrefix.length;
        const [noGradeMax] = await db
          .select({ maxNum: sql<number>`COALESCE(MAX(CAST(SUBSTRING(${factoryBaleProducts.articleCode} FROM ${noGradePrefixLen + 1}) AS INTEGER)), 0)` })
          .from(factoryBaleProducts)
          .where(and(
            eq(factoryBaleProducts.companyId, companyId),
            sql`${factoryBaleProducts.articleCode} LIKE ${noGradePrefix + '%'}`,
            sql`SUBSTRING(${factoryBaleProducts.articleCode} FROM ${noGradePrefixLen + 1}) ~ '^[0-9]+$'`
          ));
        let noGradeNext = (noGradeMax?.maxNum || 0) + 1;
        articleCode = `${noGradePrefix}${String(noGradeNext).padStart(3, "0")}`;
        let noGradeAttempts = 0;
        while (noGradeAttempts < 100) {
          const [dupCheck] = await db.select({ id: factoryBaleProducts.id }).from(factoryBaleProducts)
            .where(and(eq(factoryBaleProducts.companyId, companyId), eq(factoryBaleProducts.articleCode, articleCode)));
          if (!dupCheck) break;
          noGradeNext++;
          articleCode = `${noGradePrefix}${String(noGradeNext).padStart(3, "0")}`;
          noGradeAttempts++;
        }
      }

      if (articleCode) {
        // Helper: check both articleCode AND code uniqueness within the company
        const codeClean = articleCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().substring(0, 50);
        const [existingArticle] = await db.select({ id: factoryBaleProducts.id }).from(factoryBaleProducts)
          .where(and(eq(factoryBaleProducts.companyId, companyId), eq(factoryBaleProducts.articleCode, articleCode)));
        const [existingCode] = await db.select({ id: factoryBaleProducts.id }).from(factoryBaleProducts)
          .where(and(eq(factoryBaleProducts.companyId, companyId), eq(factoryBaleProducts.code, codeClean)));

        if (existingArticle || existingCode) {
          // Either articleCode or code is already taken — try to regenerate from the grade prefix
          const knownPrefixes = ["HMD10", "HMD11", "HMD12", "HMD13", "HMD14", "HMD16"];
          const matchedPrefix = knownPrefixes.find(p => articleCode.startsWith(p) && /^\d+$/.test(articleCode.slice(p.length)));
          if (matchedPrefix) {
            const prefix = matchedPrefix;
            const prefixLen = prefix.length;
            const [maxResult] = await db
              .select({ maxNum: sql<number>`COALESCE(MAX(CAST(SUBSTRING(${factoryBaleProducts.articleCode} FROM ${prefixLen + 1}) AS INTEGER)), 0)` })
              .from(factoryBaleProducts)
              .where(and(
                eq(factoryBaleProducts.companyId, companyId),
                sql`${factoryBaleProducts.articleCode} LIKE ${prefix + '%'}`,
                sql`SUBSTRING(${factoryBaleProducts.articleCode} FROM ${prefixLen + 1}) ~ '^[0-9]+$'`
              ));
            let nextNum = (maxResult?.maxNum || 0) + 1;
            let candidateCode = `${prefix}${String(nextNum).padStart(3, "0")}`;
            let attempts = 0;
            while (attempts < 200) {
              const candidateCodeClean = candidateCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().substring(0, 50);
              const [dupA] = await db.select({ id: factoryBaleProducts.id }).from(factoryBaleProducts)
                .where(and(eq(factoryBaleProducts.companyId, companyId), eq(factoryBaleProducts.articleCode, candidateCode)));
              const [dupC] = await db.select({ id: factoryBaleProducts.id }).from(factoryBaleProducts)
                .where(and(eq(factoryBaleProducts.companyId, companyId), eq(factoryBaleProducts.code, candidateCodeClean)));
              if (!dupA && !dupC) break;
              nextNum++;
              candidateCode = `${prefix}${String(nextNum).padStart(3, "0")}`;
              attempts++;
            }
            articleCode = candidateCode;
            code = articleCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().substring(0, 50);
          } else {
            return res.status(400).json({ message: "A product with this article code already exists" });
          }
        } else {
          // Both are free — use the cleaned code
          code = codeClean;
        }
      }

      // Reject duplicate names (case-insensitive) within same company
      const nameToCheck = (req.body.name || "").trim();
      if (nameToCheck) {
        const [nameDup] = await db
          .select({ id: factoryBaleProducts.id })
          .from(factoryBaleProducts)
          .where(and(
            eq(factoryBaleProducts.companyId, companyId),
            sql`LOWER(${factoryBaleProducts.name}) = LOWER(${nameToCheck})`
          ));
        if (nameDup) {
          return res.status(400).json({ message: `A product named "${nameToCheck}" already exists` });
        }
      }

      // Try insert; if code/articleCode constraint fires (race condition),
      // keep incrementing the numeric suffix until we find a free slot.
      let product: any;
      const knownPrefixesRetry = ["HMD10", "HMD11", "HMD12", "HMD13", "HMD14", "HMD16", "HMD00"];
      const retryPrefix = knownPrefixesRetry.find(p => articleCode.startsWith(p) && /^\d+$/.test(articleCode.slice(p.length)));
      let retryAttempts = 0;
      while (true) {
        try {
          const parsed = insertFactoryBaleProductSchema.parse({ ...req.body, companyId, code, articleCode });
          [product] = await db.insert(factoryBaleProducts).values(parsed).returning();
          break;
        } catch (insertErr: any) {
          const msg: string = insertErr?.message || "";
          const isCodeDup = msg.includes("unique") && (msg.includes("company_code") || msg.includes("article_code") || msg.includes("_code"));
          if (!isCodeDup || !retryPrefix || retryAttempts >= 100) throw insertErr;
          retryAttempts++;
          const currentNum = parseInt(articleCode.slice(retryPrefix.length)) || 0;
          const nextCandidate = `${retryPrefix}${String(currentNum + 1).padStart(3, "0")}`;
          articleCode = nextCandidate;
          code = articleCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().substring(0, 50);
        }
      }
      res.json(product);
    } catch (error: any) {
      console.error("Error creating factory bale product:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/factory/bale-products/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [updated] = await db
        .update(factoryBaleProducts)
        .set({ ...req.body, updatedAt: new Date() })
        .where(and(eq(factoryBaleProducts.id, id), eq(factoryBaleProducts.companyId, companyId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Product not found" });
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating factory bale product:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/factory/bale-products/:id/cascade-update", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const { name, weightPerBaleKg, articleCode, description, categoryId, productionPrice, sellingPrice } = req.body;

      const [existing] = await db
        .select()
        .from(factoryBaleProducts)
        .where(and(eq(factoryBaleProducts.id, id), eq(factoryBaleProducts.companyId, companyId)));

      if (!existing) return res.status(404).json({ message: "Product not found" });

      // If name is being changed, verify it isn't already taken (case-insensitive)
      if (name !== undefined && name.trim().toLowerCase() !== existing.name.toLowerCase()) {
        const [nameConflict] = await db
          .select({ id: factoryBaleProducts.id })
          .from(factoryBaleProducts)
          .where(and(
            eq(factoryBaleProducts.companyId, companyId),
            sql`LOWER(${factoryBaleProducts.name}) = LOWER(${name.trim()})`,
            sql`${factoryBaleProducts.id} != ${id}`
          ));
        if (nameConflict) {
          return res.status(400).json({ message: `A product named "${name.trim()}" already exists` });
        }
      }

      // If article code is being changed, verify it isn't already taken by another product
      if (articleCode !== undefined && articleCode !== existing.articleCode) {
        const [conflict] = await db
          .select({ id: factoryBaleProducts.id })
          .from(factoryBaleProducts)
          .where(and(
            eq(factoryBaleProducts.companyId, companyId),
            eq(factoryBaleProducts.articleCode, articleCode),
            sql`${factoryBaleProducts.id} != ${id}`
          ));
        if (conflict) {
          return res.status(400).json({ message: `Article code "${articleCode}" is already used by another product` });
        }
      }

      const productUpdate: any = { updatedAt: new Date() };
      if (name !== undefined) productUpdate.name = name;
      if (weightPerBaleKg !== undefined) productUpdate.weightPerBaleKg = weightPerBaleKg;
      if (articleCode !== undefined) productUpdate.articleCode = articleCode;
      if (description !== undefined) productUpdate.description = description;
      if (categoryId !== undefined) productUpdate.categoryId = categoryId;
      if (productionPrice !== undefined && productionPrice !== "") productUpdate.productionPrice = String(parseFloat(productionPrice) || 0);
      if (sellingPrice !== undefined && sellingPrice !== "") productUpdate.sellingPrice = String(parseFloat(sellingPrice) || 0);

      const [updatedProduct] = await db
        .update(factoryBaleProducts)
        .set(productUpdate)
        .where(and(eq(factoryBaleProducts.id, id), eq(factoryBaleProducts.companyId, companyId)))
        .returning();

      const baleUpdate: any = {};
      if (name !== undefined && name !== existing.name) baleUpdate.productName = name;
      if (weightPerBaleKg !== undefined && weightPerBaleKg !== existing.weightPerBaleKg) baleUpdate.weightKg = weightPerBaleKg;
      if (articleCode !== undefined && articleCode !== existing.articleCode) baleUpdate.articleCode = articleCode;

      let balesUpdated = 0;
      if (Object.keys(baleUpdate).length > 0) {
        baleUpdate.updatedAt = new Date();
        const result = await db
          .update(factoryBales)
          .set(baleUpdate)
          .where(and(eq(factoryBales.productId, id), eq(factoryBales.companyId, companyId)));
        balesUpdated = result.rowCount ?? 0;
      }

      res.json({ product: updatedProduct, balesUpdated });
    } catch (error: any) {
      console.error("Error cascade updating bale product:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/factory/bale-product-history/:productId/:locationId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const productId = parseInt(req.params.productId);
      const locationId = parseInt(req.params.locationId);
      const year = parseInt(req.query.year as string) || new Date().getFullYear();

      const [product] = await db
        .select({
          id: factoryBaleProducts.id,
          name: factoryBaleProducts.name,
          articleCode: factoryBaleProducts.articleCode,
          weightPerBaleKg: factoryBaleProducts.weightPerBaleKg,
          sellingPrice: factoryBaleProducts.sellingPrice,
        })
        .from(factoryBaleProducts)
        .where(and(eq(factoryBaleProducts.id, productId), eq(factoryBaleProducts.companyId, companyId)));

      if (!product) return res.status(404).json({ message: "Product not found" });

      const [location] = await db
        .select({ id: locations.id, name: locations.name })
        .from(locations)
        .where(and(eq(locations.id, locationId), eq(locations.companyId, companyId)));

      if (!location) return res.status(404).json({ message: "Location not found" });

      const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

      const startDate = new Date(year, 0, 1);
      const endDate = new Date(year + 1, 0, 1);
      const sellingPricePerBale = parseFloat(product.sellingPrice || "0");

      const rows = await db
        .select({
          month: sql<number>`EXTRACT(MONTH FROM ${factoryBales.createdAt})`.as("month"),
          balesIn: sql<number>`COUNT(*)::int`.as("bales_in"),
          balesOut: sql<number>`SUM(CASE WHEN ${factoryBales.status} IN ('SOLD','REMOVED','DELETED','DISPATCHED') THEN 1 ELSE 0 END)::int`.as("bales_out"),
          balesPending: sql<number>`SUM(CASE WHEN ${factoryBales.status} = 'IN_STOCK' THEN 1 ELSE 0 END)::int`.as("bales_pending"),
          totalWeightIn: sql<number>`COALESCE(SUM(${factoryBales.weightKg}::numeric), 0)`.as("total_weight_in"),
          totalWeightOut: sql<number>`COALESCE(SUM(CASE WHEN ${factoryBales.status} IN ('SOLD','REMOVED','DELETED','DISPATCHED') THEN ${factoryBales.weightKg}::numeric ELSE 0 END), 0)`.as("total_weight_out"),
          totalCost: sql<number>`COALESCE(SUM(${factoryBales.totalCost}::numeric), 0)`.as("total_cost"),
        })
        .from(factoryBales)
        .where(and(
          eq(factoryBales.companyId, companyId),
          eq(factoryBales.productId, productId),
          eq(factoryBales.erpLocationId, locationId),
          sql`${factoryBales.createdAt} >= ${startDate}`,
          sql`${factoryBales.createdAt} < ${endDate}`,
        ))
        .groupBy(sql`EXTRACT(MONTH FROM ${factoryBales.createdAt})`)
        .orderBy(sql`EXTRACT(MONTH FROM ${factoryBales.createdAt})`);

      const monthlyData = rows.map((r: any) => {
        const balesIn = Number(r.balesIn);
        const balesOut = Number(r.balesOut);
        const balesPending = Number(r.balesPending);
        const balesNet = balesIn - balesOut - balesPending;
        const totalWeightIn = Number(r.totalWeightIn);
        const totalWeightOut = Number(r.totalWeightOut);
        return {
          month: Number(r.month),
          monthName: monthNames[Number(r.month) - 1],
          baleCount: balesIn,
          balesIn,
          balesOut,
          balesPending,
          balesNet,
          totalWeight: totalWeightIn,
          totalWeightOut,
          totalWeightNet: totalWeightIn - totalWeightOut,
          totalCost: Number(r.totalCost),
          totalSellingValue: balesNet * sellingPricePerBale,
        };
      });

      const grandTotal = monthlyData.reduce(
        (acc: any, m: any) => ({
          baleCount: acc.baleCount + m.balesIn,
          balesIn: acc.balesIn + m.balesIn,
          balesOut: acc.balesOut + m.balesOut,
          balesPending: acc.balesPending + m.balesPending,
          balesNet: acc.balesNet + m.balesNet,
          totalWeight: acc.totalWeight + m.totalWeight,
          totalWeightOut: acc.totalWeightOut + m.totalWeightOut,
          totalWeightNet: acc.totalWeightNet + m.totalWeightNet,
          totalCost: acc.totalCost + m.totalCost,
          totalSellingValue: acc.totalSellingValue + m.totalSellingValue,
        }),
        { baleCount: 0, balesIn: 0, balesOut: 0, balesPending: 0, balesNet: 0, totalWeight: 0, totalWeightOut: 0, totalWeightNet: 0, totalCost: 0, totalSellingValue: 0 }
      );

      res.json({ product, location, year, monthlyData, grandTotal });
    } catch (error: any) {
      console.error("Error fetching bale product history:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/bale-product-history/:productId/:locationId/:year/:month", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const productId = parseInt(req.params.productId);
      const locationId = parseInt(req.params.locationId);
      const year = parseInt(req.params.year);
      const month = parseInt(req.params.month);

      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 1);

      const bales = await db
        .select({
          id: factoryBales.id,
          baleCode: factoryBales.baleCode,
          referenceNumber: factoryBales.referenceNumber,
          weightKg: factoryBales.weightKg,
          costPerKg: factoryBales.costPerKg,
          totalCost: factoryBales.totalCost,
          status: factoryBales.status,
          createdAt: factoryBales.createdAt,
        })
        .from(factoryBales)
        .where(and(
          eq(factoryBales.companyId, companyId),
          eq(factoryBales.productId, productId),
          eq(factoryBales.erpLocationId, locationId),
          sql`${factoryBales.createdAt} >= ${startDate}`,
          sql`${factoryBales.createdAt} < ${endDate}`,
        ))
        .orderBy(desc(factoryBales.createdAt));

      res.json({ bales });
    } catch (error: any) {
      console.error("Error fetching monthly bale details:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/factory/bale-products/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [updated] = await db
        .update(factoryBaleProducts)
        .set({ active: false, updatedAt: new Date() })
        .where(and(eq(factoryBaleProducts.id, id), eq(factoryBaleProducts.companyId, companyId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Product not found" });
      res.json(updated);
    } catch (error: any) {
      console.error("Error deleting factory bale product:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/bale-products/bulk-toggle-active", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { ids, active } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: "ids array required" });
      if (typeof active !== "boolean") return res.status(400).json({ message: "active boolean required" });

      await db.update(factoryBaleProducts)
        .set({ active, updatedAt: new Date() })
        .where(and(eq(factoryBaleProducts.companyId, companyId), inArray(factoryBaleProducts.id, ids)));

      res.json({ updated: ids.length });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/bale-products/bulk-rename-preview", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { codePrefix, find, replace } = req.body;
      if (!codePrefix || find === undefined || find === "" || replace === undefined) {
        return res.status(400).json({ message: "codePrefix, find (non-empty), and replace are required" });
      }

      const products = await db
        .select()
        .from(factoryBaleProducts)
        .where(and(
          eq(factoryBaleProducts.companyId, companyId),
          or(
            ilike(factoryBaleProducts.code, `${codePrefix}%`),
            ilike(factoryBaleProducts.articleCode, `${codePrefix}%`)
          )
        ))
        .orderBy(factoryBaleProducts.id);

      const matches = products
        .filter((p) => p.name.includes(find))
        .map((p) => ({
          id: p.id,
          code: p.articleCode,
          currentName: p.name,
          newName: p.name.replaceAll(find, replace),
        }));

      res.json({ total: products.length, matches });
    } catch (error: any) {
      console.error("Error previewing bulk rename:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/bale-products/bulk-rename-apply", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { items } = req.body;
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "No items to rename" });
      }

      let updated = 0;
      for (const item of items) {
        const [result] = await db
          .update(factoryBaleProducts)
          .set({ name: item.newName, updatedAt: new Date() })
          .where(and(eq(factoryBaleProducts.id, item.id), eq(factoryBaleProducts.companyId, companyId)))
          .returning();
        if (result) updated++;
      }

      res.json({ updated });
    } catch (error: any) {
      console.error("Error applying bulk rename:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/bale-products/merge — merge source products into target
  app.post("/api/factory/bale-products/merge", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const role = req.user?.role || (req.session as any).currentRole;
      if (!["Admin", "Owner", "Developer"].includes(role)) {
        return res.status(403).json({ message: "Admin, Owner, or Developer role required" });
      }

      const { targetId, sourceIds } = req.body;
      if (!targetId || !Array.isArray(sourceIds) || sourceIds.length === 0) {
        return res.status(400).json({ message: "targetId and sourceIds[] are required" });
      }

      // Fetch target product
      const [target] = await db
        .select()
        .from(factoryBaleProducts)
        .where(and(eq(factoryBaleProducts.id, targetId), eq(factoryBaleProducts.companyId, companyId)));
      if (!target) return res.status(404).json({ message: "Target product not found" });

      // Verify all source products belong to this company
      const sources = await db
        .select()
        .from(factoryBaleProducts)
        .where(and(inArray(factoryBaleProducts.id, sourceIds), eq(factoryBaleProducts.companyId, companyId)));
      if (sources.length !== sourceIds.length) {
        return res.status(400).json({ message: "One or more source products not found for this company" });
      }

      // In a transaction: reroute all referencing rows then deactivate sources
      // sourceIds are pre-validated integers — safe to inline via sql.raw
      const sourceIdsLiteral = sql.raw(`ARRAY[${sourceIds.join(",")}]::int[]`);
      let movedBales = 0;
      await db.transaction(async (tx) => {
        // Update factory_bales: reassign product + fix inline article_code and product_name
        const updateResult = await tx.execute(sql`
          UPDATE factory_bales
          SET product_id = ${targetId},
              article_code = ${target.articleCode || null},
              product_name = ${target.name}
          WHERE product_id = ANY(${sourceIdsLiteral})
            AND company_id = ${companyId}
        `);
        movedBales = (updateResult as any).rowCount ?? 0;

        // Update factory_pressing_batches: reassign product
        await tx.execute(sql`
          UPDATE factory_pressing_batches
          SET product_id = ${targetId}
          WHERE product_id = ANY(${sourceIdsLiteral})
            AND company_id = ${companyId}
        `);

        // Update factory_pos_sale_items: reassign product + fix inline name/articleCode
        await tx.execute(sql`
          UPDATE factory_pos_sale_items
          SET product_id = ${targetId},
              product_name = ${target.name},
              article_code = ${target.articleCode || null}
          WHERE product_id = ANY(${sourceIdsLiteral})
            AND company_id = ${companyId}
        `);

        // Soft-delete source products
        await tx.execute(sql`
          UPDATE factory_bale_products
          SET active = false, updated_at = NOW()
          WHERE id = ANY(${sourceIdsLiteral})
            AND company_id = ${companyId}
        `);
      });

      res.json({ movedBales, mergedProducts: sources.length, targetName: target.name });
    } catch (error: any) {
      console.error("Error merging bale products:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/bale-products/import-excel", requireAuth, async (req: any, res: any) => {
    try {
      const multer = (await import("multer")).default;
      const upload = multer({ storage: multer.memoryStorage() });

      upload.single("file")(req, res, async (err: any) => {
        try {
          if (err) return res.status(400).json({ message: err.message });

          const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
          if (!companyId) return res.status(400).json({ message: "No company selected" });

          if (!req.file) return res.status(400).json({ message: "No file uploaded" });

          const { read: readExcel, utils: { sheet_to_json: sheetToJson } } = await import("xlsx");
          const workbook = readExcel(req.file.buffer, { type: "buffer" });
          const sheetName = workbook.SheetNames[0];
          const rows: any[] = sheetToJson(workbook.Sheets[sheetName]);

          let created = 0;
          let updated = 0;
          let categoriesCreated = 0;
          let pricesUpdated = 0;
          let skippedNoArticleCode = 0;

          // Detect column names from the first row for feedback
          const firstRow = rows[0] || {};
          const detectedArticleCodeCol = Object.keys(firstRow).find(k => ["articlecode", "article_code", "article code", "barcode"].includes(k.toLowerCase())) || null;
          const detectedProductionPriceCol = Object.keys(firstRow).find(k => ["production price", "productionprice", "production_price", "cost price", "costprice", "cost_price"].includes(k.toLowerCase())) || null;
          const detectedSellingPriceCol = Object.keys(firstRow).find(k => ["selling price", "sellingprice", "selling_price"].includes(k.toLowerCase())) || null;

          const categoryCache = new Map<string, number>();
          const existingCategories = await db
            .select()
            .from(factoryCategories)
            .where(eq(factoryCategories.companyId, companyId));
          for (const cat of existingCategories) {
            categoryCache.set(cat.name.toLowerCase(), cat.id);
          }

          for (const row of rows) {
            const articleCode = String(row.articleCode || row.article_code || row.ArticleCode || row["Article Code"] || "").trim();
            if (!articleCode) { skippedNoArticleCode++; continue; }

            const name = String(row.name || row.Name || row.productName || row["Product Name"] || articleCode).trim();
            const description = String(row.description || row.Description || "").trim() || null;
            const weightPerBaleKg = row.weightPerBaleKg || row.weight_per_bale_kg || row.WeightPerBaleKg || row["Weight Per Bale"] || row.weight || null;
            const categoryName = String(row.category || row.Category || row.categoryName || "").trim();

            const rawSellingPrice = row["selling price"] ?? row["sellingPrice"] ?? row["selling_price"] ?? row["Selling Price"] ?? row["SELLING PRICE"] ?? null;
            const sellingPrice = rawSellingPrice !== null && rawSellingPrice !== "" ? String(parseFloat(String(rawSellingPrice)) || 0) : null;

            const rawProductionPrice = row["production price"] ?? row["productionPrice"] ?? row["production_price"] ?? row["Production Price"] ?? row["PRODUCTION PRICE"] ?? row["cost price"] ?? row["costPrice"] ?? row["cost_price"] ?? row["Cost Price"] ?? null;
            const productionPrice = rawProductionPrice !== null && rawProductionPrice !== "" ? String(parseFloat(String(rawProductionPrice)) || 0) : null;

            let categoryId: number | null = null;
            if (categoryName) {
              const cachedId = categoryCache.get(categoryName.toLowerCase());
              if (cachedId) {
                categoryId = cachedId;
              } else {
                const [newCat] = await db
                  .insert(factoryCategories)
                  .values({ companyId, name: categoryName })
                  .returning();
                categoryId = newCat.id;
                categoryCache.set(categoryName.toLowerCase(), newCat.id);
                categoriesCreated++;
              }
            }

            const code = articleCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().substring(0, 50);

            let [existing] = await db
              .select()
              .from(factoryBaleProducts)
              .where(and(eq(factoryBaleProducts.companyId, companyId), eq(factoryBaleProducts.articleCode, articleCode)));

            if (!existing) {
              [existing] = await db
                .select()
                .from(factoryBaleProducts)
                .where(and(eq(factoryBaleProducts.companyId, companyId), eq(factoryBaleProducts.code, code)));
            }

            const hasPriceData = (productionPrice !== null && parseFloat(productionPrice) > 0) || (sellingPrice !== null && parseFloat(sellingPrice) > 0);

            if (existing) {
              await db
                .update(factoryBaleProducts)
                .set({
                  name,
                  description,
                  weightPerBaleKg: weightPerBaleKg ? String(weightPerBaleKg) : existing.weightPerBaleKg,
                  categoryId: categoryId || existing.categoryId,
                  ...(sellingPrice !== null ? { sellingPrice } : {}),
                  ...(productionPrice !== null ? { productionPrice } : {}),
                  updatedAt: new Date(),
                })
                .where(eq(factoryBaleProducts.id, existing.id));
              await db
                .update(factoryBales)
                .set({ productName: name, updatedAt: new Date() })
                .where(eq(factoryBales.productId, existing.id));
              updated++;
              if (hasPriceData) pricesUpdated++;
            } else {
              await db.insert(factoryBaleProducts).values({
                companyId,
                code,
                articleCode,
                name,
                description,
                weightPerBaleKg: weightPerBaleKg ? String(weightPerBaleKg) : null,
                categoryId,
                ...(sellingPrice !== null ? { sellingPrice } : {}),
                ...(productionPrice !== null ? { productionPrice } : {}),
              });
              created++;
              if (hasPriceData) pricesUpdated++;
            }
          }

          res.json({
            created,
            updated,
            categoriesCreated,
            pricesUpdated,
            skippedNoArticleCode,
            detectedColumns: {
              articleCode: detectedArticleCodeCol,
              productionPrice: detectedProductionPriceCol,
              sellingPrice: detectedSellingPriceCol,
            },
          });
        } catch (innerError: any) {
          console.error("Error processing Excel import:", innerError);
          res.status(500).json({ message: innerError.message });
        }
      });
    } catch (error: any) {
      console.error("Error in Excel import:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/bales/validate-import", requireAuth, async (req: any, res: any) => {
    try {
      const multer = (await import("multer")).default;
      const upload = multer({ storage: multer.memoryStorage() });

      upload.single("file")(req, res, async (err: any) => {
        try {
          if (err) return res.status(400).json({ message: err.message });

          const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
          if (!companyId) return res.status(400).json({ message: "No company selected" });

          if (!req.file) return res.status(400).json({ message: "No file uploaded" });

          const XLSX = await import("xlsx");
          const workbook = XLSX.read(req.file.buffer, { type: "buffer", cellDates: true });
          const sheetName = workbook.SheetNames[0];
          const rows: any[] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

          const getVal = (row: any, ...keys: string[]): any => {
            const rowKeys = Object.keys(row);
            for (const k of keys) {
              const found = rowKeys.find(rk => rk.trim().toLowerCase() === k.toLowerCase());
              if (found && row[found] !== undefined && row[found] !== null && String(row[found]).trim() !== "") return row[found];
            }
            return undefined;
          };

          const allProducts = await db
            .select()
            .from(factoryBaleProducts)
            .where(eq(factoryBaleProducts.companyId, companyId));
          const productByArticle = new Map<string, any>();
          for (const p of allProducts) {
            if (p.articleCode) productByArticle.set(p.articleCode.trim().toUpperCase(), p);
          }

          const validRows: { rowIndex: number; articleCode: string; productName: string; productId: number; quantity: number; weight: number; productionDate: string }[] = [];
          const skippedRows: { rowIndex: number; articleCode: string; reason: string }[] = [];

          for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rawCode = getVal(row, "ITEM BARCODE", "Item Barcode", "itemBarcode", "articleCode", "article_code", "ArticleCode", "Article Code", "barcode", "Barcode", "ITEM NAME", "Item Name");
            const articleCode = rawCode ? String(rawCode).trim().toUpperCase() : "";
            if (!articleCode) { skippedRows.push({ rowIndex: i + 2, articleCode: "", reason: "Empty article code" }); continue; }

            const product = productByArticle.get(articleCode);
            if (!product) {
              skippedRows.push({ rowIndex: i + 2, articleCode, reason: "Article code not found in products" });
              continue;
            }

            const rawQty = parseInt(String(getVal(row, "QUANTITY", "Quantity", "quantity", "qty", "Qty") ?? "1"));
            if (isNaN(rawQty) || rawQty <= 0) {
              skippedRows.push({ rowIndex: i + 2, articleCode, reason: "Invalid quantity (must be > 0)" });
              continue;
            }
            const weight = parseFloat(String(product.weightPerBaleKg || "25"));

            let prodDate: Date | null = null;
            const rawDate = getVal(row, "PRODUCTION DATE", "Production Date", "productionDate", "production_date", "date", "Date");
            if (rawDate instanceof Date && !isNaN(rawDate.getTime())) {
              prodDate = rawDate;
            } else if (rawDate) {
              const dateStr = String(rawDate).trim();
              const parsed = new Date(dateStr);
              if (!isNaN(parsed.getTime())) {
                prodDate = parsed;
              }
            }
            if (!prodDate) {
              skippedRows.push({ rowIndex: i + 2, articleCode, reason: "No valid production date" });
              continue;
            }

            validRows.push({
              rowIndex: i + 2,
              articleCode,
              productName: product.name,
              productId: product.id,
              quantity: rawQty,
              weight,
              productionDate: prodDate.toISOString().split("T")[0],
            });
          }

          const totalBales = validRows.reduce((sum, r) => sum + r.quantity, 0);
          const totalWeight = validRows.reduce((sum, r) => sum + r.quantity * r.weight, 0);

          return res.json({
            totalRows: rows.length,
            validRows,
            skippedRows,
            totalBales,
            totalWeight,
            totalProducts: allProducts.length,
          });
        } catch (innerErr: any) {
          console.error("Validate import error:", innerErr);
          return res.status(500).json({ message: innerErr.message || "Validation failed" });
        }
      });
    } catch (outerErr: any) {
      console.error("Validate import outer error:", outerErr);
      res.status(500).json({ message: outerErr.message || "Validation failed" });
    }
  });

  app.post("/api/factory/bales/import-excel", requireAuth, async (req: any, res: any) => {
    try {
      const multer = (await import("multer")).default;
      const upload = multer({ storage: multer.memoryStorage() });

      upload.single("file")(req, res, async (err: any) => {
        try {
          if (err) return res.status(400).json({ message: err.message });

          const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
          if (!companyId) return res.status(400).json({ message: "No company selected" });

          if (!req.file) return res.status(400).json({ message: "No file uploaded" });

          const locationId = req.body.locationId ? parseInt(req.body.locationId) : null;

          const XLSX = await import("xlsx");
          const workbook = XLSX.read(req.file.buffer, { type: "buffer", cellDates: true });
          const sheetName = workbook.SheetNames[0];
          const rows: any[] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

          const getVal = (row: any, ...keys: string[]): any => {
            const rowKeys = Object.keys(row);
            for (const k of keys) {
              const found = rowKeys.find(rk => rk.trim().toLowerCase() === k.toLowerCase());
              if (found && row[found] !== undefined && row[found] !== null && String(row[found]).trim() !== "") return row[found];
            }
            return undefined;
          };

          const allProducts = await db
            .select()
            .from(factoryBaleProducts)
            .where(eq(factoryBaleProducts.companyId, companyId));
          const productByArticle = new Map<string, any>();
          for (const p of allProducts) {
            if (p.articleCode) productByArticle.set(p.articleCode.trim().toUpperCase(), p);
          }

          let totalBalesCreated = 0;
          let skippedRows = 0;
          const skippedDetails: string[] = [];

          const rowGroups: { product: any; qty: number; weight: number; prodDate: Date }[] = [];
          let totalBalesNeeded = 0;

          console.log("Bale import: processing", rows.length, "rows. First row keys:", rows.length > 0 ? Object.keys(rows[0]) : "none");

          for (const row of rows) {
            const rawCode = getVal(row, "ITEM BARCODE", "Item Barcode", "itemBarcode", "articleCode", "article_code", "ArticleCode", "Article Code", "barcode", "Barcode");
            const articleCode = rawCode ? String(rawCode).trim().toUpperCase() : "";
            if (!articleCode) { skippedRows++; skippedDetails.push("Row with empty article code"); continue; }

            const product = productByArticle.get(articleCode);
            if (!product) {
              skippedRows++;
              skippedDetails.push(`Article code "${articleCode}" not found in products`);
              continue;
            }

            const rawQty = parseInt(String(getVal(row, "QUANTITY", "Quantity", "quantity", "qty", "Qty") ?? "1"));
            if (isNaN(rawQty) || rawQty <= 0) {
              skippedRows++;
              skippedDetails.push(`Article "${articleCode}" has invalid quantity`);
              continue;
            }
            const qty = rawQty;
            const weight = parseFloat(String(product.weightPerBaleKg || "25"));

            let prodDate: Date | null = null;
            const rawDate = getVal(row, "PRODUCTION DATE", "Production Date", "productionDate", "production_date", "date", "Date");
            if (rawDate instanceof Date && !isNaN(rawDate.getTime())) {
              prodDate = rawDate;
            } else if (rawDate) {
              const dateStr = String(rawDate).trim();
              const parsed = new Date(dateStr);
              if (!isNaN(parsed.getTime())) {
                prodDate = parsed;
              }
            }
            if (!prodDate) {
              skippedRows++;
              skippedDetails.push(`Article "${articleCode}" has no valid production date`);
              continue;
            }

            rowGroups.push({ product, qty, weight, prodDate });
            totalBalesNeeded += qty;
          }

          if (rowGroups.length === 0) {
            return res.json({ totalBalesCreated: 0, skippedRows, skippedDetails: skippedDetails.slice(0, 20) });
          }

          await db.transaction(async (tx) => {
            const [seqRecord] = await tx
              .select()
              .from(factoryBaleSequences)
              .where(eq(factoryBaleSequences.companyId, companyId))
              .for("update");

            let nextNumber: number;
            if (seqRecord) {
              nextNumber = seqRecord.nextNumber;
              await tx
                .update(factoryBaleSequences)
                .set({ nextNumber: nextNumber + totalBalesNeeded })
                .where(eq(factoryBaleSequences.id, seqRecord.id));
            } else {
              nextNumber = 100876;
              await tx.insert(factoryBaleSequences).values({
                companyId,
                nextNumber: 100876 + totalBalesNeeded,
              });
            }

            let baleIndex = 0;
            for (const group of rowGroups) {
              for (let i = 0; i < group.qty; i++) {
                const refNum = `REF${String(nextNumber + baleIndex).padStart(5, '0')}`;
                await tx
                  .insert(factoryBales)
                  .values({
                    companyId,
                    mixBatchId: null,
                    productId: group.product.id,
                    erpLocationId: locationId,
                    baleCode: group.product.code,
                    referenceNumber: refNum,
                    articleCode: group.product.articleCode,
                    productName: group.product.name,
                    weightKg: String(group.weight),
                    costPerKg: "0",
                    totalCost: "0",
                    status: "IN_STOCK",
                    finalizedAt: group.prodDate,
                    createdAt: group.prodDate,
                  });
                baleIndex++;
              }
              totalBalesCreated += group.qty;
            }
          });

          if (totalBalesCreated > 0) {
            const excelImportToday = getClientDate(req);
            await writeDaybookEntry(db, {
              companyId,
              txDate: excelImportToday,
              txType: "BALE_IMPORT",
              description: `Bale Excel import: ${totalBalesCreated} bale${totalBalesCreated !== 1 ? "s" : ""} created${skippedRows > 0 ? ` (${skippedRows} rows skipped)` : ""}`,
            });
          }
          res.json({ totalBalesCreated, skippedRows, skippedDetails: skippedDetails.slice(0, 20) });
        } catch (innerError: any) {
          console.error("Error processing bale Excel import:", innerError);
          res.status(500).json({ message: innerError.message });
        }
      });
    } catch (error: any) {
      console.error("Error in bale Excel import:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 4. Factory Containers CRUD
  // ───────────────────────────────────────────────

}
