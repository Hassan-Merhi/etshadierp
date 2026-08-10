#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

async function read(relativePath) {
  return fs.readFile(path.join(ROOT, relativePath), "utf8");
}

const [
  traceContext,
  stockLightRoutes,
  queryKeys,
  voucherQueries,
  voucherEditQueries,
  factoryProformas,
  invalidationPolicy,
  requestStormGuard,
  queryPolicies,
  bilingualCatalog,
] = await Promise.all([
  read("server/lib/traceContext.ts"),
  read("server/routes/stock/stockLightRoutes.ts"),
  read("client/src/lib/queryKeys.ts"),
  read("client/src/pages/vouchers/useVoucherQueries.ts"),
  read("client/src/pages/voucher-edit/useVoucherEditQueries.ts"),
  read("client/src/pages/factory/FactoryProformas.tsx"),
  read("client/src/lib/bandwidthInvalidationPolicy.ts"),
  read("client/src/lib/requestStormGuard.ts"),
  read("client/src/lib/queryPolicies.ts"),
  read("client/src/pages/BaleProductsBilingual.tsx"),
]);

// 1. Diagnostic route labels must stay canonical.
assert.match(traceContext, /route\.startsWith\("\/api\/"\)/, "absolute API route templates must not be double-prefixed");
assert.match(traceContext, /route\.startsWith\(`\$\{base\}\/`\)/, "already-base-prefixed route templates must remain unchanged");

// 2. Identity payload must remain strictly smaller than the default light contract.
assert.match(stockLightRoutes, /profile === "identity"/, "identity stock-item profile is required");
for (const field of ["id: stockItems.id", "code: stockItems.code", "name: stockItems.name", "uom: stockItems.uom"]) {
  assert.ok(stockLightRoutes.includes(field), `identity profile is missing ${field}`);
}
assert.match(stockLightRoutes, /stock-items-identity-v1/, "identity payload marker is required");
assert.match(stockLightRoutes, /stock-items-light-v1/, "default light payload marker is required");

// 3. High-frequency selectors must use the identity URL as queryKey[0].
assert.match(
  queryKeys,
  /identity:\s*\(companyId:[\s\S]*?\["\/api\/stock-items\/light\?profile=identity", companyId\]/,
  "stockItemKeys.identity must keep the real identity URL as key element zero"
);
for (const [label, source] of [
  ["voucher create/transfer/POS", voucherQueries],
  ["voucher edit", voucherEditQueries],
]) {
  assert.match(source, /stockItemKeys\.identity\(/, `${label} must use the identity profile`);
  assert.match(source, /staleTime:\s*30 \* 60 \* 1000/, `${label} must keep a 30-minute stale period`);
  assert.match(source, /gcTime:\s*2 \* 60 \* 60 \* 1000/, `${label} must keep a two-hour GC period`);
  assert.match(source, /refetchOnMount:\s*false/, `${label} must not refetch on mount`);
  assert.match(source, /refetchOnWindowFocus:\s*false/, `${label} must not refetch on focus`);
  assert.match(source, /refetchOnReconnect:\s*false/, `${label} must not refetch on reconnect`);
}
assert.match(factoryProformas, /stock-items\/light\?profile=identity/, "Factory Proformas Add Item must use identity data");
assert.match(
  factoryProformas,
  /enabled:\s*isAddLineOpen\s*&&\s*!!selectedCompany\?\.id/,
  "Factory Proformas must not load the stock catalog merely because a card is expanded"
);

// 4. Workflow writes preserve reference caches; actual catalog writes invalidate them.
for (const pathFragment of ["customer-proforma-lines", "customer-proformas"]) {
  assert.ok(!invalidationPolicy.match(new RegExp(`factory\\/(?:[^\\n]*\\|)?${pathFragment}`)), `${pathFragment} must not be a full-invalidation rule`);
}
assert.match(
  invalidationPolicy,
  /factory\\\/\(\?:bale-products\|categories\)\(\?:\\\/\|\$\)/,
  "Factory bale-product/category writes must fully invalidate reference data"
);
assert.match(invalidationPolicy, /stock-items\(\?:\\\/\|\$\)/, "stock-item writes must fully invalidate reference data");

// 5. Live and reference response generations must remain independent.
assert.match(requestStormGuard, /let liveWriteGeneration = 0;/, "live write generation is required");
assert.match(requestStormGuard, /let referenceWriteGeneration = 0;/, "reference write generation is required");
assert.match(requestStormGuard, /function generationForScope/, "scope-specific generation lookup is required");
assert.match(requestStormGuard, /if \(scope === "all"\) referenceWriteGeneration \+= 1;/, "live writes must not advance reference generation");
assert.match(requestStormGuard, /customer-proformas\$\/,[\s\S]*scope: "live"/, "customer proformas must remain live cache data");
assert.match(requestStormGuard, /factory\\\/bale-products\$\/,[\s\S]*30 \* 60_000[\s\S]*scope: "reference"/, "bale products need a 30-minute reference response cache");
assert.match(requestStormGuard, /factory\\\/categories\$\/,[\s\S]*30 \* 60_000[\s\S]*scope: "reference"/, "Factory categories need a 30-minute reference response cache");

// 6. React Query must retain the same long-lived Factory reference policy.
assert.match(queryPolicies, /referenceData:\s*30 \* 60_000/, "reference data stale period must remain 30 minutes");
assert.match(queryPolicies, /referenceData:\s*2 \* 60 \* 60_000/, "reference data GC period must remain two hours");
assert.ok(queryPolicies.includes('"/api/factory/bale-products"'), "bale products must be stable reference data");
assert.ok(queryPolicies.includes('"/api/factory/categories"'), "Factory categories must be stable reference data");
assert.match(queryPolicies, /refetchOnMount:\s*false/, "stable references must not refetch on mount");
assert.match(queryPolicies, /refetchOnWindowFocus:\s*false/, "stable references must not refetch on focus");
assert.match(queryPolicies, /refetchOnReconnect:\s*false/, "stable references must not refetch on reconnect");

// 7. Bilingual search/filter changes must be local presentation work.
assert.match(bilingualCatalog, /parsed\.searchParams\.delete\("q"\)/, "catalog search term must never reach the large bale-product GET");
assert.match(bilingualCatalog, /const fullCatalogRef = useRef/, "one full language catalog must be retained in memory");
assert.match(bilingualCatalog, /useLayoutEffect\([\s\S]*?\}, \[language\]\);/, "fetch boundary must remount only for language changes");
assert.match(bilingualCatalog, /queryClient\.setQueryData\([\s\S]*?\/api\/factory\/bale-products/, "search/filter changes must update the existing query locally");
assert.match(bilingualCatalog, /key=\{language\}/, "search/filter state must not be part of the catalog boundary key");
for (const field of ["product.name", "product.nameAr", "product.nameFr", "product.code", "product.articleCode", "product.categoryName", "product.categoryNameAr", "product.categoryNameFr"]) {
  assert.ok(bilingualCatalog.includes(field), `local multilingual search is missing ${field}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      phase: 4,
      area: "global-request-pressure",
      checks: [
        "canonical diagnostic route templates",
        "strict stock-item identity payload",
        "identity query key and high-frequency selector adoption",
        "Factory Proformas dialog-only catalog loading",
        "live-vs-reference invalidation scope",
        "independent live/reference cache generations",
        "30-minute Factory reference caching",
        "bilingual search and translation filtering without catalog refetch churn",
      ],
    },
    null,
    2
  )
);
