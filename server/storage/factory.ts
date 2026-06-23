import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { db } from "../db";
import * as schema from "@shared/schema";

// Bales

export async function getAllBales(companyId: number): Promise<schema.Bale[]> {
  return await db
    .select()
    .from(schema.bales)
    .where(eq(schema.bales.companyId, companyId))
    .orderBy(desc(schema.bales.createdAt));
}

export async function getBaleById(id: number): Promise<schema.Bale | undefined> {
  const [bale] = await db.select().from(schema.bales).where(eq(schema.bales.id, id));
  return bale;
}

export async function getBaleByBarcode(barcode: string, companyId: number): Promise<schema.Bale | undefined> {
  const [bale] = await db
    .select()
    .from(schema.bales)
    .where(and(eq(schema.bales.barcode, barcode), eq(schema.bales.companyId, companyId)));
  return bale;
}

export async function createBale(bale: schema.InsertBale): Promise<schema.Bale> {
  const [created] = await db.insert(schema.bales).values(bale).returning();
  return created;
}

export async function updateBale(id: number, updates: Partial<schema.InsertBale>): Promise<schema.Bale> {
  const [updated] = await db
    .update(schema.bales)
    .set({ ...updates })
    .where(eq(schema.bales.id, id))
    .returning();
  return updated;
}

export async function deleteBale(id: number): Promise<void> {
  await db.delete(schema.bales).where(eq(schema.bales.id, id));
}

export async function bulkCreateBales(bales: schema.InsertBale[]): Promise<schema.Bale[]> {
  if (bales.length === 0) return [];
  return await db.insert(schema.bales).values(bales).returning();
}

// Pending Barcodes

export async function getAllPendingBarcodes(companyId: number): Promise<schema.PendingBarcode[]> {
  return await db
    .select()
    .from(schema.pendingBarcodes)
    .where(eq(schema.pendingBarcodes.companyId, companyId))
    .orderBy(desc(schema.pendingBarcodes.createdAt));
}

export async function getPendingBarcodeByCode(
  barcode: string,
  companyId: number
): Promise<schema.PendingBarcode | undefined> {
  const results = await db
    .select()
    .from(schema.pendingBarcodes)
    .where(and(eq(schema.pendingBarcodes.barcode, barcode), eq(schema.pendingBarcodes.companyId, companyId)));
  return results[0];
}

export async function createPendingBarcode(data: schema.InsertPendingBarcode): Promise<schema.PendingBarcode> {
  const [result] = await db.insert(schema.pendingBarcodes).values(data).returning();
  return result;
}

export async function updatePendingBarcode(
  id: number,
  updates: Partial<schema.InsertPendingBarcode>
): Promise<schema.PendingBarcode> {
  const [result] = await db
    .update(schema.pendingBarcodes)
    .set(updates)
    .where(eq(schema.pendingBarcodes.id, id))
    .returning();
  return result;
}

export async function deletePendingBarcode(id: number): Promise<void> {
  await db.delete(schema.pendingBarcodes).where(eq(schema.pendingBarcodes.id, id));
}

export async function bulkCreatePendingBarcodes(
  barcodes: schema.InsertPendingBarcode[]
): Promise<schema.PendingBarcode[]> {
  if (barcodes.length === 0) return [];
  return await db.insert(schema.pendingBarcodes).values(barcodes).returning();
}

export async function markBarcodesAsPrinted(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await db.update(schema.pendingBarcodes).set({ printed: true }).where(inArray(schema.pendingBarcodes.id, ids));
}

// Bale Product Categories

export async function getAllBaleProductCategories(companyId: number): Promise<schema.BaleProductCategory[]> {
  return await db
    .select()
    .from(schema.baleProductCategories)
    .where(eq(schema.baleProductCategories.companyId, companyId))
    .orderBy(schema.baleProductCategories.name);
}

export async function getBaleProductCategoryById(id: number): Promise<schema.BaleProductCategory | undefined> {
  const [cat] = await db.select().from(schema.baleProductCategories).where(eq(schema.baleProductCategories.id, id));
  return cat;
}

export async function getBaleProductCategoryByName(
  name: string,
  companyId: number
): Promise<schema.BaleProductCategory | undefined> {
  const [cat] = await db
    .select()
    .from(schema.baleProductCategories)
    .where(and(eq(schema.baleProductCategories.name, name), eq(schema.baleProductCategories.companyId, companyId)));
  return cat;
}

export async function createBaleProductCategory(
  category: schema.InsertBaleProductCategory
): Promise<schema.BaleProductCategory> {
  const [created] = await db.insert(schema.baleProductCategories).values(category).returning();
  return created;
}

