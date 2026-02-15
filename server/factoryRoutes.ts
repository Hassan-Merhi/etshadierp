import type { Express } from "express";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { eq, and, or, desc, sql, inArray, ilike } from "drizzle-orm";
import bcrypt from "bcryptjs";
import CryptoJS from "crypto-js";
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
} from "@shared/schema";
import { adjustInventory } from "./inventoryHelper";

export function registerFactoryRoutes(app: Express, requireAuth: any, db: any) {

  async function writeDaybookEntry(dbOrTx: any, opts: {
    companyId: number;
    txDate: string;
    txType: string;
    referenceId?: number;
    referenceTable?: string;
    description: string;
    metaJson?: string;
    currencyCode?: string;
    amountCurrency?: number;
    fxRateToUsd?: number;
    amountUsd?: number;
    createdBy?: number;
  }) {
    const currency = opts.currencyCode || "USD";
    const fxRate = opts.fxRateToUsd || 1;
    const amtCurrency = opts.amountCurrency || 0;
    const amtUsd = opts.amountUsd !== undefined ? opts.amountUsd : (currency === "USD" ? amtCurrency : amtCurrency * fxRate);
    await dbOrTx.insert(factoryDaybookEntries).values({
      companyId: opts.companyId,
      txDate: opts.txDate,
      txType: opts.txType,
      referenceId: opts.referenceId || null,
      referenceTable: opts.referenceTable || null,
      description: opts.description,
      metaJson: opts.metaJson || null,
      currencyCode: currency,
      amountCurrency: String(amtCurrency),
      fxRateToUsd: String(fxRate),
      amountUsd: String(amtUsd),
      createdBy: opts.createdBy || null,
    });
  }

  function isLegacySHA256Hash(hash: string): boolean {
    return /^[a-f0-9]{64}$/i.test(hash);
  }

  async function verifySupervisorPassword(password: string, hash: string): Promise<boolean> {
    if (isLegacySHA256Hash(hash)) {
      return CryptoJS.SHA256(password).toString().toLowerCase() === hash.toLowerCase();
    }
    return bcrypt.compare(password, hash);
  }

  // ───────────────────────────────────────────────
  // STOCK ENTRY - Direct to stock (replaces pressing/finalize)
  // ───────────────────────────────────────────────

  app.post("/api/factory/stock-entry", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { items, erpLocationId, mixBatchId } = req.body;
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "items array is required" });
      }
      if (!erpLocationId) {
        return res.status(400).json({ message: "Location is required" });
      }
      if (!mixBatchId) {
        return res.status(400).json({ message: "Mix batch is required" });
      }

      const result = await db.transaction(async (tx: any) => {
        const [mixBatch] = await tx
          .select()
          .from(factoryMixBatches)
          .where(and(eq(factoryMixBatches.id, mixBatchId), eq(factoryMixBatches.companyId, companyId)))
          .for("update");

        if (!mixBatch) throw new Error("Mix batch not found");

        const totalExpected = items.reduce((sum: number, item: any) => sum + parseInt(item.quantity || item.qty || "1"), 0);

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
            .set({ nextNumber: nextNumber + totalExpected })
            .where(eq(factoryBaleSequences.id, seqRecord.id));
        } else {
          nextNumber = 1;
          await tx.insert(factoryBaleSequences).values({
            companyId,
            nextNumber: 1 + totalExpected,
          });
        }

        const costPerKg = parseFloat(mixBatch.costPerKg || "0");
        const now = new Date();
        const bales: any[] = [];
        let baleIndex = 0;
        let totalWeight = 0;

        const productIds: number[] = [];
        for (const item of items) {
          if (item.productId && !productIds.includes(item.productId)) productIds.push(item.productId);
        }
        const factoryProducts = productIds.length > 0
          ? await tx.select().from(factoryBaleProducts).where(inArray(factoryBaleProducts.id, productIds))
          : [];
        const productMap = new Map<number, any>(factoryProducts.map((p: any) => [p.id, p]));

        for (const item of items) {
          const qty = parseInt(item.quantity || item.qty || "1");
          const weight = parseFloat(item.weightPerBale || "25");
          const product = productMap.get(item.productId);
          if (!product) throw new Error(`Product ID ${item.productId} not found`);

          for (let i = 0; i < qty; i++) {
            const refNum = `HD${String(nextNumber + baleIndex).padStart(5, "0")}`;
            const baleTotalCost = weight * costPerKg;

            const [bale] = await tx
              .insert(factoryBales)
              .values({
                companyId,
                mixBatchId,
                productId: item.productId,
                erpLocationId,
                baleCode: product.code,
                referenceNumber: refNum,
                articleCode: product.articleCode,
                productName: product.name,
                weightKg: String(weight),
                costPerKg: String(costPerKg),
                totalCost: String(baleTotalCost),
                status: "IN_STOCK",
                finalizedAt: now,
              })
              .returning();

            bales.push({ ...bale, _product: product });
            totalWeight += weight;
            baleIndex++;
          }
        }

        const mixRemaining = parseFloat(mixBatch.totalWeightKg) - parseFloat(mixBatch.usedKg || "0");
        if (totalWeight > mixRemaining + 0.001) {
          throw new Error(`Not enough mix batch remaining. Need ${totalWeight.toFixed(3)} kg but only ${mixRemaining.toFixed(3)} kg available`);
        }

        await tx
          .update(factoryMixBatches)
          .set({ usedKg: sql`${factoryMixBatches.usedKg} + ${totalWeight}`, updatedAt: now })
          .where(eq(factoryMixBatches.id, mixBatchId));

        const categoryIdSet = new Set<number>();
        factoryProducts.forEach((p: any) => { if (p.categoryId) categoryIdSet.add(p.categoryId); });
        const categoryIds = Array.from(categoryIdSet);
        const factoryCats = categoryIds.length > 0
          ? await tx.select().from(factoryCategories).where(inArray(factoryCategories.id, categoryIds))
          : [];
        const categoryMap = new Map<number, any>(factoryCats.map((c: any) => [c.id, c]));

        const stockGroupCache = new Map<string, number>();
        const stockItemCache = new Map<string, number>();

        for (const bale of bales) {
          const factoryProduct = productMap.get(bale.productId as number);
          if (!factoryProduct) continue;

          const itemCode: string = factoryProduct.articleCode || factoryProduct.code;
          if (!itemCode) continue;

          let stockGroupId: number | null = null;
          if (factoryProduct.categoryId) {
            const cat = categoryMap.get(factoryProduct.categoryId);
            if (cat) {
              const catName = cat.name as string;
              const cached = stockGroupCache.get(catName);
              if (cached) {
                stockGroupId = cached;
              } else {
                const [existingGroup] = await tx
                  .select({ id: stockGroups.id })
                  .from(stockGroups)
                  .where(and(eq(stockGroups.companyId, companyId), eq(stockGroups.name, catName)));

                if (existingGroup) {
                  stockGroupId = existingGroup.id;
                } else {
                  const groupCode = "F-" + catName.replace(/[^A-Z0-9]/gi, "").substring(0, 10).toUpperCase();
                  const [created] = await tx
                    .insert(stockGroups)
                    .values({ companyId, name: catName, code: groupCode })
                    .returning({ id: stockGroups.id });
                  stockGroupId = created.id;
                }
                stockGroupCache.set(catName, stockGroupId!);
              }
            }
          }

          let erpStockItemId: number | undefined = stockItemCache.get(itemCode);

          if (!erpStockItemId) {
            const [existing] = await tx
              .select({ id: stockItems.id, stockGroupId: stockItems.stockGroupId })
              .from(stockItems)
              .where(and(eq(stockItems.companyId, companyId), eq(stockItems.code, itemCode)));

            if (existing) {
              erpStockItemId = existing.id;
              if (stockGroupId && !existing.stockGroupId) {
                await tx.update(stockItems).set({ stockGroupId }).where(eq(stockItems.id, existing.id));
              }
            } else {
              const [created] = await tx
                .insert(stockItems)
                .values({
                  companyId,
                  code: itemCode,
                  name: factoryProduct.name as string,
                  uom: "BALE",
                  active: true,
                  ...(stockGroupId ? { stockGroupId } : {}),
                })
                .returning({ id: stockItems.id });
              erpStockItemId = created.id;
            }
            stockItemCache.set(itemCode, erpStockItemId!);
          }

          const baleWeight = parseFloat(bale.weightKg);
          const baleRate = baleWeight * costPerKg;
          await adjustInventory(tx, erpLocationId, erpStockItemId!, 1, companyId, baleRate);
        }

        return { bales, totalWeight };
      });

      const today = new Date().toISOString().split('T')[0];
      await writeDaybookEntry(db, {
        companyId,
        txDate: today,
        txType: "BALE_STOCK_ENTRY",
        description: `Stock entry: ${result.bales.length} bales entered into location`,
      });

      res.json({ bales: result.bales, totalWeight: result.totalWeight });
    } catch (error: any) {
      console.error("Error in stock entry:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/factory/stock-entry/remove", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { baleIds, supervisorUsername, supervisorPassword, reason } = req.body;

      if (!baleIds || !Array.isArray(baleIds) || baleIds.length === 0) {
        return res.status(400).json({ message: "baleIds array is required" });
      }
      if (!supervisorUsername || !supervisorPassword) {
        return res.status(400).json({ message: "Supervisor credentials are required" });
      }

      const [supervisor] = await db
        .select()
        .from(users)
        .where(eq(users.username, supervisorUsername));

      if (!supervisor) {
        return res.status(403).json({ message: "Supervisor not found" });
      }

      const passwordValid = await verifySupervisorPassword(supervisorPassword, supervisor.password);
      if (!passwordValid) {
        return res.status(403).json({ message: "Invalid supervisor password" });
      }

      const [role] = await db
        .select()
        .from(userCompanyRoles)
        .where(and(eq(userCompanyRoles.userId, supervisor.id), eq(userCompanyRoles.companyId, companyId)));

      if (!role || !["Admin", "Owner", "Manager"].includes(role.role)) {
        return res.status(403).json({ message: "Supervisor must have Admin, Owner, or Manager role" });
      }

      const result = await db.transaction(async (tx: any) => {
        const balesToRemove = await tx
          .select()
          .from(factoryBales)
          .where(and(eq(factoryBales.companyId, companyId), inArray(factoryBales.id, baleIds)));

        const removedBales: any[] = [];
        const now = new Date();

        const productIds: number[] = [];
        for (const bale of balesToRemove) {
          if (bale.productId && !productIds.includes(bale.productId)) productIds.push(bale.productId);
        }
        const factoryProducts = productIds.length > 0
          ? await tx.select().from(factoryBaleProducts).where(inArray(factoryBaleProducts.id, productIds))
          : [];
        const productMap = new Map<number, any>(factoryProducts.map((p: any) => [p.id, p]));

        const stockItemCache = new Map<string, number>();

        for (const bale of balesToRemove) {
          if (bale.status !== "IN_STOCK" && bale.status !== "FINALIZED") {
            throw new Error(`Bale ${bale.referenceNumber} is not in stock (status: ${bale.status})`);
          }

          if (!bale.erpLocationId) {
            throw new Error(`Bale ${bale.referenceNumber} has no location assigned`);
          }

          const [updated] = await tx
            .update(factoryBales)
            .set({
              status: "REMOVED",
              updatedAt: now,
            })
            .where(eq(factoryBales.id, bale.id))
            .returning();

          removedBales.push(updated);

          const factoryProduct = productMap.get(bale.productId as number);
          const itemCode = factoryProduct?.articleCode || factoryProduct?.code || bale.articleCode || bale.baleCode;

          if (itemCode) {
            let erpStockItemId = stockItemCache.get(itemCode);
            if (!erpStockItemId) {
              const [existing] = await tx
                .select({ id: stockItems.id })
                .from(stockItems)
                .where(and(eq(stockItems.companyId, companyId), eq(stockItems.code, itemCode)));
              if (existing) {
                erpStockItemId = existing.id;
                stockItemCache.set(itemCode, erpStockItemId!);
              }
            }

            if (erpStockItemId) {
              await adjustInventory(tx, bale.erpLocationId!, erpStockItemId, -1, companyId);
            }
          }
        }

        return { removed: removedBales };
      });

      const today = new Date().toISOString().split('T')[0];
      await writeDaybookEntry(db, {
        companyId,
        txDate: today,
        txType: "BALE_REMOVAL",
        description: `Removed ${result.removed.length} bale(s) from stock. Supervisor: ${supervisorUsername}. Reason: ${reason || "N/A"}`,
      });

      res.json({ removed: result.removed.length, bales: result.removed });
    } catch (error: any) {
      console.error("Error removing bales:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/factory/stock-entry/in-stock", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { locationId } = req.query;

      const conditions: any[] = [
        eq(factoryBales.companyId, companyId),
        or(eq(factoryBales.status, "IN_STOCK"), eq(factoryBales.status, "FINALIZED")),
      ];

      if (locationId) {
        conditions.push(eq(factoryBales.erpLocationId, parseInt(locationId as string)));
      }

      const results = await db
        .select()
        .from(factoryBales)
        .where(and(...conditions))
        .orderBy(desc(factoryBales.finalizedAt));

      res.json(results);
    } catch (error: any) {
      console.error("Error fetching in-stock bales:", error);
      res.status(500).json({ message: error.message });
    }
  });

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
  // 1b. Factory Suppliers - Balances & Statement
  // ───────────────────────────────────────────────

  app.get("/api/factory/suppliers/with-balances", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const suppliers = await db
        .select()
        .from(factorySuppliers)
        .where(eq(factorySuppliers.companyId, companyId))
        .orderBy(factorySuppliers.name);

      const containers = await db
        .select()
        .from(factoryContainers)
        .where(eq(factoryContainers.companyId, companyId));

      const suppliersWithBalances = suppliers.map((s: any) => {
        const supplierContainers = containers.filter((c: any) => c.supplierId === s.id);
        const totalContainers = supplierContainers.length;
        const totalKg = supplierContainers.reduce((sum: number, c: any) => {
          return sum + (parseFloat(c.actualReceivedKg || c.totalKg || "0"));
        }, 0);
        const totalValue = supplierContainers.reduce((sum: number, c: any) => {
          if (c.finalPayableAmount) return sum + parseFloat(c.finalPayableAmount);
          const kg = parseFloat(c.totalKg || "0");
          const rate = parseFloat(c.ratePerKg || "0");
          return sum + (kg * rate);
        }, 0);
        const pendingContainers = supplierContainers.filter((c: any) => c.status === "PENDING" || c.status === "IN_TRANSIT").length;
        const receivedContainers = supplierContainers.filter((c: any) => c.status === "RECEIVED" || c.status === "PARTIALLY_RECEIVED" || c.status === "OFFLOADED").length;
        const lastContainerDate = supplierContainers.length > 0
          ? supplierContainers.reduce((latest: string | null, c: any) => {
              const d = c.arrivalDate || c.createdAt;
              if (!latest) return d;
              return new Date(d) > new Date(latest) ? d : latest;
            }, null)
          : null;

        return {
          ...s,
          totalContainers,
          totalKg: totalKg.toFixed(3),
          totalValue: totalValue.toFixed(2),
          pendingContainers,
          receivedContainers,
          lastContainerDate,
        };
      });

      res.json(suppliersWithBalances);
    } catch (error: any) {
      console.error("Error fetching factory suppliers with balances:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/suppliers/:id/statement", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const supplierId = parseInt(req.params.id);

      const [supplier] = await db
        .select()
        .from(factorySuppliers)
        .where(and(eq(factorySuppliers.id, supplierId), eq(factorySuppliers.companyId, companyId)));

      if (!supplier) return res.status(404).json({ message: "Supplier not found" });

      const containers = await db
        .select()
        .from(factoryContainers)
        .where(and(
          eq(factoryContainers.companyId, companyId),
          eq(factoryContainers.supplierId, supplierId)
        ))
        .orderBy(desc(factoryContainers.createdAt));

      const commissions = await db
        .select()
        .from(factoryContainerCommissions)
        .where(eq(factoryContainerCommissions.companyId, companyId));

      const statement = containers.map((c: any) => {
        const kg = parseFloat(c.actualReceivedKg || c.totalKg || "0");
        const rate = parseFloat(c.ratePerKg || "0");
        const value = c.finalPayableAmount ? parseFloat(c.finalPayableAmount) : kg * rate;
        const containerCommissions = commissions.filter((cm: any) => cm.containerId === c.id);
        const totalCommission = containerCommissions.reduce((sum: number, cm: any) => sum + parseFloat(cm.commissionTotal || "0"), 0);

        return {
          id: c.id,
          containerNumber: c.containerNumber,
          date: c.arrivalDate || c.createdAt,
          origin: c.origin,
          status: c.status,
          declaredKg: c.declaredKg,
          actualReceivedKg: c.actualReceivedKg,
          totalKg: c.totalKg,
          ratePerKg: c.ratePerKg,
          differenceKg: c.differenceKg,
          value: value.toFixed(2),
          finalPayableAmount: c.finalPayableAmount,
          commissions: containerCommissions,
          totalCommission: totalCommission.toFixed(2),
          notes: c.notes,
        };
      });

      const totalValue = statement.reduce((sum: number, s: any) => sum + parseFloat(s.value), 0);
      const totalKg = statement.reduce((sum: number, s: any) => sum + parseFloat(s.actualReceivedKg || s.totalKg || "0"), 0);
      const totalCommissions = statement.reduce((sum: number, s: any) => sum + parseFloat(s.totalCommission), 0);

      res.json({
        supplier,
        statement,
        summary: {
          totalContainers: statement.length,
          totalKg: totalKg.toFixed(3),
          totalValue: totalValue.toFixed(2),
          totalCommissions: totalCommissions.toFixed(2),
          netPayable: (totalValue - totalCommissions).toFixed(2),
        },
      });
    } catch (error: any) {
      console.error("Error fetching supplier statement:", error);
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
      const currencyCode = parsed.currencyCode || "USD";
      const fxRate = parseFloat(parsed.fxRateToUsd || "1");
      const ratePerKg = parseFloat(parsed.ratePerKg || "0");
      const ratePerKgUsd = currencyCode === "USD" ? ratePerKg : ratePerKg * fxRate;
      const values = {
        ...parsed,
        currencyCode,
        fxRateToUsd: String(fxRate),
        ratePerKgUsd: String(ratePerKgUsd),
      };
      const [container] = await db.insert(factoryContainers).values(values).returning();
      const today = new Date().toISOString().split('T')[0];
      await writeDaybookEntry(db, {
        companyId,
        txDate: container.arrivalDate || today,
        txType: "CONTAINER_IMPORT",
        referenceId: container.id,
        description: `Container imported: ${container.containerNumber}`,
        currencyCode: container.currencyCode || "USD",
        amountCurrency: parseFloat(container.ratePerKg || "0") * parseFloat(container.totalKg || "0"),
        fxRateToUsd: parseFloat(container.fxRateToUsd || "1"),
      });
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
          costPerKgUsd: factoryRawStock.costPerKgUsd,
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

      const { containerId, receivedKg, costPerKg, commission, currencyCode: reqCurrencyCode, fxRateToUsd: reqFxRate } = req.body;
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

      const currencyCode = reqCurrencyCode || container.currencyCode || "USD";
      const fxRate = parseFloat(reqFxRate || container.fxRateToUsd || "1");

      const declaredKg = container.totalKg || "0";
      const actualKg = receivedKg || declaredKg;
      const finalCostPerKg = costPerKg || container.ratePerKg || "0";
      const differenceKg = String(parseFloat(declaredKg) - parseFloat(actualKg));
      const finalPayableAmount = String(parseFloat(actualKg) * parseFloat(finalCostPerKg));

      const costPerKgUsd = currencyCode === "USD" ? parseFloat(finalCostPerKg) : parseFloat(finalCostPerKg) * fxRate;
      const finalPayableAmountUsd = String(parseFloat(actualKg) * costPerKgUsd);

      const newStatus = parseFloat(actualKg) < parseFloat(declaredKg) ? "PARTIALLY_RECEIVED" : "OFFLOADED";

      const [rawStock] = await db
        .insert(factoryRawStock)
        .values({
          companyId,
          containerId,
          receivedKg: String(actualKg),
          costPerKg: String(finalCostPerKg),
          costPerKgUsd: String(costPerKgUsd),
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
          currencyCode,
          fxRateToUsd: String(fxRate),
          ratePerKgUsd: String(costPerKgUsd),
          finalPayableAmountUsd,
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

        const commCurrency = commission.currencyCode || currencyCode;
        const commFxRate = parseFloat(commission.fxRateToUsd || String(fxRate));
        const commTotalUsd = commCurrency === "USD" ? commTotal : commTotal * commFxRate;

        [commissionRecord] = await db
          .insert(factoryContainerCommissions)
          .values({
            companyId,
            containerId,
            personName: commission.personName,
            commissionType: commType,
            commissionRate: String(commRate),
            commissionTotal: String(commTotal),
            currencyCode: commCurrency,
            fxRateToUsd: String(commFxRate),
            commissionTotalUsd: String(commTotalUsd),
          })
          .returning();
      }

      const today = new Date().toISOString().split('T')[0];
      await writeDaybookEntry(db, {
        companyId,
        txDate: today,
        txType: "OFFLOAD_RAW_STOCK",
        referenceId: rawStock.id,
        description: `Offloaded container ${container.containerNumber}: ${actualKg} kg at ${finalCostPerKg}/kg`,
        currencyCode,
        amountCurrency: parseFloat(finalPayableAmount),
        fxRateToUsd: fxRate,
      });
      if (commissionRecord) {
        await writeDaybookEntry(db, {
          companyId,
          txDate: today,
          txType: "COMMISSION",
          referenceId: commissionRecord.id,
          description: `Commission for ${commissionRecord.personName} on container ${container.containerNumber}`,
          currencyCode: commissionRecord.currencyCode || "USD",
          amountCurrency: parseFloat(commissionRecord.commissionTotal),
          fxRateToUsd: parseFloat(commissionRecord.fxRateToUsd || "1"),
        });
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

          const costUsd = srcCostPerKg ? parseFloat(srcCostPerKg) : parseFloat(rawStock.costPerKgUsd || rawStock.costPerKg);

          await tx
            .update(factoryRawStock)
            .set({ usedKg: sql`${factoryRawStock.usedKg} + ${weight}` })
            .where(eq(factoryRawStock.id, rawStock.id));

          totalWeightKg += weight;
          totalCost += weight * costUsd;
          sourceRecords.push({ containerId, weightKg: String(weight), costPerKg: String(costUsd), totalCost: String(weight * costUsd) });
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

      const today = new Date().toISOString().split('T')[0];
      await writeDaybookEntry(db, {
        companyId,
        txDate: today,
        txType: "BALE_PRESSING",
        referenceId: result.pressingBatchId,
        description: `Pressing batch created: ${result.bales?.length || 0} bales`,
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error creating pressing batch:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/factory/pressing/create-multi", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { items } = req.body;
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "items array is required with at least one entry" });
      }

      const result = await db.transaction(async (tx: any) => {
        const totalExpected = items.reduce((sum: number, item: any) => sum + parseInt(item.quantity || item.qty), 0);

        const [pressingBatch] = await tx
          .insert(factoryPressingBatches)
          .values({
            companyId,
            productId: items[0].productId,
            expectedCount: totalExpected,
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
            .set({ nextNumber: nextNumber + totalExpected })
            .where(eq(factoryBaleSequences.id, seqRecord.id));
        } else {
          nextNumber = 1;
          await tx.insert(factoryBaleSequences).values({
            companyId,
            nextNumber: 1 + totalExpected,
          });
        }

        const bales: any[] = [];
        let baleIndex = 0;

        for (const item of items) {
          const qty = parseInt(item.quantity || item.qty);
          const weight = item.weightPerBale;

          const [product] = await tx
            .select()
            .from(factoryBaleProducts)
            .where(and(eq(factoryBaleProducts.id, item.productId), eq(factoryBaleProducts.companyId, companyId)));

          if (!product) throw new Error(`Product ID ${item.productId} not found`);

          for (let i = 0; i < qty; i++) {
            const refNum = `HD${String(nextNumber + baleIndex).padStart(5, "0")}`;
            const [bale] = await tx
              .insert(factoryBales)
              .values({
                companyId,
                pressingBatchId: pressingBatch.id,
                productId: item.productId,
                baleCode: product.code,
                referenceNumber: refNum,
                articleCode: product.articleCode,
                productName: product.name,
                weightKg: String(weight),
                status: "PENDING_PRESSING",
              })
              .returning();
            bales.push({ ...bale, _product: product });
            baleIndex++;
          }
        }

        return { pressingBatchId: pressingBatch.id, bales };
      });

      const today = new Date().toISOString().split('T')[0];
      await writeDaybookEntry(db, {
        companyId,
        txDate: today,
        txType: "BALE_PRESSING",
        referenceId: result.pressingBatchId,
        description: `Multi-product pressing batch: ${result.bales?.length || 0} bales`,
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error creating multi-product pressing batch:", error);
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
            .select()
            .from(factoryBales)
            .where(eq(factoryBales.pressingBatchId, batch.id))
            .orderBy(factoryBales.referenceNumber);

          const pendingCount = balesForBatch.filter((b: any) => b.status === "PENDING_PRESSING").length;
          const finalizedCount = balesForBatch.filter((b: any) => b.status === "FINALIZED").length;

          return { ...batch, pendingCount, finalizedCount, bales: balesForBatch };
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
        if (pressingBatch.status === "FINALIZED") throw new Error("Pressing batch is already fully finalized");

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

        const scannedSet = new Set(scannedBaleIds);
        const pendingBaleIds = new Set(pendingBales.map((b: any) => b.id));
        for (const scannedId of scannedBaleIds) {
          if (!pendingBaleIds.has(scannedId)) {
            throw new Error(`Bale ID ${scannedId} is not a valid pending bale for this pressing batch`);
          }
        }

        const balesToFinalize = pendingBales.filter((b: any) => scannedSet.has(b.id));
        const missingBales = pendingBales.filter((b: any) => !scannedSet.has(b.id));

        let totalWeight = 0;
        for (const bale of balesToFinalize) {
          totalWeight += parseFloat(bale.weightKg);
        }

        if (totalWeight > mixRemaining + 0.001) {
          throw new Error(`Not enough mix batch remaining. Need ${totalWeight.toFixed(3)} kg but only ${mixRemaining.toFixed(3)} kg available`);
        }

        const costPerKg = parseFloat(mixBatch.costPerKg);
        const now = new Date();
        const updatedBales: any[] = [];

        for (const bale of balesToFinalize) {
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

        const isFullyFinalized = missingBales.length === 0;
        await tx
          .update(factoryPressingBatches)
          .set({
            status: isFullyFinalized ? "FINALIZED" : "PARTIALLY_FINALIZED",
            mixBatchId,
            finalizedAt: isFullyFinalized ? now : null,
            finalizedLocationId: erpLocationId,
          })
          .where(eq(factoryPressingBatches.id, pressingBatchId));

        const productIds: number[] = [];
        for (const b of balesToFinalize) {
          if (b.productId && !productIds.includes(b.productId)) productIds.push(b.productId);
        }
        const factoryProducts = productIds.length > 0
          ? await tx.select().from(factoryBaleProducts).where(inArray(factoryBaleProducts.id, productIds))
          : [];

        const productMap = new Map<number, any>(factoryProducts.map((p: any) => [p.id, p]));

        const categoryIdSet = new Set<number>();
        factoryProducts.forEach((p: any) => { if (p.categoryId) categoryIdSet.add(p.categoryId); });
        const categoryIds = Array.from(categoryIdSet);
        const factoryCats = categoryIds.length > 0
          ? await tx.select().from(factoryCategories).where(inArray(factoryCategories.id, categoryIds))
          : [];
        const categoryMap = new Map<number, any>(factoryCats.map((c: any) => [c.id, c]));

        const stockGroupCache = new Map<string, number>();

        const stockItemCache = new Map<string, number>();

        for (const bale of balesToFinalize) {
          const factoryProduct = productMap.get(bale.productId as number);
          if (!factoryProduct) continue;

          const itemCode: string = factoryProduct.articleCode || factoryProduct.code;
          if (!itemCode) continue;

          let stockGroupId: number | null = null;
          if (factoryProduct.categoryId) {
            const cat = categoryMap.get(factoryProduct.categoryId);
            if (cat) {
              const catName = cat.name as string;
              const cached = stockGroupCache.get(catName);
              if (cached) {
                stockGroupId = cached;
              } else {
                const [existingGroup] = await tx
                  .select({ id: stockGroups.id })
                  .from(stockGroups)
                  .where(and(eq(stockGroups.companyId, companyId), eq(stockGroups.name, catName)));

                if (existingGroup) {
                  stockGroupId = existingGroup.id;
                } else {
                  const groupCode = "F-" + catName.replace(/[^A-Z0-9]/gi, "").substring(0, 10).toUpperCase();
                  const [created] = await tx
                    .insert(stockGroups)
                    .values({ companyId, name: catName, code: groupCode })
                    .returning({ id: stockGroups.id });
                  stockGroupId = created.id;
                }
                stockGroupCache.set(catName, stockGroupId!);
              }
            }
          }

          let erpStockItemId: number | undefined = stockItemCache.get(itemCode);

          if (!erpStockItemId) {
            const [existing] = await tx
              .select({ id: stockItems.id, stockGroupId: stockItems.stockGroupId })
              .from(stockItems)
              .where(and(eq(stockItems.companyId, companyId), eq(stockItems.code, itemCode)));

            if (existing) {
              erpStockItemId = existing.id;
              if (stockGroupId && !existing.stockGroupId) {
                await tx.update(stockItems).set({ stockGroupId }).where(eq(stockItems.id, existing.id));
              }
            } else {
              const [created] = await tx
                .insert(stockItems)
                .values({
                  companyId,
                  code: itemCode,
                  name: factoryProduct.name as string,
                  uom: "BALE",
                  active: true,
                  ...(stockGroupId ? { stockGroupId } : {}),
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

        return {
          updated: updatedBales.length,
          bales: updatedBales,
          missingBales: missingBales.map((b: any) => ({
            id: b.id,
            referenceNumber: b.referenceNumber,
            productName: b.productName,
            articleCode: b.articleCode,
            weightKg: b.weightKg,
          })),
          isFullyFinalized,
        };
      });

      const today = new Date().toISOString().split('T')[0];
      await writeDaybookEntry(db, {
        companyId,
        txDate: today,
        txType: "BALE_FINALIZE",
        referenceId: pressingBatchId,
        description: `Finalized ${result.updated} bales into location`,
        amountCurrency: 0,
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
      const batchId = req.query.batchId ? parseInt(req.query.batchId as string) : null;
      const excludeIdsStr = req.query.excludeIds as string;
      const excludeIds = excludeIdsStr ? excludeIdsStr.split(",").map(Number).filter(n => !isNaN(n)) : [];

      let results: any[] = [];

      const baseConditions: any[] = [
        eq(factoryBales.companyId, companyId),
        or(
          eq(factoryBales.referenceNumber, barcode),
          eq(factoryBales.baleCode, barcode),
          eq(factoryBales.articleCode, barcode)
        ),
      ];
      if (batchId) {
        baseConditions.push(eq(factoryBales.pressingBatchId, batchId));
        baseConditions.push(eq(factoryBales.status, "PENDING_PRESSING"));
      }
      results = await db.select().from(factoryBales)
        .where(and(...baseConditions))
        .orderBy(factoryBales.id);

      if (results.length === 0) {
        const labelResults = await db
          .select()
          .from(baleLabelPrints)
          .where(
            and(
              eq(baleLabelPrints.companyId, companyId),
              eq(baleLabelPrints.referenceNumber, barcode)
            )
          );

        if (labelResults.length > 0 && labelResults[0].productionBaleId) {
          const labelBale = await db
            .select()
            .from(factoryBales)
            .where(eq(factoryBales.id, labelResults[0].productionBaleId));
          if (labelBale.length > 0) {
            if (!batchId || labelBale[0].pressingBatchId === batchId) {
              results = labelBale;
            }
          }
        }
      }

      if (excludeIds.length > 0) {
        results = results.filter((b: any) => !excludeIds.includes(b.id));
      }

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

  // ───────────────────────────────────────────────
  // Factory Import API Endpoints
  // ───────────────────────────────────────────────

  app.post("/api/factory/import/suppliers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { suppliers: supplierList } = req.body;
      if (!Array.isArray(supplierList) || supplierList.length === 0) {
        return res.status(400).json({ message: "No suppliers provided" });
      }

      let imported = 0;
      let updated = 0;
      const errors: string[] = [];

      for (let i = 0; i < supplierList.length; i++) {
        const s = supplierList[i];
        try {
          if (!s.name || !s.name.trim()) {
            errors.push(`Row ${i + 1}: Name is required`);
            continue;
          }

          const [existing] = await db
            .select()
            .from(factorySuppliers)
            .where(and(eq(factorySuppliers.companyId, companyId), ilike(factorySuppliers.name, s.name.trim())));

          if (existing) {
            await db
              .update(factorySuppliers)
              .set({
                openingBalance: s.openingBalance || existing.openingBalance,
                contactPerson: s.contactPerson !== undefined ? s.contactPerson : existing.contactPerson,
                phone: s.phone !== undefined ? s.phone : existing.phone,
                email: s.email !== undefined ? s.email : existing.email,
                updatedAt: new Date(),
              })
              .where(eq(factorySuppliers.id, existing.id));
            updated++;
          } else {
            await db.insert(factorySuppliers).values({
              companyId,
              name: s.name.trim(),
              openingBalance: s.openingBalance || "0",
              contactPerson: s.contactPerson || null,
              phone: s.phone || null,
              email: s.email || null,
            });
            imported++;
          }
        } catch (err: any) {
          errors.push(`Row ${i + 1}: ${err.message}`);
        }
      }

      res.json({ imported, updated, errors });
    } catch (error: any) {
      console.error("Error importing suppliers:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/import/raw-stock", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { items } = req.body;
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "No items provided" });
      }

      let imported = 0;
      const errors: string[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        try {
          if (!item.containerNumber || !item.containerNumber.trim()) {
            errors.push(`Row ${i + 1}: Container number is required`);
            continue;
          }
          if (!item.receivedKg) {
            errors.push(`Row ${i + 1}: Received KG is required`);
            continue;
          }
          if (!item.costPerKg) {
            errors.push(`Row ${i + 1}: Cost per KG is required`);
            continue;
          }

          let supplierId: number | null = null;
          if (item.supplierName && item.supplierName.trim()) {
            const [supplier] = await db
              .select()
              .from(factorySuppliers)
              .where(and(eq(factorySuppliers.companyId, companyId), ilike(factorySuppliers.name, item.supplierName.trim())));
            if (supplier) {
              supplierId = supplier.id;
            }
          }

          let [container] = await db
            .select()
            .from(factoryContainers)
            .where(and(eq(factoryContainers.companyId, companyId), eq(factoryContainers.containerNumber, item.containerNumber.trim())));

          if (!container) {
            [container] = await db.insert(factoryContainers).values({
              companyId,
              containerNumber: item.containerNumber.trim(),
              supplierId,
              totalKg: item.receivedKg,
              ratePerKg: item.costPerKg,
              arrivalDate: item.arrivalDate || null,
              status: "RECEIVED",
            }).returning();
          } else if (supplierId && !container.supplierId) {
            await db.update(factoryContainers).set({ supplierId }).where(eq(factoryContainers.id, container.id));
          }

          await db.insert(factoryRawStock).values({
            companyId,
            containerId: container.id,
            receivedKg: item.receivedKg,
            usedKg: item.usedKg || "0",
            costPerKg: item.costPerKg,
          });
          imported++;
        } catch (err: any) {
          errors.push(`Row ${i + 1}: ${err.message}`);
        }
      }

      res.json({ imported, errors });
    } catch (error: any) {
      console.error("Error importing raw stock:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/import/bales", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { bales } = req.body;
      if (!Array.isArray(bales) || bales.length === 0) {
        return res.status(400).json({ message: "No bales provided" });
      }

      const maxRef = await db.select({ maxRef: sql`MAX(CAST(SUBSTRING(reference_number FROM 4) AS INTEGER))` }).from(factoryBales).where(eq(factoryBales.companyId, companyId));
      let nextRef = (maxRef[0]?.maxRef || 0) + 1;

      let imported = 0;
      const errors: string[] = [];

      for (let i = 0; i < bales.length; i++) {
        const bale = bales[i];
        try {
          if (!bale.baleCode || !bale.baleCode.trim()) {
            errors.push(`Row ${i + 1}: Bale code is required`);
            continue;
          }
          if (!bale.weightKg) {
            errors.push(`Row ${i + 1}: Weight KG is required`);
            continue;
          }

          const referenceNumber = `REF${String(nextRef).padStart(5, "0")}`;
          nextRef++;

          const status = bale.status || "FINALIZED";
          const costPerKg = bale.costPerKg || "0";
          const weight = parseFloat(bale.weightKg);
          const cost = parseFloat(costPerKg);
          const totalCost = (weight * cost).toFixed(2);

          await db.insert(factoryBales).values({
            companyId,
            baleCode: bale.baleCode.trim(),
            referenceNumber,
            articleCode: bale.articleCode || null,
            productName: bale.productName || null,
            category: bale.category || null,
            grade: bale.grade || null,
            quantity: 1,
            weightKg: bale.weightKg,
            costPerKg,
            totalCost,
            status,
            finalizedAt: status === "FINALIZED" ? new Date() : null,
          });
          imported++;
        } catch (err: any) {
          errors.push(`Row ${i + 1}: ${err.message}`);
        }
      }

      res.json({ imported, errors });
    } catch (error: any) {
      console.error("Error importing bales:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/import/template/:type", requireAuth, async (req: any, res: any) => {
    try {
      const type = req.params.type;
      let csv = "";
      let filename = "";

      switch (type) {
        case "suppliers":
          csv = "name,openingBalance,contactPerson,phone,email";
          filename = "factory_suppliers_template.csv";
          break;
        case "raw-stock":
          csv = "containerNumber,supplierName,receivedKg,usedKg,costPerKg,arrivalDate";
          filename = "factory_raw_stock_template.csv";
          break;
        case "bales":
          csv = "baleCode,articleCode,productName,category,grade,weightKg,costPerKg,status";
          filename = "factory_bales_template.csv";
          break;
        default:
          return res.status(400).json({ message: "Invalid template type. Use: suppliers, raw-stock, or bales" });
      }

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (error: any) {
      console.error("Error generating template:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // HELPER: Recalculate order totals
  // ───────────────────────────────────────────────
  async function recalculateOrderTotals(dbConn: any, orderId: number) {
    const bales = await dbConn.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));

    await dbConn.delete(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));

    const grouped: Record<string, { articleCode: string; baleName: string; qty: number; totalWeight: number; totalPrice: number }> = {};
    for (const b of bales) {
      const key = b.articleCode || 'UNKNOWN';
      if (!grouped[key]) {
        grouped[key] = { articleCode: key, baleName: b.baleName || key, qty: 0, totalWeight: 0, totalPrice: 0 };
      }
      grouped[key].qty += 1;
      grouped[key].totalWeight += parseFloat(b.weight);
      grouped[key].totalPrice += parseFloat(b.priceUsed);
    }

    for (const line of Object.values(grouped)) {
      await dbConn.insert(customerOrderLines).values({
        orderId,
        articleCode: line.articleCode,
        baleName: line.baleName,
        qty: line.qty,
        weightPerBale: String(line.qty > 0 ? line.totalWeight / line.qty : 0),
        totalWeight: String(line.totalWeight),
        pricePerBale: String(line.qty > 0 ? line.totalPrice / line.qty : 0),
        totalPrice: String(line.totalPrice),
      });
    }

    const charges = await dbConn.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));
    const freightAmount = charges.filter((c: any) => c.chargeType === 'FREIGHT').reduce((sum: number, c: any) => sum + parseFloat(c.amount), 0);
    const otherChargesTotal = charges.filter((c: any) => c.chargeType === 'OTHER').reduce((sum: number, c: any) => sum + parseFloat(c.amount), 0);
    const subtotalBales = bales.reduce((sum: number, b: any) => sum + parseFloat(b.priceUsed), 0);
    const grandTotal = subtotalBales + freightAmount + otherChargesTotal;

    await dbConn.update(customerOrders).set({
      subtotalBales: String(subtotalBales),
      freightAmount: String(freightAmount),
      otherChargesTotal: String(otherChargesTotal),
      grandTotal: String(grandTotal),
      totalQtyBales: bales.length,
      updatedAt: new Date(),
    }).where(eq(customerOrders.id, orderId));
  }

  // ───────────────────────────────────────────────
  // FX Rates CRUD
  // ───────────────────────────────────────────────

  app.get("/api/factory/fx-rates", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { currencyCode } = req.query;
      const conditions: any[] = [eq(factoryFxRates.companyId, companyId)];
      if (currencyCode) conditions.push(eq(factoryFxRates.currencyCode, currencyCode as string));
      const results = await db.select().from(factoryFxRates).where(and(...conditions)).orderBy(desc(factoryFxRates.effectiveDate));
      res.json(results);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/fx-rates/latest/:currencyCode", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const [rate] = await db.select().from(factoryFxRates)
        .where(and(eq(factoryFxRates.companyId, companyId), eq(factoryFxRates.currencyCode, req.params.currencyCode)))
        .orderBy(desc(factoryFxRates.effectiveDate))
        .limit(1);
      res.json(rate || null);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/fx-rates", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const parsed = insertFactoryFxRateSchema.parse({ ...req.body, companyId });
      const [rate] = await db.insert(factoryFxRates).values(parsed).returning();
      res.json(rate);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/factory/fx-rates/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const [deleted] = await db.delete(factoryFxRates)
        .where(and(eq(factoryFxRates.id, parseInt(req.params.id)), eq(factoryFxRates.companyId, companyId)))
        .returning();
      if (!deleted) return res.status(404).json({ message: "Rate not found" });
      res.json(deleted);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // Factory Daybook
  // ───────────────────────────────────────────────

  app.get("/api/factory/daybook", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { startDate, endDate, txType, currencyCode } = req.query;
      const conditions: any[] = [eq(factoryDaybookEntries.companyId, companyId)];
      if (startDate) conditions.push(sql`${factoryDaybookEntries.txDate} >= ${startDate}`);
      if (endDate) conditions.push(sql`${factoryDaybookEntries.txDate} <= ${endDate}`);
      if (txType) conditions.push(eq(factoryDaybookEntries.txType, txType as string));
      if (currencyCode) conditions.push(eq(factoryDaybookEntries.currencyCode, currencyCode as string));
      const results = await db.select().from(factoryDaybookEntries).where(and(...conditions)).orderBy(desc(factoryDaybookEntries.txDate), desc(factoryDaybookEntries.id));
      res.json(results);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // CUSTOMER PROFORMAS CRUD
  // ───────────────────────────────────────────────

  app.get("/api/factory/customer-proformas", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const customerId = req.query.customerId ? parseInt(req.query.customerId) : null;
      if (!customerId) return res.status(400).json({ message: "customerId is required" });

      const proformas = await db
        .select()
        .from(customerProformas)
        .where(and(eq(customerProformas.companyId, companyId), eq(customerProformas.customerId, customerId)))
        .orderBy(desc(customerProformas.createdAt));

      const proformaIds = proformas.map((p: any) => p.id);
      let lines: any[] = [];
      if (proformaIds.length > 0) {
        lines = await db.select().from(customerProformaLines).where(inArray(customerProformaLines.proformaId, proformaIds));
      }

      const result = proformas.map((p: any) => ({
        ...p,
        lines: lines.filter((l: any) => l.proformaId === p.id),
      }));

      res.json(result);
    } catch (error: any) {
      console.error("Error fetching customer proformas:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-proformas", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const parsed = insertCustomerProformaSchema.parse({ ...req.body, companyId });

      if (parsed.isActive) {
        await db.update(customerProformas).set({ isActive: false, updatedAt: new Date() })
          .where(and(eq(customerProformas.companyId, companyId), eq(customerProformas.customerId, parsed.customerId)));
      }

      const [proforma] = await db.insert(customerProformas).values(parsed).returning();
      res.json(proforma);
    } catch (error: any) {
      console.error("Error creating customer proforma:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.put("/api/factory/customer-proformas/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [existing] = await db.select().from(customerProformas)
        .where(and(eq(customerProformas.id, id), eq(customerProformas.companyId, companyId)));
      if (!existing) return res.status(404).json({ message: "Proforma not found" });

      if (req.body.isActive === true) {
        await db.update(customerProformas).set({ isActive: false, updatedAt: new Date() })
          .where(and(eq(customerProformas.companyId, companyId), eq(customerProformas.customerId, existing.customerId)));
      }

      const [updated] = await db.update(customerProformas)
        .set({ ...req.body, updatedAt: new Date() })
        .where(and(eq(customerProformas.id, id), eq(customerProformas.companyId, companyId)))
        .returning();

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating customer proforma:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/factory/customer-proformas/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      await db.delete(customerProformaLines).where(eq(customerProformaLines.proformaId, id));
      const [deleted] = await db.delete(customerProformas)
        .where(and(eq(customerProformas.id, id), eq(customerProformas.companyId, companyId)))
        .returning();

      if (!deleted) return res.status(404).json({ message: "Proforma not found" });
      res.json({ message: "Proforma deleted" });
    } catch (error: any) {
      console.error("Error deleting customer proforma:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-proforma-lines", requireAuth, async (req: any, res: any) => {
    try {
      const parsed = insertCustomerProformaLineSchema.parse(req.body);

      const [existingLine] = await db.select().from(customerProformaLines)
        .where(and(eq(customerProformaLines.proformaId, parsed.proformaId), eq(customerProformaLines.articleCode, parsed.articleCode)));
      if (existingLine) return res.status(400).json({ message: "Article code already exists in this proforma" });

      const [line] = await db.insert(customerProformaLines).values(parsed).returning();
      res.json(line);
    } catch (error: any) {
      console.error("Error creating proforma line:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.put("/api/factory/customer-proforma-lines/:id", requireAuth, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id);
      const updateData: any = {};
      if (req.body.productName !== undefined) updateData.productName = req.body.productName;
      if (req.body.pricePerBale !== undefined) updateData.pricePerBale = req.body.pricePerBale;

      const [updated] = await db.update(customerProformaLines).set(updateData)
        .where(eq(customerProformaLines.id, id)).returning();

      if (!updated) return res.status(404).json({ message: "Proforma line not found" });
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating proforma line:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/factory/customer-proforma-lines/:id", requireAuth, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id);
      const [deleted] = await db.delete(customerProformaLines).where(eq(customerProformaLines.id, id)).returning();
      if (!deleted) return res.status(404).json({ message: "Proforma line not found" });
      res.json({ message: "Proforma line deleted" });
    } catch (error: any) {
      console.error("Error deleting proforma line:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // CUSTOMER ORDERS CRUD + FINALIZE
  // ───────────────────────────────────────────────

  app.get("/api/factory/customer-orders", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const conditions: any[] = [eq(customerOrders.companyId, companyId)];
      if (req.query.customerId) conditions.push(eq(customerOrders.customerId, parseInt(req.query.customerId)));
      if (req.query.status) conditions.push(eq(customerOrders.status, req.query.status));

      const orders = await db
        .select({
          id: customerOrders.id,
          companyId: customerOrders.companyId,
          customerId: customerOrders.customerId,
          invoiceNumber: customerOrders.invoiceNumber,
          orderDate: customerOrders.orderDate,
          proformaIdUsed: customerOrders.proformaIdUsed,
          status: customerOrders.status,
          subtotalBales: customerOrders.subtotalBales,
          freightAmount: customerOrders.freightAmount,
          otherChargesTotal: customerOrders.otherChargesTotal,
          grandTotal: customerOrders.grandTotal,
          totalQtyBales: customerOrders.totalQtyBales,
          createdAt: customerOrders.createdAt,
          updatedAt: customerOrders.updatedAt,
          customerName: customers.legalName,
        })
        .from(customerOrders)
        .leftJoin(customers, eq(customerOrders.customerId, customers.id))
        .where(and(...conditions))
        .orderBy(desc(customerOrders.createdAt));

      res.json(orders);
    } catch (error: any) {
      console.error("Error fetching customer orders:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/customer-orders/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [order] = await db
        .select({
          id: customerOrders.id,
          companyId: customerOrders.companyId,
          customerId: customerOrders.customerId,
          invoiceNumber: customerOrders.invoiceNumber,
          orderDate: customerOrders.orderDate,
          proformaIdUsed: customerOrders.proformaIdUsed,
          status: customerOrders.status,
          subtotalBales: customerOrders.subtotalBales,
          freightAmount: customerOrders.freightAmount,
          otherChargesTotal: customerOrders.otherChargesTotal,
          grandTotal: customerOrders.grandTotal,
          totalQtyBales: customerOrders.totalQtyBales,
          createdAt: customerOrders.createdAt,
          updatedAt: customerOrders.updatedAt,
          customerName: customers.legalName,
          customerCode: customers.code,
        })
        .from(customerOrders)
        .leftJoin(customers, eq(customerOrders.customerId, customers.id))
        .where(and(eq(customerOrders.id, id), eq(customerOrders.companyId, companyId)));

      if (!order) return res.status(404).json({ message: "Order not found" });

      const lines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, id));
      const bales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, id));
      const charges = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, id));

      res.json({ ...order, lines, bales, charges });
    } catch (error: any) {
      console.error("Error fetching customer order:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const parsed = insertCustomerOrderSchema.parse({ ...req.body, companyId, status: "DRAFT" });
      const [order] = await db.insert(customerOrders).values(parsed).returning();
      res.json(order);
    } catch (error: any) {
      console.error("Error creating customer order:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders/:id/bales", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      const { scanCode, locationId } = req.body;
      if (!scanCode || !locationId) return res.status(400).json({ message: "scanCode and locationId are required" });

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.status !== "DRAFT") return res.status(400).json({ message: "Can only add bales to DRAFT orders" });

      const [bale] = await db.select().from(factoryBales)
        .where(and(
          eq(factoryBales.companyId, companyId),
          eq(factoryBales.status, "FINALIZED"),
          eq(factoryBales.erpLocationId, parseInt(locationId)),
          or(
            eq(factoryBales.referenceNumber, scanCode),
            eq(factoryBales.baleCode, scanCode),
            eq(factoryBales.articleCode, scanCode)
          )
        ));

      if (!bale) return res.status(404).json({ message: "Bale not found, not at this location, or not available for sale" });

      const [alreadyAdded] = await db.select().from(customerOrderBales)
        .where(and(eq(customerOrderBales.orderId, orderId), eq(customerOrderBales.baleId, bale.id)));
      if (alreadyAdded) return res.status(400).json({ message: "Bale already added to this order" });

      let priceUsed = "0";
      if (order.proformaIdUsed) {
        const [proformaLine] = await db.select().from(customerProformaLines)
          .where(and(
            eq(customerProformaLines.proformaId, order.proformaIdUsed),
            eq(customerProformaLines.articleCode, bale.articleCode || "")
          ));
        if (proformaLine) {
          priceUsed = proformaLine.pricePerBale;
        }
      }

      if (priceUsed === "0" && bale.productId) {
        const [product] = await db.select().from(factoryBaleProducts)
          .where(eq(factoryBaleProducts.id, bale.productId));
        if (product && product.sellingPrice) {
          priceUsed = product.sellingPrice;
        }
      }

      await db.insert(customerOrderBales).values({
        orderId,
        baleId: bale.id,
        baleReference: bale.referenceNumber,
        locationId: parseInt(locationId),
        weight: bale.weightKg,
        articleCode: bale.articleCode,
        baleName: bale.productName || bale.articleCode || bale.baleCode,
        priceUsed,
      });

      await recalculateOrderTotals(db, orderId);

      const updatedBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));
      const updatedLines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));
      const updatedCharges = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));

      res.json({ ...updatedOrder, bales: updatedBales, lines: updatedLines, charges: updatedCharges });
    } catch (error: any) {
      console.error("Error adding bale to order:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/factory/customer-orders/:id/bales/:baleId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      const baleId = parseInt(req.params.baleId);

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.status !== "DRAFT") return res.status(400).json({ message: "Can only remove bales from DRAFT orders" });

      await db.delete(customerOrderBales)
        .where(and(eq(customerOrderBales.orderId, orderId), eq(customerOrderBales.id, baleId)));

      await recalculateOrderTotals(db, orderId);

      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));
      const updatedBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      const updatedLines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));
      const updatedCharges = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));

      res.json({ ...updatedOrder, bales: updatedBales, lines: updatedLines, charges: updatedCharges });
    } catch (error: any) {
      console.error("Error removing bale from order:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders/:id/charges", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      const { name, amount, chargeType } = req.body;
      if (!name || !amount) return res.status(400).json({ message: "name and amount are required" });

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      await db.insert(customerOrderCharges).values({
        orderId,
        name,
        amount: String(amount),
        chargeType: chargeType || "OTHER",
      });

      await recalculateOrderTotals(db, orderId);

      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));
      const updatedCharges = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));

      res.json({ ...updatedOrder, charges: updatedCharges });
    } catch (error: any) {
      console.error("Error adding charge to order:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/factory/customer-orders/:id/charges/:chargeId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      const chargeId = parseInt(req.params.chargeId);

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      await db.delete(customerOrderCharges)
        .where(and(eq(customerOrderCharges.orderId, orderId), eq(customerOrderCharges.id, chargeId)));

      await recalculateOrderTotals(db, orderId);

      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));
      const updatedCharges = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));

      res.json({ ...updatedOrder, charges: updatedCharges });
    } catch (error: any) {
      console.error("Error removing charge from order:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders/:id/finalize", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);

      const result = await db.transaction(async (tx: any) => {
        const [order] = await tx.select().from(customerOrders)
          .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
        if (!order) throw new Error("Order not found");
        if (order.status !== "DRAFT") throw new Error("Only DRAFT orders can be finalized");

        const bales = await tx.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
        if (bales.length === 0) throw new Error("Order has no bales");

        for (const b of bales) {
          const [factoryBale] = await tx.select().from(factoryBales)
            .where(and(eq(factoryBales.id, b.baleId), eq(factoryBales.status, "FINALIZED"), eq(factoryBales.erpLocationId, b.locationId)));
          if (!factoryBale) throw new Error(`Bale ${b.baleReference} is no longer available at the specified location`);
        }

        let seqRows = await tx.execute(sql`SELECT * FROM customer_invoice_sequences WHERE company_id = ${companyId} FOR UPDATE`);
        let seqRow = seqRows.rows?.[0] || seqRows[0];
        if (!seqRow) {
          [seqRow] = await tx.insert(customerInvoiceSequences).values({ companyId, nextNumber: 1 }).returning();
        }
        const invoiceNum = seqRow.nextNumber || seqRow.next_number;
        await tx.update(customerInvoiceSequences).set({ nextNumber: invoiceNum + 1 }).where(eq(customerInvoiceSequences.companyId, companyId));
        const invoiceNumber = `INV-${String(invoiceNum).padStart(6, '0')}`;

        for (const b of bales) {
          await tx.update(factoryBales).set({ status: "SOLD", updatedAt: new Date() }).where(eq(factoryBales.id, b.baleId));
        }

        await recalculateOrderTotals(tx, orderId);

        const [recalcOrder] = await tx.select().from(customerOrders).where(eq(customerOrders.id, orderId));

        await tx.update(customerOrders).set({
          invoiceNumber,
          status: "FINALIZED",
          updatedAt: new Date(),
        }).where(eq(customerOrders.id, orderId));

        const grandTotal = parseFloat(recalcOrder.grandTotal || "0");
        const today = new Date().toISOString().split('T')[0];

        await tx.insert(customerBalances).values({
          companyId,
          customerId: order.customerId,
          transactionDate: today,
          transactionType: "SALE",
          debitAmount: String(grandTotal),
          creditAmount: "0",
          balance: String(grandTotal),
          referenceType: "INVOICE",
          referenceId: order.id,
          description: `Invoice ${invoiceNumber}`,
          currency: "USD",
        });

        const [finalOrder] = await tx
          .select({
            id: customerOrders.id,
            companyId: customerOrders.companyId,
            customerId: customerOrders.customerId,
            invoiceNumber: customerOrders.invoiceNumber,
            orderDate: customerOrders.orderDate,
            proformaIdUsed: customerOrders.proformaIdUsed,
            status: customerOrders.status,
            subtotalBales: customerOrders.subtotalBales,
            freightAmount: customerOrders.freightAmount,
            otherChargesTotal: customerOrders.otherChargesTotal,
            grandTotal: customerOrders.grandTotal,
            totalQtyBales: customerOrders.totalQtyBales,
            createdAt: customerOrders.createdAt,
            updatedAt: customerOrders.updatedAt,
            customerName: customers.legalName,
          })
          .from(customerOrders)
          .leftJoin(customers, eq(customerOrders.customerId, customers.id))
          .where(eq(customerOrders.id, orderId));

        const finalLines = await tx.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));
        const finalBales = await tx.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
        const finalCharges = await tx.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));

        return { ...finalOrder, lines: finalLines, bales: finalBales, charges: finalCharges };
      });

      const today = new Date().toISOString().split('T')[0];
      await writeDaybookEntry(db, {
        companyId,
        txDate: today,
        txType: "INVOICE",
        referenceId: result.orderId || orderId,
        description: `Invoice ${result.invoiceNumber} for customer`,
        amountCurrency: parseFloat(result.grandTotal || "0"),
        amountUsd: parseFloat(result.grandTotal || "0"),
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error finalizing order:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders/:id/cancel", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.status !== "DRAFT") return res.status(400).json({ message: "Only DRAFT orders can be cancelled" });

      const [updated] = await db.update(customerOrders)
        .set({ status: "CANCELLED", updatedAt: new Date() })
        .where(eq(customerOrders.id, orderId))
        .returning();

      res.json(updated);
    } catch (error: any) {
      console.error("Error cancelling order:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // BALE SCAN LOOKUP
  // ───────────────────────────────────────────────

  app.get("/api/factory/bale-lookup", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const code = req.query.code as string;
      const locationId = req.query.locationId ? parseInt(req.query.locationId as string) : null;
      if (!code) return res.status(400).json({ message: "code is required" });

      const conditions: any[] = [
        eq(factoryBales.companyId, companyId),
        eq(factoryBales.status, "FINALIZED"),
        or(
          eq(factoryBales.referenceNumber, code),
          eq(factoryBales.baleCode, code),
          eq(factoryBales.articleCode, code)
        ),
      ];

      if (locationId) {
        conditions.push(eq(factoryBales.erpLocationId, locationId));
      }

      const results = await db.select().from(factoryBales).where(and(...conditions));

      if (results.length === 0) return res.status(404).json({ message: "No available bale found with that code at this location" });

      res.json(results);
    } catch (error: any) {
      console.error("Error looking up bale:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // INVOICE EXPORT (Excel/CSV)
  // ───────────────────────────────────────────────

  app.get("/api/factory/customer-orders/:id/export-excel", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
      const [order] = await db
        .select({
          id: customerOrders.id,
          invoiceNumber: customerOrders.invoiceNumber,
          orderDate: customerOrders.orderDate,
          status: customerOrders.status,
          subtotalBales: customerOrders.subtotalBales,
          freightAmount: customerOrders.freightAmount,
          otherChargesTotal: customerOrders.otherChargesTotal,
          grandTotal: customerOrders.grandTotal,
          totalQtyBales: customerOrders.totalQtyBales,
          customerName: customers.legalName,
          customerCode: customers.code,
        })
        .from(customerOrders)
        .leftJoin(customers, eq(customerOrders.customerId, customers.id))
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));

      if (!order) return res.status(404).json({ message: "Order not found" });

      const lines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));
      const charges = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));

      const sortedLines = lines.sort((a: any, b: any) => (a.baleName || "").localeCompare(b.baleName || ""));

      let csv = `Company: ${company?.name || ""}\n`;
      csv += `Invoice: ${order.invoiceNumber || "DRAFT"}\n`;
      csv += `Customer: ${order.customerName} (${order.customerCode})\n`;
      csv += `Date: ${order.orderDate}\n\n`;
      csv += `#,Article Code,Product Name,Qty,Weight/Bale,Total Weight,Price/Bale,Total Price\n`;

      sortedLines.forEach((line: any, idx: number) => {
        csv += `${idx + 1},${line.articleCode},${(line.baleName || "").replace(/,/g, " ")},${line.qty},${line.weightPerBale},${line.totalWeight},${line.pricePerBale},${line.totalPrice}\n`;
      });

      csv += `\nCharges\n`;
      csv += `Name,Type,Amount\n`;
      for (const charge of charges) {
        csv += `${(charge.name || "").replace(/,/g, " ")},${charge.chargeType},${charge.amount}\n`;
      }

      csv += `\nSummary\n`;
      csv += `Subtotal Bales,${order.subtotalBales}\n`;
      csv += `Freight,${order.freightAmount}\n`;
      csv += `Other Charges,${order.otherChargesTotal}\n`;
      csv += `Grand Total,${order.grandTotal}\n`;
      csv += `Total Qty Bales,${order.totalQtyBales}\n`;

      const filename = `invoice_${order.invoiceNumber || orderId}.csv`;
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (error: any) {
      console.error("Error exporting order to CSV:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // INVOICE EXPORT (PDF as HTML)
  // ───────────────────────────────────────────────

  app.get("/api/factory/customer-orders/:id/export-pdf", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
      const [order] = await db
        .select({
          id: customerOrders.id,
          invoiceNumber: customerOrders.invoiceNumber,
          orderDate: customerOrders.orderDate,
          status: customerOrders.status,
          subtotalBales: customerOrders.subtotalBales,
          freightAmount: customerOrders.freightAmount,
          otherChargesTotal: customerOrders.otherChargesTotal,
          grandTotal: customerOrders.grandTotal,
          totalQtyBales: customerOrders.totalQtyBales,
          customerName: customers.legalName,
          customerCode: customers.code,
        })
        .from(customerOrders)
        .leftJoin(customers, eq(customerOrders.customerId, customers.id))
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));

      if (!order) return res.status(404).json({ message: "Order not found" });

      const lines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));
      const charges = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));

      const sortedLines = lines.sort((a: any, b: any) => (a.baleName || "").localeCompare(b.baleName || ""));

      let linesHtml = "";
      sortedLines.forEach((line: any, idx: number) => {
        linesHtml += `<tr><td>${idx + 1}</td><td>${line.articleCode}</td><td>${line.baleName || ""}</td><td style="text-align:right">${line.qty}</td><td style="text-align:right">${line.weightPerBale}</td><td style="text-align:right">${line.totalWeight}</td><td style="text-align:right">${line.pricePerBale}</td><td style="text-align:right">${line.totalPrice}</td></tr>`;
      });

      let chargesHtml = "";
      for (const charge of charges) {
        chargesHtml += `<tr><td>${charge.name}</td><td>${charge.chargeType}</td><td style="text-align:right">${charge.amount}</td></tr>`;
      }

      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Invoice ${order.invoiceNumber || "DRAFT"}</title>
