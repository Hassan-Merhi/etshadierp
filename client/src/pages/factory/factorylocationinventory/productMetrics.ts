import type { useFactoryLocationInventory } from "../FactoryLocationInventoryModel";

type FactoryLocationInventoryModel = ReturnType<typeof useFactoryLocationInventory>;

export function createFactoryLocationProductMetrics(inventory: FactoryLocationInventoryModel) {
  const {
    activeInventoryData,
    categoryGroups,
    hiddenColumns,
    hideSellingPrice,
    proformaMode,
    regularProducts,
    setHiddenColumns,
    specialProducts,
  } = inventory;

  const allCategoryNames = [...categoryGroups]
    .sort((left, right) => left.categoryName.localeCompare(right.categoryName))
    .map((group) => group.categoryName);

  const statsBales = activeInventoryData.reduce(
    (sum, product) => sum + product.baleCount - (product.loadingCount ?? 0),
    0
  );
  const statsKg = activeInventoryData.reduce((sum, product) => sum + product.totalWeight, 0);
  const statsCostValue = activeInventoryData.reduce(
    (sum, product) => sum + (product.baleCount - (product.loadingCount ?? 0)) * product.productionPrice,
    0
  );
  const statsSellValue = activeInventoryData.reduce(
    (sum, product) => sum + (product.baleCount - (product.loadingCount ?? 0)) * parseFloat(product.sellingPrice || "0"),
    0
  );

  const totalBales = regularProducts.reduce((sum, product) => sum + product.baleCount - (product.loadingCount ?? 0), 0);
  const totalKg = regularProducts.reduce((sum, product) => sum + product.totalWeight, 0);
  const totalSellValue = regularProducts.reduce(
    (sum, product) => sum + (product.baleCount - (product.loadingCount ?? 0)) * parseFloat(product.sellingPrice || "0"),
    0
  );
  const totalProdValue = regularProducts.reduce(
    (sum, product) => sum + (product.baleCount - (product.loadingCount ?? 0)) * product.productionPrice,
    0
  );
  const spTotalBales = specialProducts.reduce(
    (sum, product) => sum + product.baleCount - (product.loadingCount ?? 0),
    0
  );
  const spTotalKg = specialProducts.reduce((sum, product) => sum + product.totalWeight, 0);
  const spTotalSellValue = specialProducts.reduce(
    (sum, product) => sum + (product.baleCount - (product.loadingCount ?? 0)) * parseFloat(product.sellingPrice || "0"),
    0
  );
  const spTotalProdValue = specialProducts.reduce(
    (sum, product) => sum + (product.baleCount - (product.loadingCount ?? 0)) * product.productionPrice,
    0
  );

  const col = (key: string) => !hiddenColumns.has(key);
  const toggleCol = (key: string) =>
    setHiddenColumns((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const colSpan =
    (proformaMode ? 1 : 0) +
    1 +
    (col("category") ? 1 : 0) +
    1 +
    (proformaMode ? 2 : 0) +
    (col("avg_kg") ? 1 : 0) +
    (!hideSellingPrice && col("sell_price") ? 1 : 0) +
    (!hideSellingPrice && col("sell_value") ? 1 : 0) +
    (!hideSellingPrice && col("cost_price") ? 1 : 0) +
    (!hideSellingPrice && col("cost_value") ? 1 : 0) +
    (col("total_kg") ? 1 : 0) +
    (!proformaMode && col("actions") ? 1 : 0);

  return {
    allCategoryNames,
    col,
    colSpan,
    spTotalBales,
    spTotalKg,
    spTotalProdValue,
    spTotalSellValue,
    statsBales,
    statsCostValue,
    statsKg,
    statsSellValue,
    toggleCol,
    totalBales,
    totalKg,
    totalProdValue,
    totalSellValue,
  };
}