export async function updateBaleProductCategory(
  id: number,
  updates: Partial<schema.InsertBaleProductCategory>
): Promise<schema.BaleProductCategory> {
  const [updated] = await db
    .update(schema.baleProductCategories)
    .set({ ...updates, updatedAt: sql`now()` })
    .where(eq(schema.baleProductCategories.id, id))
    .returning();
  return updated;
}

export async function deleteBaleProductCategory(id: number): Promise<void> {
  await db.delete(schema.baleProductCategories).where(eq(schema.baleProductCategories.id, id));
}

// Bale Products

export async function getAllBaleProducts(companyId: number): Promise<schema.BaleProduct[]> {
  return await db
    .select()
    .from(schema.baleProducts)
    .where(eq(schema.baleProducts.companyId, companyId))
    .orderBy(schema.baleProducts.code);
}

export async function getBaleProductById(id: number): Promise<schema.BaleProduct | undefined> {
  const [product] = await db.select().from(schema.baleProducts).where(eq(schema.baleProducts.id, id));
  return product;
}

export async function getBaleProductByCode(code: string, companyId: number): Promise<schema.BaleProduct | undefined> {
  const [product] = await db
    .select()
    .from(schema.baleProducts)
    .where(and(eq(schema.baleProducts.code, code), eq(schema.baleProducts.companyId, companyId)));
  return product;
}

export async function createBaleProduct(product: schema.InsertBaleProduct): Promise<schema.BaleProduct> {
  const valuesWithCode = {
    ...product,
    code: product.code || product.articleCode || `AUTO-${Date.now()}`,
  };
  const [created] = await db.insert(schema.baleProducts).values(valuesWithCode).returning();
  return created;
}

export async function updateBaleProduct(
  id: number,
  updates: Partial<schema.InsertBaleProduct>
): Promise<schema.BaleProduct> {
  const [updated] = await db
    .update(schema.baleProducts)
    .set({ ...updates, updatedAt: sql`now()` })
    .where(eq(schema.baleProducts.id, id))
    .returning();
  return updated;
}

export async function deleteBaleProduct(id: number): Promise<void> {
  await db.delete(schema.baleProducts).where(eq(schema.baleProducts.id, id));
}

