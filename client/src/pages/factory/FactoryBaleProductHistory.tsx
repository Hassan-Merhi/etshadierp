// Split into ./bale-product-history/* — this file stays as the public entry
// point so the lazy imports in client/src/lazyPages.ts and the prefetch list
// in client/src/lib/offlinePrep.ts keep resolving to one module.
export { FactoryBaleProductHistory } from "./bale-product-history/FactoryBaleProductHistory";
export { FactoryBaleProductMonthDetail } from "./bale-product-history/FactoryBaleProductMonthDetail";
export { FactoryBaleProductAllMonths } from "./bale-product-history/FactoryBaleProductAllMonths";
