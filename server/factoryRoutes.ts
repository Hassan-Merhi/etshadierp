import type { Express } from "express";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { eq, and, or, desc, sql, inArray } from "drizzle-orm";
import {
  factorySuppliers,
  factoryCategories,
  factoryBaleProducts,
  factoryContainers,
  factoryRawStock,
  factoryMixBatches,
  factoryMixBatchSources,
  factoryPressingBatches,
  factoryBales,
  factoryBaleSequences,
  factoryContainerCommissions,
  stockItems,
  insertFactorySupplierSchema,
  insertFactoryCategorySchema,
  insertFactoryBaleProductSchema,
  insertFactoryContainerSchema,
  insertFactoryRawStockSchema,
  insertFactoryMixBatchSchema,
  insertFactoryMixBatchSourceSchema,
  insertFactoryPressingBatchSchema,
  insertFactoryBaleSchema,
} from "@shared/schema";
import { adjustInventory } from "./inventoryHelper";

export function registerFactoryRoutes(app: Express, requireAuth: any, db: any) {

  // ───────────────────────────────────────────────
  // 1. Factory Suppliers CRUD
  // ───────────────────────────────────────────────

  app.get("/api/factory/suppliers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const results = await db
        .select()
        .from(factorySuppliers)
        .where(eq(factorySuppliers.companyId, companyId))
        .orderBy(factorySuppliers.name);

      res.json(results);
    } catch (error: any) {
      console.error("Error fetching factory suppliers:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/suppliers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const parsed = insertFactorySupplierSchema.parse({ ...req.body, companyId });
      const [supplier] = await db.insert(factorySuppliers).values(parsed).returning();
      res.json(supplier);
    } catch (error: any) {
      console.error("Error creating factory supplier:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/factory/suppliers/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [updated] = await db
        .update(factorySuppliers)
        .set({ ...req.body, updatedAt: new Date() })
        .where(and(eq(factorySuppliers.id, id), eq(factorySuppliers.companyId, companyId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Supplier not found" });
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating factory supplier:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/factory/suppliers/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [updated] = await db
        .update(factorySuppliers)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(factorySuppliers.id, id), eq(factorySuppliers.companyId, companyId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Supplier not found" });
      res.json(updated);
    } catch (error: any) {
      console.error("Error deleting factory supplier:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 2. Factory Categories CRUD
  // ───────────────────────────────────────────────

  app.get("/api/factory/categories", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
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
      const companyId = (req.session as any).currentCompanyId;
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
      const companyId = (req.session as any).currentCompanyId;
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
      const companyId = (req.session as any).currentCompanyId;
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
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const results = await db
        .select()
        .from(factoryBaleProducts)
        .where(eq(factoryBaleProducts.companyId, companyId))
        .orderBy(factoryBaleProducts.name);

      res.json(results);
    } catch (error: any) {
      console.error("Error fetching factory bale products:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/bale-products/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
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

  app.post("/api/factory/bale-products", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      let code = req.body.code;
      const articleCode = req.body.articleCode;

      if (!code && articleCode) {
        code = articleCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().substring(0, 50);
      }

      if (articleCode) {
        const [existing] = await db
          .select()
          .from(factoryBaleProducts)
          .where(and(eq(factoryBaleProducts.companyId, companyId), eq(factoryBaleProducts.articleCode, articleCode)));
        if (existing) return res.status(400).json({ message: "A product with this article code already exists" });
      }

      const parsed = insertFactoryBaleProductSchema.parse({ ...req.body, companyId, code });
      const [product] = await db.insert(factoryBaleProducts).values(parsed).returning();
      res.json(product);
    } catch (error: any) {
      console.error("Error creating factory bale product:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/factory/bale-products/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
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

  app.delete("/api/factory/bale-products/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
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

  app.post("/api/factory/bale-products/import-excel", requireAuth, async (req: any, res: any) => {
    try {
      const multer = (await import("multer")).default;
      const upload = multer({ storage: multer.memoryStorage() });

      upload.single("file")(req, res, async (err: any) => {
        try {
          if (err) return res.status(400).json({ message: err.message });

          const companyId = (req.session as any).currentCompanyId;
          if (!companyId) return res.status(400).json({ message: "No company selected" });

          if (!req.file) return res.status(400).json({ message: "No file uploaded" });

          const { read: readExcel, utils: { sheet_to_json: sheetToJson } } = await import("xlsx");
          const workbook = readExcel(req.file.buffer, { type: "buffer" });
          const sheetName = workbook.SheetNames[0];
          const rows: any[] = sheetToJson(workbook.Sheets[sheetName]);

          let created = 0;
          let updated = 0;
          let categoriesCreated = 0;

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
            if (!articleCode) continue;

            const name = String(row.name || row.Name || row.productName || row["Product Name"] || articleCode).trim();
            const description = String(row.description || row.Description || "").trim() || null;
            const weightPerBaleKg = row.weightPerBaleKg || row.weight_per_bale_kg || row.WeightPerBaleKg || row["Weight Per Bale"] || null;
            const categoryName = String(row.category || row.Category || row.categoryName || "").trim();

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

            const [existing] = await db
              .select()
              .from(factoryBaleProducts)
              .where(and(eq(factoryBaleProducts.companyId, companyId), eq(factoryBaleProducts.articleCode, articleCode)));

            if (existing) {
              await db
                .update(factoryBaleProducts)
                .set({
                  name,
                  description,
                  weightPerBaleKg: weightPerBaleKg ? String(weightPerBaleKg) : existing.weightPerBaleKg,
                  categoryId: categoryId || existing.categoryId,
                  updatedAt: new Date(),
                })
                .where(eq(factoryBaleProducts.id, existing.id));
              updated++;
            } else {
              await db.insert(factoryBaleProducts).values({
                companyId,
                code,
                articleCode,
                name,
                description,
                weightPerBaleKg: weightPerBaleKg ? String(weightPerBaleKg) : null,
                categoryId,
              });
              created++;
            }
          }

          res.json({ created, updated, categoriesCreated });
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

  // ───────────────────────────────────────────────
  // 4. Factory Containers CRUD
  // ───────────────────────────────────────────────

  app.get("/api/factory/containers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const results = await db
        .select({
          id: factoryContainers.id,
          companyId: factoryContainers.companyId,
          containerNumber: factoryContainers.containerNumber,
          supplierId: factoryContainers.supplierId,
          origin: factoryContainers.origin,
          totalKg: factoryContainers.totalKg,
          ratePerKg: factoryContainers.ratePerKg,
          arrivalDate: factoryContainers.arrivalDate,
          notes: factoryContainers.notes,
          status: factoryContainers.status,
          createdAt: factoryContainers.createdAt,
          updatedAt: factoryContainers.updatedAt,
          supplierName: factorySuppliers.name,
        })
        .from(factoryContainers)
        .leftJoin(factorySuppliers, eq(factoryContainers.supplierId, factorySuppliers.id))
        .where(eq(factoryContainers.companyId, companyId))
        .orderBy(desc(factoryContainers.createdAt));

      res.json(results);
    } catch (error: any) {
      console.error("Error fetching factory containers:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/containers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const parsed = insertFactoryContainerSchema.parse({ ...req.body, companyId });
      const [container] = await db.insert(factoryContainers).values(parsed).returning();
      res.json(container);
    } catch (error: any) {
      console.error("Error creating factory container:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/factory/containers/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [updated] = await db
        .update(factoryContainers)
        .set({ ...req.body, updatedAt: new Date() })
        .where(and(eq(factoryContainers.id, id), eq(factoryContainers.companyId, companyId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Container not found" });
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating factory container:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/factory/containers/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [deleted] = await db
        .delete(factoryContainers)
        .where(and(eq(factoryContainers.id, id), eq(factoryContainers.companyId, companyId)))
        .returning();

      if (!deleted) return res.status(404).json({ message: "Container not found" });
      res.json(deleted);
    } catch (error: any) {
      console.error("Error deleting factory container:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 5. Factory Raw Stock
  // ───────────────────────────────────────────────

  app.get("/api/factory/raw-stock", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const results = await db
        .select({
          id: factoryRawStock.id,
          companyId: factoryRawStock.companyId,
          containerId: factoryRawStock.containerId,
          receivedKg: factoryRawStock.receivedKg,
          usedKg: factoryRawStock.usedKg,
          costPerKg: factoryRawStock.costPerKg,
          offloadedAt: factoryRawStock.offloadedAt,
          createdAt: factoryRawStock.createdAt,
          containerNumber: factoryContainers.containerNumber,
          supplierName: factorySuppliers.name,
          origin: factoryContainers.origin,
        })
        .from(factoryRawStock)
        .innerJoin(factoryContainers, eq(factoryRawStock.containerId, factoryContainers.id))
        .leftJoin(factorySuppliers, eq(factoryContainers.supplierId, factorySuppliers.id))
        .where(eq(factoryRawStock.companyId, companyId));

      const enriched = results.map((r: any) => {
        const received = parseFloat(r.receivedKg) || 0;
        const used = parseFloat(r.usedKg) || 0;
        const costPerKg = parseFloat(r.costPerKg) || 0;
        const remainingKg = received - used;
        const valueRemaining = remainingKg * costPerKg;
        return { ...r, remainingKg: remainingKg.toFixed(3), valueRemaining: valueRemaining.toFixed(2) };
      });

      res.json(enriched);
    } catch (error: any) {
      console.error("Error fetching factory raw stock:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/raw-stock/available-containers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const offloaded = await db
        .select({ containerId: factoryRawStock.containerId })
        .from(factoryRawStock)
        .where(eq(factoryRawStock.companyId, companyId));

      const offloadedIds = offloaded.map((o: any) => o.containerId);

      let query = db
        .select()
        .from(factoryContainers)
        .where(eq(factoryContainers.companyId, companyId));

      if (offloadedIds.length > 0) {
        query = db
          .select()
          .from(factoryContainers)
          .where(
            and(
              eq(factoryContainers.companyId, companyId),
              sql`${factoryContainers.id} NOT IN (${sql.join(offloadedIds.map((id: number) => sql`${id}`), sql`, `)})`
            )
          );
      }

      const results = await query;
      res.json(results);
    } catch (error: any) {
      console.error("Error fetching available containers:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/raw-stock/offload", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { containerId, receivedKg, costPerKg, commission } = req.body;
      if (!containerId) return res.status(400).json({ message: "Container ID is required" });

      const [container] = await db
        .select()
        .from(factoryContainers)
        .where(and(eq(factoryContainers.id, containerId), eq(factoryContainers.companyId, companyId)));

      if (!container) return res.status(404).json({ message: "Container not found" });

      const [existing] = await db
        .select()
        .from(factoryRawStock)
        .where(and(eq(factoryRawStock.companyId, companyId), eq(factoryRawStock.containerId, containerId)));

      if (existing) return res.status(400).json({ message: "This container has already been offloaded" });

      const declaredKg = container.totalKg || "0";
      const actualKg = receivedKg || declaredKg;
      const finalCostPerKg = costPerKg || container.ratePerKg || "0";
      const differenceKg = String(parseFloat(declaredKg) - parseFloat(actualKg));
      const finalPayableAmount = String(parseFloat(actualKg) * parseFloat(finalCostPerKg));

      const newStatus = parseFloat(actualKg) < parseFloat(declaredKg) ? "PARTIALLY_RECEIVED" : "OFFLOADED";

      const [rawStock] = await db
        .insert(factoryRawStock)
        .values({
          companyId,
          containerId,
          receivedKg: String(actualKg),
          costPerKg: String(finalCostPerKg),
        })
        .returning();

      await db
        .update(factoryContainers)
        .set({
          status: newStatus,
          declaredKg: String(declaredKg),
          actualReceivedKg: String(actualKg),
          finalPayableAmount,
          differenceKg,
          updatedAt: new Date(),
        })
        .where(eq(factoryContainers.id, containerId));

      let commissionRecord = null;
      if (commission && commission.personName && commission.commissionRate) {
        const commType = commission.commissionType || "PER_KG";
        const commRate = parseFloat(commission.commissionRate) || 0;
        const commTotal = commType === "PER_KG"
          ? commRate * parseFloat(actualKg)
          : commRate;

        [commissionRecord] = await db
          .insert(factoryContainerCommissions)
          .values({
            companyId,
            containerId,
            personName: commission.personName,
            commissionType: commType,
            commissionRate: String(commRate),
            commissionTotal: String(commTotal),
          })
          .returning();
      }

      res.json({ rawStock, commission: commissionRecord });
    } catch (error: any) {
      console.error("Error offloading container:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/factory/container-commissions/:containerId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const containerId = parseInt(req.params.containerId);
      const results = await db
        .select()
        .from(factoryContainerCommissions)
        .where(and(eq(factoryContainerCommissions.companyId, companyId), eq(factoryContainerCommissions.containerId, containerId)));

      res.json(results);
    } catch (error: any) {
      console.error("Error fetching commissions:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 6. Factory Mix Batches
  // ───────────────────────────────────────────────

  app.get("/api/factory/mix-batches", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const results = await db
        .select()
        .from(factoryMixBatches)
        .where(eq(factoryMixBatches.companyId, companyId))
        .orderBy(desc(factoryMixBatches.createdAt));

      const enriched = results.map((b: any) => {
        const total = parseFloat(b.totalWeightKg) || 0;
        const used = parseFloat(b.usedKg) || 0;
        return { ...b, remainingKg: (total - used).toFixed(3) };
      });

      res.json(enriched);
    } catch (error: any) {
      console.error("Error fetching mix batches:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/mix-batches/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [batch] = await db
        .select()
        .from(factoryMixBatches)
        .where(and(eq(factoryMixBatches.id, id), eq(factoryMixBatches.companyId, companyId)));

      if (!batch) return res.status(404).json({ message: "Mix batch not found" });

      const total = parseFloat(batch.totalWeightKg) || 0;
      const used = parseFloat(batch.usedKg) || 0;
      res.json({ ...batch, remainingKg: (total - used).toFixed(3) });
    } catch (error: any) {
      console.error("Error fetching mix batch:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/mix-batches", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { sources = [], batchSources = [], name, notes } = req.body;

      if (sources.length === 0 && batchSources.length === 0) {
        return res.status(400).json({ message: "At least one source is required" });
      }

      const result = await db.transaction(async (tx: any) => {
        const year = new Date().getFullYear();
        const existingBatches = await tx
          .select({ batchCode: factoryMixBatches.batchCode })
          .from(factoryMixBatches)
          .where(and(eq(factoryMixBatches.companyId, companyId), sql`${factoryMixBatches.batchCode} LIKE ${"FMB-" + year + "-%"}`));

        let nextNum = 1;
        for (const b of existingBatches) {
          const parts = b.batchCode.split("-");
          const num = parseInt(parts[2]) || 0;
          if (num >= nextNum) nextNum = num + 1;
        }
        const batchCode = `FMB-${year}-${String(nextNum).padStart(4, "0")}`;

        let totalWeightKg = 0;
        let totalCost = 0;
        const sourceRecords: any[] = [];

        for (const source of sources) {
          const { containerId, weightKg, costPerKg: srcCostPerKg } = source;
          const [rawStock] = await tx
            .select()
            .from(factoryRawStock)
            .where(and(eq(factoryRawStock.companyId, companyId), eq(factoryRawStock.containerId, containerId)))
            .for("update");

          if (!rawStock) throw new Error(`Raw stock not found for container ${containerId}`);

          const remaining = parseFloat(rawStock.receivedKg) - parseFloat(rawStock.usedKg);
          const weight = parseFloat(weightKg);
          if (weight > remaining + 0.001) {
            throw new Error(`Not enough raw stock for container ${containerId}. Available: ${remaining.toFixed(3)} kg`);
          }

          const cost = srcCostPerKg ? parseFloat(srcCostPerKg) : parseFloat(rawStock.costPerKg);

          await tx
            .update(factoryRawStock)
            .set({ usedKg: sql`${factoryRawStock.usedKg} + ${weight}` })
            .where(eq(factoryRawStock.id, rawStock.id));

          totalWeightKg += weight;
          totalCost += weight * cost;
          sourceRecords.push({ containerId, weightKg: String(weight), costPerKg: String(cost), totalCost: String(weight * cost) });
        }

        for (const bSource of batchSources) {
          const { sourceBatchId, weightKg } = bSource;
          const [srcBatch] = await tx
            .select()
            .from(factoryMixBatches)
            .where(and(eq(factoryMixBatches.id, sourceBatchId), eq(factoryMixBatches.companyId, companyId)))
            .for("update");

          if (!srcBatch) throw new Error(`Source batch ${sourceBatchId} not found`);

          const remaining = parseFloat(srcBatch.totalWeightKg) - parseFloat(srcBatch.usedKg);
          const weight = parseFloat(weightKg);
          if (weight > remaining + 0.001) {
            throw new Error(`Not enough in batch ${srcBatch.batchCode}. Available: ${remaining.toFixed(3)} kg`);
          }

          const cost = parseFloat(srcBatch.costPerKg);

          await tx
            .update(factoryMixBatches)
            .set({ usedKg: sql`${factoryMixBatches.usedKg} + ${weight}`, updatedAt: new Date() })
            .where(eq(factoryMixBatches.id, srcBatch.id));

          totalWeightKg += weight;
          totalCost += weight * cost;
          sourceRecords.push({ sourceBatchId, weightKg: String(weight), costPerKg: String(cost), totalCost: String(weight * cost) });
        }

        const blendedCostPerKg = totalWeightKg > 0 ? totalCost / totalWeightKg : 0;

        const [mixBatch] = await tx
          .insert(factoryMixBatches)
          .values({
            companyId,
            batchCode,
            name: name || null,
            totalWeightKg: String(totalWeightKg),
            costPerKg: String(blendedCostPerKg),
            totalCost: String(totalCost),
            notes: notes || null,
          })
          .returning();

        for (const sr of sourceRecords) {
          await tx.insert(factoryMixBatchSources).values({
            mixBatchId: mixBatch.id,
            containerId: sr.containerId || null,
            sourceBatchId: sr.sourceBatchId || null,
            weightKg: sr.weightKg,
            costPerKg: sr.costPerKg,
            totalCost: sr.totalCost,
          });
        }

        return mixBatch;
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error creating mix batch:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/factory/mix-batches/:id/sources", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);

      const results = await db
        .select({
          id: factoryMixBatchSources.id,
          mixBatchId: factoryMixBatchSources.mixBatchId,
          containerId: factoryMixBatchSources.containerId,
          sourceBatchId: factoryMixBatchSources.sourceBatchId,
          weightKg: factoryMixBatchSources.weightKg,
          costPerKg: factoryMixBatchSources.costPerKg,
          totalCost: factoryMixBatchSources.totalCost,
          createdAt: factoryMixBatchSources.createdAt,
          containerNumber: factoryContainers.containerNumber,
        })
        .from(factoryMixBatchSources)
        .leftJoin(factoryContainers, eq(factoryMixBatchSources.containerId, factoryContainers.id))
        .where(eq(factoryMixBatchSources.mixBatchId, id));

      res.json(results);
    } catch (error: any) {
      console.error("Error fetching mix batch sources:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 7. Factory Pressing (create-and-print)
  // ───────────────────────────────────────────────

  app.post("/api/factory/pressing/create-and-print", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { productId, quantity, weightPerBale } = req.body;
      if (!productId || !quantity || !weightPerBale) {
        return res.status(400).json({ message: "productId, quantity, and weightPerBale are required" });
      }

      const result = await db.transaction(async (tx: any) => {
        const [product] = await tx
          .select()
          .from(factoryBaleProducts)
          .where(and(eq(factoryBaleProducts.id, productId), eq(factoryBaleProducts.companyId, companyId)));

        if (!product) throw new Error("Product not found");

        const [pressingBatch] = await tx
          .insert(factoryPressingBatches)
          .values({
            companyId,
            productId,
            expectedCount: quantity,
            status: "PENDING",
          })
          .returning();

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
            .set({ nextNumber: nextNumber + quantity })
            .where(eq(factoryBaleSequences.id, seqRecord.id));
        } else {
          nextNumber = 1;
          await tx.insert(factoryBaleSequences).values({
            companyId,
            nextNumber: 1 + quantity,
          });
        }

        const bales: any[] = [];
        for (let i = 0; i < quantity; i++) {
          const refNum = `HD${String(nextNumber + i).padStart(5, "0")}`;
          const [bale] = await tx
            .insert(factoryBales)
            .values({
              companyId,
              pressingBatchId: pressingBatch.id,
              productId,
              baleCode: product.code,
              referenceNumber: refNum,
              articleCode: product.articleCode,
              productName: product.name,
              weightKg: String(weightPerBale),
              status: "PENDING_PRESSING",
            })
            .returning();
          bales.push(bale);
        }

        return { pressingBatchId: pressingBatch.id, bales };
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error creating pressing batch:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/factory/bales/create-batch", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { productId, quantity, weightPerBale } = req.body;
      if (!productId || !quantity || !weightPerBale) {
        return res.status(400).json({ message: "productId, quantity, and weightPerBale are required" });
      }

      const result = await db.transaction(async (tx: any) => {
        const [product] = await tx
          .select()
          .from(factoryBaleProducts)
          .where(and(eq(factoryBaleProducts.id, productId), eq(factoryBaleProducts.companyId, companyId)));

        if (!product) throw new Error("Product not found");

        const [pressingBatch] = await tx
          .insert(factoryPressingBatches)
          .values({
            companyId,
            productId,
            expectedCount: quantity,
            status: "PENDING",
          })
          .returning();

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
            .set({ nextNumber: nextNumber + quantity })
            .where(eq(factoryBaleSequences.id, seqRecord.id));
        } else {
          nextNumber = 1;
          await tx.insert(factoryBaleSequences).values({
            companyId,
            nextNumber: 1 + quantity,
          });
        }

        const bales: any[] = [];
        for (let i = 0; i < quantity; i++) {
          const refNum = `HD${String(nextNumber + i).padStart(5, "0")}`;
          const [bale] = await tx
            .insert(factoryBales)
            .values({
              companyId,
              pressingBatchId: pressingBatch.id,
              productId,
              baleCode: product.code,
              referenceNumber: refNum,
              articleCode: product.articleCode,
              productName: product.name,
              weightKg: String(weightPerBale),
              status: "PENDING_PRESSING",
            })
            .returning();
          bales.push(bale);
        }

        return { pressingBatchId: pressingBatch.id, bales };
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error creating bale batch:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 8. Factory Pressing Batches
  // ───────────────────────────────────────────────

  app.get("/api/factory/pressing-batches", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const batches = await db
        .select({
          id: factoryPressingBatches.id,
          companyId: factoryPressingBatches.companyId,
          mixBatchId: factoryPressingBatches.mixBatchId,
          productId: factoryPressingBatches.productId,
          expectedCount: factoryPressingBatches.expectedCount,
          status: factoryPressingBatches.status,
          notes: factoryPressingBatches.notes,
          createdBy: factoryPressingBatches.createdBy,
          finalizedAt: factoryPressingBatches.finalizedAt,
          finalizedLocationId: factoryPressingBatches.finalizedLocationId,
          createdAt: factoryPressingBatches.createdAt,
          productName: factoryBaleProducts.name,
          productCode: factoryBaleProducts.code,
          articleCode: factoryBaleProducts.articleCode,
        })
        .from(factoryPressingBatches)
        .leftJoin(factoryBaleProducts, eq(factoryPressingBatches.productId, factoryBaleProducts.id))
        .where(eq(factoryPressingBatches.companyId, companyId))
        .orderBy(desc(factoryPressingBatches.createdAt));

      const enriched = await Promise.all(
        batches.map(async (batch: any) => {
          const balesForBatch = await db
            .select({ status: factoryBales.status })
            .from(factoryBales)
            .where(eq(factoryBales.pressingBatchId, batch.id));

          const pendingCount = balesForBatch.filter((b: any) => b.status === "PENDING_PRESSING").length;
          const finalizedCount = balesForBatch.filter((b: any) => b.status === "FINALIZED").length;

          return { ...batch, pendingCount, finalizedCount };
        })
      );

      res.json(enriched);
    } catch (error: any) {
      console.error("Error fetching pressing batches:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/pressing-batches/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);

      const [batch] = await db
        .select()
        .from(factoryPressingBatches)
        .where(and(eq(factoryPressingBatches.id, id), eq(factoryPressingBatches.companyId, companyId)));

      if (!batch) return res.status(404).json({ message: "Pressing batch not found" });

      const bales = await db
        .select()
        .from(factoryBales)
        .where(eq(factoryBales.pressingBatchId, id))
        .orderBy(factoryBales.referenceNumber);

      res.json({ ...batch, bales });
    } catch (error: any) {
      console.error("Error fetching pressing batch:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 9. Factory Finalize
  // ───────────────────────────────────────────────

  app.post("/api/factory/finalize", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { pressingBatchId, scannedBaleIds, erpLocationId, mixBatchId } = req.body;

      if (!pressingBatchId || !scannedBaleIds || !erpLocationId || !mixBatchId) {
        return res.status(400).json({ message: "pressingBatchId, scannedBaleIds, erpLocationId, and mixBatchId are required" });
      }

      const result = await db.transaction(async (tx: any) => {
        const [pressingBatch] = await tx
          .select()
          .from(factoryPressingBatches)
          .where(and(eq(factoryPressingBatches.id, pressingBatchId), eq(factoryPressingBatches.companyId, companyId)));

        if (!pressingBatch) throw new Error("Pressing batch not found");
        if (pressingBatch.status !== "PENDING") throw new Error("Pressing batch is not in PENDING status");

        const [mixBatch] = await tx
          .select()
          .from(factoryMixBatches)
          .where(and(eq(factoryMixBatches.id, mixBatchId), eq(factoryMixBatches.companyId, companyId)))
          .for("update");

        if (!mixBatch) throw new Error("Mix batch not found");

        const mixRemaining = parseFloat(mixBatch.totalWeightKg) - parseFloat(mixBatch.usedKg);

        const pendingBales = await tx
          .select()
          .from(factoryBales)
          .where(and(eq(factoryBales.pressingBatchId, pressingBatchId), eq(factoryBales.status, "PENDING_PRESSING")));

        if (scannedBaleIds.length !== pendingBales.length) {
          throw new Error(`Expected ${pendingBales.length} bales but received ${scannedBaleIds.length} scanned bales`);
        }

        const pendingBaleIds = new Set(pendingBales.map((b: any) => b.id));
        for (const scannedId of scannedBaleIds) {
          if (!pendingBaleIds.has(scannedId)) {
            throw new Error(`Bale ID ${scannedId} is not a valid pending bale for this pressing batch`);
          }
        }

        let totalWeight = 0;
        for (const bale of pendingBales) {
          totalWeight += parseFloat(bale.weightKg);
        }

        if (totalWeight > mixRemaining + 0.001) {
          throw new Error(`Not enough mix batch remaining. Need ${totalWeight.toFixed(3)} kg but only ${mixRemaining.toFixed(3)} kg available`);
        }

        const costPerKg = parseFloat(mixBatch.costPerKg);
        const now = new Date();
        const updatedBales: any[] = [];

        for (const bale of pendingBales) {
          const weight = parseFloat(bale.weightKg);
          const baleTotalCost = weight * costPerKg;

          const [updated] = await tx
            .update(factoryBales)
            .set({
              status: "FINALIZED",
              erpLocationId,
              mixBatchId,
              costPerKg: String(costPerKg),
              totalCost: String(baleTotalCost),
              finalizedAt: now,
              updatedAt: now,
            })
            .where(eq(factoryBales.id, bale.id))
            .returning();

          updatedBales.push(updated);
        }

        await tx
          .update(factoryMixBatches)
          .set({ usedKg: sql`${factoryMixBatches.usedKg} + ${totalWeight}`, updatedAt: now })
          .where(eq(factoryMixBatches.id, mixBatchId));

        await tx
          .update(factoryPressingBatches)
          .set({
            status: "FINALIZED",
            mixBatchId,
            finalizedAt: now,
            finalizedLocationId: erpLocationId,
          })
          .where(eq(factoryPressingBatches.id, pressingBatchId));

        const productIds: number[] = [];
        for (const b of pendingBales) {
          if (b.productId && !productIds.includes(b.productId)) productIds.push(b.productId);
        }
        const factoryProducts = productIds.length > 0
          ? await tx.select().from(factoryBaleProducts).where(inArray(factoryBaleProducts.id, productIds))
          : [];

        const productMap = new Map<number, any>(factoryProducts.map((p: any) => [p.id, p]));

        const stockItemCache = new Map<string, number>();

        for (const bale of pendingBales) {
          const factoryProduct = productMap.get(bale.productId as number);
          if (!factoryProduct) continue;

          const itemCode: string = factoryProduct.articleCode || factoryProduct.code;
          if (!itemCode) continue;

          let erpStockItemId: number | undefined = stockItemCache.get(itemCode);

          if (!erpStockItemId) {
            const [existing] = await tx
              .select({ id: stockItems.id })
              .from(stockItems)
              .where(and(eq(stockItems.companyId, companyId), eq(stockItems.code, itemCode)));

            if (existing) {
              erpStockItemId = existing.id;
            } else {
              const [created] = await tx
                .insert(stockItems)
                .values({
                  companyId,
                  code: itemCode,
                  name: factoryProduct.name as string,
                  uom: "BALE",
                  active: true,
                })
                .returning({ id: stockItems.id });
              erpStockItemId = created.id;
            }
            stockItemCache.set(itemCode, erpStockItemId!);
          }

          const weight = parseFloat(bale.weightKg);
          const baleCostPerKg = parseFloat(bale.costPerKg || "0");
          const baleRate = weight * baleCostPerKg;

          await adjustInventory(tx, erpLocationId, erpStockItemId!, 1, companyId, baleRate);
        }

        return { updated: updatedBales.length, bales: updatedBales };
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error finalizing pressing batch:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 10. Factory Bales queries
  // ───────────────────────────────────────────────

  app.get("/api/factory/bales", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { status, mixBatchId, pressingBatchId } = req.query;

      const conditions: any[] = [eq(factoryBales.companyId, companyId)];

      if (status) conditions.push(eq(factoryBales.status, status as string));
      if (mixBatchId) conditions.push(eq(factoryBales.mixBatchId, parseInt(mixBatchId as string)));
      if (pressingBatchId) conditions.push(eq(factoryBales.pressingBatchId, parseInt(pressingBatchId as string)));

      const results = await db
        .select()
        .from(factoryBales)
        .where(and(...conditions))
        .orderBy(desc(factoryBales.createdAt));

      res.json(results);
    } catch (error: any) {
      console.error("Error fetching factory bales:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/bales/lookup/:barcode", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const barcode = req.params.barcode;

      const results = await db
        .select()
        .from(factoryBales)
        .where(
          and(
            eq(factoryBales.companyId, companyId),
            or(eq(factoryBales.referenceNumber, barcode), eq(factoryBales.baleCode, barcode))
          )
        );

      if (results.length === 0) return res.status(404).json({ message: "Bale not found" });
      res.json(results[0]);
    } catch (error: any) {
      console.error("Error looking up bale:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 11. Factory Production Summary
  // ───────────────────────────────────────────────

  app.get("/api/factory/production-summary", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const allBales = await db
        .select({
          status: factoryBales.status,
          weightKg: factoryBales.weightKg,
        })
        .from(factoryBales)
        .where(eq(factoryBales.companyId, companyId));

      const totalBales = allBales.length;
      let pendingCount = 0;
      let finalizedCount = 0;
      let pendingWeight = 0;
      let finalizedWeight = 0;

      for (const bale of allBales) {
        const weight = parseFloat(bale.weightKg) || 0;
        if (bale.status === "PENDING_PRESSING") {
          pendingCount++;
          pendingWeight += weight;
        } else if (bale.status === "FINALIZED") {
          finalizedCount++;
          finalizedWeight += weight;
        }
      }

      const mixBatches = await db
        .select({
          totalWeightKg: factoryMixBatches.totalWeightKg,
          usedKg: factoryMixBatches.usedKg,
        })
        .from(factoryMixBatches)
        .where(eq(factoryMixBatches.companyId, companyId));

      let totalMixWeight = 0;
      let totalMixUsed = 0;
      for (const mb of mixBatches) {
        totalMixWeight += parseFloat(mb.totalWeightKg) || 0;
        totalMixUsed += parseFloat(mb.usedKg) || 0;
      }

      res.json({
        totalBales,
        pendingCount,
        finalizedCount,
        pendingWeight: pendingWeight.toFixed(3),
        finalizedWeight: finalizedWeight.toFixed(3),
        totalWeight: (pendingWeight + finalizedWeight).toFixed(3),
        mixBatchUtilization: {
          totalWeightKg: totalMixWeight.toFixed(3),
          usedKg: totalMixUsed.toFixed(3),
          remainingKg: (totalMixWeight - totalMixUsed).toFixed(3),
          utilizationPercent: totalMixWeight > 0 ? ((totalMixUsed / totalMixWeight) * 100).toFixed(1) : "0.0",
        },
      });
    } catch (error: any) {
      console.error("Error fetching production summary:", error);
      res.status(500).json({ message: error.message });
    }
  });
}