export async function bulkCreateBaleProducts(products: schema.InsertBaleProduct[]): Promise<schema.BaleProduct[]> {
  if (products.length === 0) return [];

  const companyIds = new Set(products.map((p) => p.companyId));
  if (companyIds.size > 1) {
    throw new Error("All products must belong to the same company");
  }

  const withCodes = products.map((p) => ({
    ...p,
    code: p.code || p.articleCode || `AUTO-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  }));

  const codes = withCodes.map((p) => p.code);
  const duplicates = codes.filter((code, index) => codes.indexOf(code) !== index);
  if (duplicates.length > 0) {
    throw new Error(`Duplicate product codes in import: ${duplicates.join(", ")}`);
  }

  return await db.insert(schema.baleProducts).values(withCodes).returning();
}

// Bale Label Prints

export async function createBaleLabelPrint(data: schema.InsertBaleLabelPrint): Promise<schema.BaleLabelPrint> {
  const [created] = await db.insert(schema.baleLabelPrints).values(data).returning();
  return created;
}

export async function getBaleLabelPrintByReference(
  referenceNumber: string,
  companyId: number
): Promise<schema.BaleLabelPrint | undefined> {
  const [record] = await db
    .select()
    .from(schema.baleLabelPrints)
    .where(
      and(eq(schema.baleLabelPrints.referenceNumber, referenceNumber), eq(schema.baleLabelPrints.companyId, companyId))
    );
  return record;
}

export async function getBaleLabelPrintsByArticle(
  articleCode: string,
  companyId: number
): Promise<schema.BaleLabelPrint[]> {
  return await db
    .select()
    .from(schema.baleLabelPrints)
    .where(and(eq(schema.baleLabelPrints.articleCode, articleCode), eq(schema.baleLabelPrints.companyId, companyId)))
    .orderBy(desc(schema.baleLabelPrints.printedAt));
}

export async function getBaleProductByArticleCode(
  articleCode: string,
  companyId: number
): Promise<schema.BaleProduct | undefined> {
  const [product] = await db
    .select()
    .from(schema.baleProducts)
    .where(and(eq(schema.baleProducts.articleCode, articleCode), eq(schema.baleProducts.companyId, companyId)));
  return product;
}

// Bale Transfers

export async function getAllBaleTransfers(companyId: number): Promise<schema.BaleTransfer[]> {
  return await db
    .select()
    .from(schema.baleTransfers)
    .where(eq(schema.baleTransfers.companyId, companyId))
    .orderBy(desc(schema.baleTransfers.createdAt));
}

export async function getBaleTransferById(id: number): Promise<schema.BaleTransfer | undefined> {
  const [transfer] = await db.select().from(schema.baleTransfers).where(eq(schema.baleTransfers.id, id));
  return transfer;
}

export async function createBaleTransfer(transfer: schema.InsertBaleTransfer): Promise<schema.BaleTransfer> {
  const [created] = await db.insert(schema.baleTransfers).values(transfer).returning();
  return created;
}

export async function updateBaleTransfer(
  id: number,
  updates: Partial<schema.InsertBaleTransfer>
): Promise<schema.BaleTransfer> {
  const [updated] = await db
    .update(schema.baleTransfers)
    .set({ ...updates, updatedAt: sql`now()` })
    .where(eq(schema.baleTransfers.id, id))
    .returning();
  return updated;
}

export async function deleteBaleTransfer(id: number): Promise<void> {
  await db.delete(schema.baleTransfers).where(eq(schema.baleTransfers.id, id));
}

export async function getBaleTransferItems(transferId: number): Promise<schema.BaleTransferItem[]> {
  return await db.select().from(schema.baleTransferItems).where(eq(schema.baleTransferItems.transferId, transferId));
}

export async function createBaleTransferItem(item: schema.InsertBaleTransferItem): Promise<schema.BaleTransferItem> {
  const [created] = await db.insert(schema.baleTransferItems).values(item).returning();
  return created;
}

export async function updateBaleTransferItem(
  id: number,
  updates: Partial<schema.InsertBaleTransferItem>
): Promise<schema.BaleTransferItem> {
  const [updated] = await db
    .update(schema.baleTransferItems)
    .set(updates)
    .where(eq(schema.baleTransferItems.id, id))
    .returning();
  return updated;
}

export async function deleteBaleTransferItem(id: number): Promise<void> {
  await db.delete(schema.baleTransferItems).where(eq(schema.baleTransferItems.id, id));
}

// Production Bales

export async function getProductionBalesByLocation(
  companyId: number,
  locationId: number
): Promise<schema.ProductionBale[]> {
  return await db
    .select()
    .from(schema.productionBales)
    .where(
      and(
        eq(schema.productionBales.companyId, companyId),
        eq(schema.productionBales.locationId, locationId),
        eq(schema.productionBales.status, "IN_STOCK")
      )
    );
}

// Mix Batches

export async function getAllMixBatches(companyId: number): Promise<schema.MixBatch[]> {
  return await db
    .select()
    .from(schema.mixBatches)
    .where(eq(schema.mixBatches.companyId, companyId))
    .orderBy(desc(schema.mixBatches.createdAt));
}

export async function getMixBatchById(id: number, companyId: number): Promise<schema.MixBatch | undefined> {
  const [batch] = await db
    .select()
    .from(schema.mixBatches)
    .where(and(eq(schema.mixBatches.id, id), eq(schema.mixBatches.companyId, companyId)));
  return batch;
}

export async function createMixBatch(batch: schema.InsertMixBatch): Promise<schema.MixBatch> {
  const [created] = await db
    .insert(schema.mixBatches)
    .values({
      ...batch,
      batchCode: batch.batchCode || `MB-${Date.now()}`,
    })
    .returning();
  return created;
}

export async function updateMixBatch(id: number, updates: Partial<schema.InsertMixBatch>): Promise<schema.MixBatch> {
  const [updated] = await db
    .update(schema.mixBatches)
    .set({ ...updates, updatedAt: sql`now()` })
    .where(eq(schema.mixBatches.id, id))
    .returning();
  return updated;
}

export async function getMixBatchSources(mixBatchId: number, companyId: number): Promise<schema.MixBatchSource[]> {
  const batch = await getMixBatchById(mixBatchId, companyId);
  if (!batch) {
    return [];
  }
  return await db.select().from(schema.mixBatchSources).where(eq(schema.mixBatchSources.mixBatchId, mixBatchId));
}

export async function addMixBatchSource(source: schema.InsertMixBatchSource): Promise<schema.MixBatchSource> {
  const [created] = await db.insert(schema.mixBatchSources).values(source).returning();
  return created;
}

export async function getAllProductionBales(
  companyId: number,
  filters?: {
    mixBatchId?: number;
    status?: string;
    category?: string;
    grade?: string;
  }
): Promise<any[]> {
  let conditions = [eq(schema.productionBales.companyId, companyId)];

  if (filters?.mixBatchId) {
    conditions.push(eq(schema.productionBales.mixBatchId, filters.mixBatchId));
  }
  if (filters?.status) {
    conditions.push(eq(schema.productionBales.status, filters.status));
  }
  if (filters?.category) {
    conditions.push(eq(schema.productionBales.category, filters.category));
  }
  if (filters?.grade) {
    conditions.push(eq(schema.productionBales.grade, filters.grade));
  }

  return await db
    .select({
      bale: schema.productionBales,
      product: schema.baleProducts,
      location: schema.locations,
      mixBatch: schema.mixBatches,
    })
    .from(schema.productionBales)
    .leftJoin(schema.baleProducts, eq(schema.productionBales.productId, schema.baleProducts.id))
    .leftJoin(schema.locations, eq(schema.productionBales.locationId, schema.locations.id))
    .leftJoin(schema.mixBatches, eq(schema.productionBales.mixBatchId, schema.mixBatches.id))
    .where(and(...conditions))
    .orderBy(desc(schema.productionBales.createdAt));
}

export async function getProductionBaleById(id: number): Promise<schema.ProductionBale | undefined> {
  const [bale] = await db.select().from(schema.productionBales).where(eq(schema.productionBales.id, id));
  return bale;
}

export async function getProductionBaleByBarcode(
  barcodeValue: string,
  companyId: number
): Promise<schema.ProductionBale | undefined> {
  const [bale] = await db
    .select()
    .from(schema.productionBales)
    .where(and(eq(schema.productionBales.barcodeValue, barcodeValue), eq(schema.productionBales.companyId, companyId)));
  return bale;
}

export async function createProductionBale(bale: schema.InsertProductionBale): Promise<schema.ProductionBale> {
  const baleData: any = { ...bale };
  if (bale.pressedAt) {
    baleData.pressedAt = new Date(bale.pressedAt);
  }
  const [created] = await db.insert(schema.productionBales).values(baleData).returning();
  return created;
}

export async function updateProductionBale(
  id: number,
  updates: Partial<schema.InsertProductionBale>
): Promise<schema.ProductionBale> {
  const updateData: any = { ...updates, updatedAt: sql`now()` };
  if (updates.pressedAt) {
    updateData.pressedAt = new Date(updates.pressedAt);
  }
  const [updated] = await db
    .update(schema.productionBales)
    .set(updateData)
    .where(eq(schema.productionBales.id, id))
    .returning();
  return updated;
}

export async function deleteProductionBale(id: number, companyId: number): Promise<void> {
  await db
    .delete(schema.productionBales)
    .where(and(eq(schema.productionBales.id, id), eq(schema.productionBales.companyId, companyId)));
}

export async function bulkCreateProductionBales(
  bales: schema.InsertProductionBale[]
): Promise<schema.ProductionBale[]> {
  if (bales.length === 0) return [];
  const balesData = bales.map((bale) => {
    const data: any = { ...bale };
    if (bale.pressedAt) {
      data.pressedAt = new Date(bale.pressedAt);
    }
    return data;
  });
  return await db.insert(schema.productionBales).values(balesData).returning();
}

export async function updateProductionBaleFromScan(
  barcodeValue: string,
  companyId: number,
  updates: {
    weightKg: string;
    category: string;
    grade: string;
    warehouseLocation?: string;
  }
): Promise<schema.ProductionBale> {
  const bale = await getProductionBaleByBarcode(barcodeValue, companyId);
  if (!bale) {
    throw new Error(`Bale with barcode ${barcodeValue} not found`);
  }

  let costPerKg = "0";
  let totalCost = "0";

  if (bale.mixBatchId) {
    const batch = await getMixBatchById(bale.mixBatchId, companyId);
    if (batch) {
      costPerKg = batch.costPerKg;
      const weight = parseFloat(updates.weightKg);
      const cost = parseFloat(costPerKg);
      totalCost = (weight * cost).toFixed(2);
    }
  }

  const [updated] = await db
    .update(schema.productionBales)
    .set({
      weightKg: updates.weightKg,
      category: updates.category,
      grade: updates.grade,
      warehouseLocation: updates.warehouseLocation,
      costPerKg,
      totalCost,
      status: "PRESSED",
      pressedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(schema.productionBales.id, bale.id))
    .returning();

  return updated;
}

export async function getNextBaleBarcode(companyId: number): Promise<string> {
  const [sequence] = await db.select().from(schema.baleSequences).where(eq(schema.baleSequences.companyId, companyId));

  if (!sequence) {
    const [newSeq] = await db.insert(schema.baleSequences).values({ companyId, nextNumber: 2 }).returning();
    return `HD${String(newSeq.nextNumber - 1).padStart(5, "0")}`;
  }

  const nextNum = sequence.nextNumber;
  await db
    .update(schema.baleSequences)
    .set({ nextNumber: nextNum + 1 })
    .where(eq(schema.baleSequences.id, sequence.id));

  return `HD${String(nextNum).padStart(5, "0")}`;
}
