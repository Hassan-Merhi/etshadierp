#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const read = (relativePath) => fs.readFile(path.join(ROOT, relativePath), "utf8");

const [main, client, plugin, source] = await Promise.all([
  read("client/src/main.tsx"),
  read("client/src/lib/daybookPaginationClient.ts"),
  read("build/viteHeavyListPaginationPlugin.ts"),
  read("client/src/pages/factory/FactoryDaybook.tsx"),
]);

assert.match(main, /import "\.\/lib\/daybookPaginationClient";/, "main.tsx must install Daybook pagination");
assert.match(client, /const ENDPOINT = "\/api\/factory\/daybook";/, "Daybook endpoint must be targeted");
assert.match(client, /const DEFAULT_LIMIT = 100;/, "Daybook default page size must be 100");
assert.match(client, /fetchAllDaybookEntries/, "complete export loader is required");
assert.match(client, /for \(let page = 2; page <= totalPages; page \+= 1\)/, "complete loader must fetch every page");
assert.match(client, /entryId/, "entry deep links must bypass normal paging");
assert.match(client, /voucherId/, "voucher deep links must bypass normal paging");
assert.match(client, /JSON\.stringify\(payload\.items\)/, "the legacy Daybook array contract must be preserved");
assert.match(client, /factory-daybook-page-previous/, "Previous control is required");
assert.match(client, /factory-daybook-page-next/, "Next control is required");
assert.match(client, /factory-daybook-page-size/, "page-size control is required");
assert.match(client, /table groups and totals are this page/, "page-scoped totals must be disclosed");
assert.match(client, /handleRouteState/, "route changes must clear transient paging state");

assert.match(plugin, /FACTORY_DAYBOOK_SUFFIX/, "Vite plugin must target FactoryDaybook.tsx");
assert.match(plugin, /optionalStatus/, "optional-status filtering must be sent to the server");
assert.match(plugin, /debouncedSearchQuery\.trim\(\)/, "debounced search must be sent to the server");
assert.match(plugin, /queryParams\.set\("minAmount"/, "minimum amount must be sent to the server");
assert.match(plugin, /queryParams\.set\("maxAmount"/, "maximum amount must be sent to the server");
assert.match(plugin, /queryParams\.set\("sortOrder"/, "sort direction must be sent to the server");
assert.match(plugin, /fetchAllDaybookEntries/, "both export modes must use the complete loader");
assert.match(plugin, /const exportData = exportEntries\.map/, "summary export must use complete entries");
assert.match(plugin, /for \(const entry of exportEntries\)/, "detailed export must use complete entries");
assert.match(plugin, /entry\.txType !== "WORKER_EDITED"/, "existing worker-edit exclusion must be preserved");
assert.match(plugin, /Missing transform target/, "source drift must fail loudly");
assert.match(plugin, /Ambiguous transform target/, "ambiguous replacements must fail loudly");

const exactMarkers = [
  'import { queryClient } from "@/lib/queryClient";',
  'queryKey: ["/api/factory/daybook", startDate, endDate, txTypeFilter, currencyFilter],',
  'const handleExportToExcel = async () => {',
  'const handleExportDetailedToExcel = async () => {',
  'for (const entry of filteredEntries) {',
];
for (const marker of exactMarkers) {
  const first = source.indexOf(marker);
  assert.ok(first >= 0, `Missing exact Daybook source marker: ${marker}`);
  assert.equal(source.indexOf(marker, first + marker.length), -1, `Ambiguous Daybook source marker: ${marker}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checks: [
        "Daybook startup wiring",
        "100-row screen pagination",
        "legacy array compatibility",
        "visible page controls",
        "server-side search/status/amount/sort filters",
        "entry and voucher deep-link bypass",
        "complete summary export",
        "complete detailed export",
        "worker-edit exclusion preservation",
        "page-total disclosure",
        "route-state reset",
        "fail-loud source transforms",
      ],
    },
    null,
    2
  )
);
