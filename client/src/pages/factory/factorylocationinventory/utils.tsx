/**
 * Pure helpers and lookup tables for the FactoryLocationInventory page.
 *
 * Extracted from FactoryLocationInventory.tsx during the Phase 4 god-file split.
 */

import type { FactoryBaleProduct, SortDir, SortField } from "./types";

export function applySortProducts(items: FactoryBaleProduct[], field: SortField, dir: SortDir) {
  return [...items].sort((a, b) => {
    let cmp = 0;
    switch (field) {
      case "name":
        cmp = a.productName.localeCompare(b.productName);
        break;
      case "bales":
        cmp = a.baleCount - b.baleCount;
        break;
      case "kg":
        cmp = a.totalWeight - b.totalWeight;
        break;
      case "value":
        cmp =
          (a.baleCount - (a.loadingCount ?? 0)) * parseFloat(a.sellingPrice || "0") -
          (b.baleCount - (b.loadingCount ?? 0)) * parseFloat(b.sellingPrice || "0");
        break;
    }
    return dir === "desc" ? -cmp : cmp;
  });
}

export const SPECIAL_FACTORY_CATS = ["Wipers", "Garbage"];

export function isSpecialFactoryCategory(name: string) {
  return SPECIAL_FACTORY_CATS.some((s) => s.toLowerCase() === name.trim().toLowerCase());
}

export const CATEGORY_COLORS: Record<string, string> = {
  Adult: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  Uniform: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  "AS MIX": "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30",
  Kids: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30",
  Ladies: "bg-pink-500/15 text-pink-600 dark:text-pink-400 border-pink-500/30",
  Winter: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/30",
  Wipers: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30",
  Garbage: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
};

export function catColor(cat: string | null) {
  return CATEGORY_COLORS[cat ?? ""] ?? "bg-muted text-muted-foreground border-border";
}