<style>
body { font-family: Arial, sans-serif; margin: 40px; color: #333; }
h1 { margin-bottom: 5px; }
.header-info { margin-bottom: 20px; }
.header-info p { margin: 2px 0; }
table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
th, td { border: 1px solid #ddd; padding: 8px; font-size: 13px; }
th { background-color: #f5f5f5; text-align: left; }
.totals-table { width: 300px; margin-left: auto; }
.totals-table td:last-child { text-align: right; font-weight: bold; }
.grand-total { font-size: 16px; font-weight: bold; background: #f0f0f0; }
@media print { body { margin: 20px; } }
</style></head><body>
<h1>${company?.name || ""}</h1>
<div class="header-info">
<p><strong>Invoice:</strong> ${order.invoiceNumber || "DRAFT"}</p>
<p><strong>Customer:</strong> ${order.customerName} (${order.customerCode})</p>
<p><strong>Date:</strong> ${order.orderDate}</p>
</div>
<h3>Order Lines</h3>
<table>
<thead><tr><th>#</th><th>Article Code</th><th>Product</th><th style="text-align:right">Qty</th><th style="text-align:right">Weight/Bale</th><th style="text-align:right">Total Weight</th><th style="text-align:right">Price/Bale</th><th style="text-align:right">Total Price</th></tr></thead>
<tbody>${linesHtml}</tbody>
</table>
${charges.length > 0 ? `<h3>Charges</h3><table><thead><tr><th>Name</th><th>Type</th><th style="text-align:right">Amount</th></tr></thead><tbody>${chargesHtml}</tbody></table>` : ""}
<table class="totals-table">
<tr><td>Subtotal Bales</td><td>${order.subtotalBales}</td></tr>
<tr><td>Freight</td><td>${order.freightAmount}</td></tr>
<tr><td>Other Charges</td><td>${order.otherChargesTotal}</td></tr>
<tr class="grand-total"><td>Grand Total</td><td>${order.grandTotal}</td></tr>
<tr><td>Total Qty Bales</td><td>${order.totalQtyBales}</td></tr>
</table>
</body></html>`;

      res.setHeader("Content-Type", "text/html");
      res.send(html);
    } catch (error: any) {
      console.error("Error exporting order to PDF:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ─────── CONTAINER DOCUMENT TYPES ───────

  app.get("/api/factory/container-doc-types", requireAuth, async (req: any, res: any) => {
    try {
      const rows = await db.select().from(containerDocumentTypes).orderBy(containerDocumentTypes.label);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/container-doc-types", requireAuth, async (req: any, res: any) => {
    try {
      const [row] = await db.insert(containerDocumentTypes).values(req.body).returning();
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─────── CONTAINER DOCUMENTS (upload / list / delete) ───────

  app.get("/api/factory/containers/:containerId/documents", requireAuth, async (req: any, res: any) => {
    try {
      const containerId = Number(req.params.containerId);
      const docs = await db.select().from(containerDocuments).where(eq(containerDocuments.containerId, containerId));
      const docTypes = await db.select().from(containerDocumentTypes).orderBy(containerDocumentTypes.label);
      const requiredTypes = docTypes.filter((dt: any) => dt.isRequired);
      const uploadedTypeIds = new Set(docs.map((d: any) => d.docTypeId));
      const completeness = {
        total: requiredTypes.length,
        uploaded: requiredTypes.filter((rt: any) => uploadedTypeIds.has(rt.id)).length,
        complete: requiredTypes.every((rt: any) => uploadedTypeIds.has(rt.id)),
      };
      res.json({ documents: docs, docTypes, completeness });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/containers/:containerId/documents", requireAuth, async (req: any, res: any) => {
    try {
      const multer = (await import("multer")).default;
      const path = await import("path");
      const fs = await import("fs");
      const uploadDir = path.default.join(process.cwd(), "uploads", "container-docs");
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      const storage = multer.diskStorage({
        destination: (_req: any, _file: any, cb: any) => cb(null, uploadDir),
        filename: (_req: any, file: any, cb: any) => {
          const ext = path.default.extname(file.originalname);
          cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
        },
      });
      const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

      upload.single("file")(req, res, async (err: any) => {
        try {
          if (err) return res.status(400).json({ message: err.message });
          if (!req.file) return res.status(400).json({ message: "No file uploaded" });

          const containerId = Number(req.params.containerId);
          const companyId = (req.session as any).currentCompanyId;
          const docTypeId = Number(req.body.docTypeId);
          if (!companyId || !docTypeId) return res.status(400).json({ message: "Missing companyId or docTypeId" });

          const storageKey = `container-docs/${req.file.filename}`;
          const [doc] = await db.insert(containerDocuments).values({
            companyId,
            containerId,
            docTypeId,
            fileName: req.file.originalname,
            storageKey,
            mimeType: req.file.mimetype,
            uploadedBy: (req.session as any).userId ? Number((req.session as any).userId) : null,
          }).returning();

          const docType = await db.select().from(containerDocumentTypes).where(eq(containerDocumentTypes.id, docTypeId));
          const docTypeName = docType[0]?.label || "Document";

          await writeDaybookEntry(db, {
            companyId,
            txDate: new Date().toISOString().split("T")[0],
            txType: "DOC_UPLOAD",
            referenceId: containerId,
            referenceTable: "containers",
            description: `Uploaded ${docTypeName}: ${req.file.originalname} for container #${containerId}`,
            metaJson: JSON.stringify({ docId: doc.id, docTypeId, fileName: req.file.originalname }),
            createdBy: (req.session as any).userId ? Number((req.session as any).userId) : undefined,
          });

          const allDocs = await db.select().from(containerDocuments).where(eq(containerDocuments.containerId, containerId));
          const allDocTypes = await db.select().from(containerDocumentTypes);
          const requiredTypes = allDocTypes.filter((dt: any) => dt.isRequired);
          const uploadedTypeIds = new Set(allDocs.map((d: any) => d.docTypeId));
          const allComplete = requiredTypes.every((rt: any) => uploadedTypeIds.has(rt.id));
          await db.update(containers).set({ docReceived: allComplete }).where(eq(containers.id, containerId));

          res.json(doc);
        } catch (innerErr: any) {
          console.error("Error uploading container document:", innerErr);
          res.status(500).json({ message: innerErr.message });
        }
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/factory/containers/:containerId/documents/:docId", requireAuth, async (req: any, res: any) => {
    try {
      const containerId = Number(req.params.containerId);
      const docId = Number(req.params.docId);
      const companyId = (req.session as any).currentCompanyId;

      const [deleted] = await db.delete(containerDocuments)
        .where(and(eq(containerDocuments.id, docId), eq(containerDocuments.containerId, containerId)))
        .returning();
      if (!deleted) return res.status(404).json({ message: "Document not found" });

      const fs = await import("fs");
      const path = await import("path");
      const filePath = path.default.join(process.cwd(), "uploads", deleted.storageKey);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      await writeDaybookEntry(db, {
        companyId: companyId || deleted.companyId,
        txDate: new Date().toISOString().split("T")[0],
        txType: "DOC_DELETE",
        referenceId: containerId,
        referenceTable: "containers",
        description: `Deleted document: ${deleted.fileName} from container #${containerId}`,
        metaJson: JSON.stringify({ docId: deleted.id, fileName: deleted.fileName }),
        createdBy: (req.session as any).userId ? Number((req.session as any).userId) : undefined,
      });

      const allDocs = await db.select().from(containerDocuments).where(eq(containerDocuments.containerId, containerId));
      const allDocTypes = await db.select().from(containerDocumentTypes);
      const requiredTypes = allDocTypes.filter((dt: any) => dt.isRequired);
      const uploadedTypeIds = new Set(allDocs.map((d: any) => d.docTypeId));
      const allComplete = requiredTypes.length > 0 && requiredTypes.every((rt: any) => uploadedTypeIds.has(rt.id));
      await db.update(containers).set({ docReceived: allComplete }).where(eq(containers.id, containerId));

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/uploads/:folder/:filename", async (req: any, res: any) => {
    try {
      const path = await import("path");
      const fs = await import("fs");
      const filePath = path.default.join(process.cwd(), "uploads", req.params.folder, req.params.filename);
      if (!fs.existsSync(filePath)) return res.status(404).json({ message: "File not found" });
      res.sendFile(filePath);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─────── CONTAINER FREIGHT ───────

  app.get("/api/factory/containers/:containerId/freight", requireAuth, async (req: any, res: any) => {
    try {
      const containerId = Number(req.params.containerId);
      const freightRows = await db.select().from(containerFreight).where(eq(containerFreight.containerId, containerId));
      const freightWithPayments = await Promise.all(freightRows.map(async (fr: any) => {
        const payments = await db.select().from(containerFreightPayments)
          .where(eq(containerFreightPayments.containerFreightId, fr.id));
        const totalPaid = payments.reduce((sum: number, p: any) => sum + Number(p.amount), 0);
        const freightAmount = Number(fr.freightAmount);
        const computedStatus = totalPaid >= freightAmount ? "PAID" : totalPaid > 0 ? "PARTIAL" : "UNPAID";
        return { ...fr, payments, totalPaid, computedStatus };
      }));
      res.json(freightWithPayments);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/containers/:containerId/freight", requireAuth, async (req: any, res: any) => {
    try {
      const containerId = Number(req.params.containerId);
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const [row] = await db.insert(containerFreight).values({
        companyId,
        containerId,
        vendorName: req.body.vendorName || null,
        vendorSupplierId: req.body.vendorSupplierId || null,
        freightAmount: String(req.body.freightAmount || 0),
        currency: req.body.currency || "USD",
        dueDate: req.body.dueDate || null,
        status: "UNPAID",
        notes: req.body.notes || null,
      }).returning();

      await writeDaybookEntry(db, {
        companyId,
        txDate: new Date().toISOString().split("T")[0],
        txType: "FREIGHT_ADD",
        referenceId: containerId,
        referenceTable: "containers",
        description: `Added freight charge ${row.currency} ${row.freightAmount} for container #${containerId}${row.vendorName ? ` (${row.vendorName})` : ""}`,
        currencyCode: row.currency,
        amountCurrency: Number(row.freightAmount),
        metaJson: JSON.stringify({ freightId: row.id, vendorName: row.vendorName }),
        createdBy: (req.session as any).userId ? Number((req.session as any).userId) : undefined,
      });

      res.json(row);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/factory/containers/:containerId/freight/:freightId", requireAuth, async (req: any, res: any) => {
    try {
      const freightId = Number(req.params.freightId);
      const containerId = Number(req.params.containerId);
      const companyId = (req.session as any).currentCompanyId;

      await db.delete(containerFreightPayments).where(eq(containerFreightPayments.containerFreightId, freightId));
      const [deleted] = await db.delete(containerFreight)
        .where(and(eq(containerFreight.id, freightId), eq(containerFreight.containerId, containerId)))
        .returning();
      if (!deleted) return res.status(404).json({ message: "Freight not found" });

      await writeDaybookEntry(db, {
        companyId: companyId || deleted.companyId,
        txDate: new Date().toISOString().split("T")[0],
        txType: "FREIGHT_DELETE",
        referenceId: containerId,
        referenceTable: "containers",
        description: `Deleted freight charge ${deleted.currency} ${deleted.freightAmount} from container #${containerId}`,
        currencyCode: deleted.currency,
        amountCurrency: Number(deleted.freightAmount),
        createdBy: (req.session as any).userId ? Number((req.session as any).userId) : undefined,
      });

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─────── FREIGHT PAYMENTS ───────

  app.post("/api/factory/freight/:freightId/payments", requireAuth, async (req: any, res: any) => {
    try {
      const freightId = Number(req.params.freightId);
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const [payment] = await db.insert(containerFreightPayments).values({
        companyId,
        containerFreightId: freightId,
        paymentDate: req.body.paymentDate,
        amount: String(req.body.amount),
        method: req.body.method || null,
        reference: req.body.reference || null,
        createdBy: (req.session as any).userId ? Number((req.session as any).userId) : null,
      }).returning();

      const [fr] = await db.select().from(containerFreight).where(eq(containerFreight.id, freightId));
      const payments = await db.select().from(containerFreightPayments).where(eq(containerFreightPayments.containerFreightId, freightId));
      const totalPaid = payments.reduce((sum: number, p: any) => sum + Number(p.amount), 0);
      const freightAmount = Number(fr.freightAmount);
      const newStatus = totalPaid >= freightAmount ? "PAID" : totalPaid > 0 ? "PARTIAL" : "UNPAID";
      await db.update(containerFreight).set({ status: newStatus, updatedAt: new Date() }).where(eq(containerFreight.id, freightId));

      await writeDaybookEntry(db, {
        companyId,
        txDate: req.body.paymentDate || new Date().toISOString().split("T")[0],
        txType: "FREIGHT_PAYMENT",
        referenceId: fr.containerId,
        referenceTable: "containers",
        description: `Freight payment ${fr.currency} ${req.body.amount} for container #${fr.containerId}${fr.vendorName ? ` (${fr.vendorName})` : ""}`,
        currencyCode: fr.currency,
        amountCurrency: Number(req.body.amount),
        metaJson: JSON.stringify({ freightId, paymentId: payment.id }),
        createdBy: (req.session as any).userId ? Number((req.session as any).userId) : undefined,
      });

      res.json(payment);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/factory/freight/:freightId/payments/:paymentId", requireAuth, async (req: any, res: any) => {
    try {
      const freightId = Number(req.params.freightId);
      const paymentId = Number(req.params.paymentId);
      const companyId = (req.session as any).currentCompanyId;

      const [deleted] = await db.delete(containerFreightPayments)
        .where(and(eq(containerFreightPayments.id, paymentId), eq(containerFreightPayments.containerFreightId, freightId)))
        .returning();
      if (!deleted) return res.status(404).json({ message: "Payment not found" });

      const [fr] = await db.select().from(containerFreight).where(eq(containerFreight.id, freightId));
      if (fr) {
        const payments = await db.select().from(containerFreightPayments).where(eq(containerFreightPayments.containerFreightId, freightId));
        const totalPaid = payments.reduce((sum: number, p: any) => sum + Number(p.amount), 0);
        const freightAmount = Number(fr.freightAmount);
        const newStatus = totalPaid >= freightAmount ? "PAID" : totalPaid > 0 ? "PARTIAL" : "UNPAID";
        await db.update(containerFreight).set({ status: newStatus, updatedAt: new Date() }).where(eq(containerFreight.id, freightId));
      }

      await writeDaybookEntry(db, {
        companyId: companyId || deleted.companyId,
        txDate: new Date().toISOString().split("T")[0],
        txType: "FREIGHT_PAYMENT_DELETE",
        referenceId: fr?.containerId,
        referenceTable: "containers",
        description: `Deleted freight payment of ${deleted.amount} for freight #${freightId}`,
        amountCurrency: Number(deleted.amount),
        createdBy: (req.session as any).userId ? Number((req.session as any).userId) : undefined,
      });

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─────── BATCH OTW FREIGHT STATUS ───────

  app.get("/api/factory/containers/freight-status", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.json({});
      const allFreight = await db.select().from(containerFreight).where(eq(containerFreight.companyId, companyId));
      const freightIds = allFreight.map((f: any) => f.id);
      let allPayments: any[] = [];
      if (freightIds.length > 0) {
        allPayments = await db.select().from(containerFreightPayments).where(inArray(containerFreightPayments.containerFreightId, freightIds));
      }
      const paymentsByFreight = new Map<number, number>();
      for (const p of allPayments) {
        paymentsByFreight.set(p.containerFreightId, (paymentsByFreight.get(p.containerFreightId) || 0) + Number(p.amount));
      }

      const statusByContainer: Record<number, { totalFreight: number; totalPaid: number; status: string }> = {};
      for (const fr of allFreight) {
        const cid = fr.containerId;
        if (!statusByContainer[cid]) statusByContainer[cid] = { totalFreight: 0, totalPaid: 0, status: "NONE" };
        statusByContainer[cid].totalFreight += Number(fr.freightAmount);
        statusByContainer[cid].totalPaid += paymentsByFreight.get(fr.id) || 0;
      }
      for (const cid of Object.keys(statusByContainer)) {
        const s = statusByContainer[Number(cid)];
        s.status = s.totalFreight === 0 ? "NONE" : s.totalPaid >= s.totalFreight ? "PAID" : s.totalPaid > 0 ? "PARTIAL" : "UNPAID";
      }
      res.json(statusByContainer);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─────── DAYBOOK ENTRY EDIT ───────

  app.put("/api/factory/daybook/:entryId", requireAuth, async (req: any, res: any) => {
    try {
      const entryId = Number(req.params.entryId);
      const session = req.session as any;
      const userId = session.userId ? Number(session.userId) : null;
      const { reason, description, amountCurrency, amountUsd, currencyCode, fxRateToUsd, txDate } = req.body;

      if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
        return res.status(400).json({ message: "Edit reason is required" });
      }

      const canEdit = session.role === "admin" || session.daybookEditDays > 0;
      if (!canEdit) return res.status(403).json({ message: "You do not have permission to edit daybook entries" });

      const [existing] = await db.select().from(factoryDaybookEntries).where(eq(factoryDaybookEntries.id, entryId));
      if (!existing) return res.status(404).json({ message: "Daybook entry not found" });

      if (session.role !== "admin" && session.daybookEditDays) {
        const entryDate = new Date(existing.txDate);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - session.daybookEditDays);
        if (entryDate < cutoff) {
          return res.status(403).json({ message: `Entry is older than ${session.daybookEditDays} days and cannot be edited` });
        }
      }

      const beforeJson = JSON.stringify(existing);

      const updates: any = {};
      if (description !== undefined) updates.description = description;
      if (amountCurrency !== undefined) updates.amountCurrency = String(amountCurrency);
      if (amountUsd !== undefined) updates.amountUsd = String(amountUsd);
      if (currencyCode !== undefined) updates.currencyCode = currencyCode;
      if (fxRateToUsd !== undefined) updates.fxRateToUsd = String(fxRateToUsd);
      if (txDate !== undefined) updates.txDate = txDate;

      const [updated] = await db.update(factoryDaybookEntries).set(updates).where(eq(factoryDaybookEntries.id, entryId)).returning();
      const afterJson = JSON.stringify(updated);

      await db.insert(factoryDaybookEntryEdits).values({
        daybookEntryId: entryId,
        editedBy: userId,
        beforeJson,
        afterJson,
        reason: reason.trim(),
      });

      res.json(updated);
    } catch (error: any) {
      console.error("Error editing daybook entry:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/daybook/:entryId/edits", requireAuth, async (req: any, res: any) => {
    try {
      const entryId = Number(req.params.entryId);
      const edits = await db.select().from(factoryDaybookEntryEdits)
        .where(eq(factoryDaybookEntryEdits.daybookEntryId, entryId))
        .orderBy(desc(factoryDaybookEntryEdits.editedAt));
      res.json(edits);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}
