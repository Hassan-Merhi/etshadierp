#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const read = (relativePath) => fs.readFile(path.join(ROOT, relativePath), "utf8");

const [main, client, plugin, source] = await Promise.all([
  read("client/src/main.tsx"),
  read("client/src/lib/v5AllocationPaginationClient.ts"),
  read("build/viteHeavyListPaginationPlugin.ts"),
  read("client/src/pages/factory/FactoryStockAllocationV5.tsx"),
]);

assert.match(main, /import "\.\/lib\/v5AllocationPaginationClient";/, "main.tsx must install V5 pagination");
assert.match(client, /const ENDPOINT = "\/api\/factory\/v5\/stock-allocation";/, "V5 endpoint must be targeted");
assert.match(client, /const DEFAULT_LIMIT = 50;/, "V5 screen default must remain 50 rows");
assert.match(client, /fullAction/, "explicit full-data requests need an interceptor bypass marker");
assert.match(client, /fetchAllV5AllocationData/, "all-pages loader is required for business actions");
assert.match(client, /for \(let page = 2; page <= totalPages; page \+= 1\)/, "all-pages loader must fetch every page");
assert.match(client, /hasFocusedDeepLink\(\)/, "focused proforma links must bypass normal paging");
assert.match(client, /negativeOnlyMode \|\| hasFocusedDeepLink\(\)/, "global Negative Only and deep links must stay full-data");
assert.match(client, /button-v5-toggle-negative-only/, "Negative Only mode changes must be observed");
assert.match(client, /v5-allocation-page-previous/, "Previous control is required");
assert.match(client, /v5-allocation-page-next/, "Next control is required");
assert.match(client, /v5-allocation-page-size/, "page-size control is required");
assert.match(client, /garbage\/wiper toggle is page-scoped/, "page-scoped garbage filtering must be disclosed");
assert.match(client, /handleRouteState/, "route changes must reset transient bridge modes");

assert.match(plugin, /V5_ALLOCATION_SUFFIX/, "Vite plugin must target the V5 allocation screen");
assert.match(plugin, /fetchAllV5AllocationData/, "V5 transform must import the complete-data loader");
assert.match(plugin, /openCreateDrawerWithAllRows/, "create drawer must wait for complete rows");
assert.match(plugin, /openEditDrawerWithAllRows/, "edit drawer must wait for complete rows");
assert.match(plugin, /const currentRows = actionRows \?\? \(await loadAllActionRows\(\)\)/, "draft quantity editing must use complete rows");
assert.match(plugin, /const complete = await fetchAllV5AllocationData\(exportParams\)/, "Excel must load all filtered pages");
assert.match(plugin, /setActionRows\(null\)/, "drawer completion must release complete row references");
assert.match(plugin, /Missing transform target/, "source drift must fail loudly");
assert.match(plugin, /Ambiguous transform target/, "ambiguous replacements must fail loudly");

const exactSourceMarkers = [
  'import { apiRequest, queryClient } from "@/lib/queryClient";',
  'function openEditDraft(proformaId: number, proformaName: string, currentRows: V5Row[]) {',
  'const filtered = rows.filter((r) => {',
  'onClick={() => setCreateDrawerOpen(true)}',
  'onClick={() => setEditDrawerProformaId(proforma.proformaId)}',
  'onClose={() => setCreateDrawerOpen(false)}',
  'onClose={() => setEditDrawerProformaId(null)}',
];
for (const marker of exactSourceMarkers) {
  const first = source.indexOf(marker);
  assert.ok(first >= 0, `Missing exact V5 source marker: ${marker}`);
  assert.equal(source.indexOf(marker, first + marker.length), -1, `Ambiguous V5 source marker: ${marker}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checks: [
        "V5 startup wiring",
        "normal 50-row paging",
        "all-pages action loader",
        "focused deep-link bypass",
        "global Negative Only preservation",
        "visible page controls",
        "route-state reset",
        "complete create/edit/draft rows",
        "complete filtered Excel export",
        "large action-reference cleanup",
        "fail-loud source transforms",
      ],
    },
    null,
    2
  )
);
