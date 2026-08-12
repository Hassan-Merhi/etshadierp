import type { FactoryBaleProduct } from "./types";

interface CatalogBaleProduct {
  id: number;
  articleCode: string | null;
  name: string;
  nameAr: string | null;
  sellingPrice: string | null;
  productionPrice: string | null;
  categoryId: number | null;
  active: boolean;
}

interface CatalogCategory {
  id: number;
  name: string;
}

interface BuildActiveInventoryInput {
  proformaMode: boolean;
  showZeroStock: boolean;
  hideZeroAvailable: boolean;
  availableInventoryData: FactoryBaleProduct[];
  inventoryData: FactoryBaleProduct[];
  catalogBaleProducts: CatalogBaleProduct[];
  catalogCategories: CatalogCategory[];
}

export function buildActiveInventoryData({
  proformaMode,
  showZeroStock,
  hideZeroAvailable,
  availableInventoryData,
  inventoryData,
  catalogBaleProducts,
  catalogCategories,
}: BuildActiveInventoryInput): FactoryBaleProduct[] {
  const base = proformaMode && availableInventoryData.length > 0 ? availableInventoryData : inventoryData;
  const shouldMergeZero = (!hideZeroAvailable && proformaMode) || (!proformaMode && showZeroStock);
  if (!shouldMergeZero) return base;

  const categoryNameById = new Map(catalogCategories.map((category) => [category.id, category.name]));
  const inStockIds = new Set(base.map((product) => product.productId));
  const zeroItems: FactoryBaleProduct[] = catalogBaleProducts
    .filter((product) => !inStockIds.has(product.id) && product.active !== false)
    .map((product) => ({
      productId: product.id,
      articleCode: product.articleCode || "",
      productName: product.name,
      productNameAr: product.nameAr || null,
      category: product.categoryId ? (categoryNameById.get(product.categoryId) ?? "Uncategorized") : "Uncategorized",
      categoryId: product.categoryId,
      quantity: 0,
      totalWeight: 0,
      totalCost: 0,
      baleCount: 0,
      sellingPrice: String(product.sellingPrice || "0"),
      productionPrice: parseFloat(product.productionPrice || "0"),
      isInactive: product.active === false,
    }));

  return [...base, ...zeroItems];
}
