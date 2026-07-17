#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

async function read(relativePath) {
  return fs.readFile(path.join(ROOT, relativePath), "utf8");
}

const [main, clientBridge, viteConfig, vitePlugin, stockEntrySource] = await Promise.all([
  read("client/src/main.tsx"),
  read("client/src/lib/heavyListPaginationClient.ts"),
  read("vite.config.ts"),
  read("build/viteHeavyListPaginationPlugin.ts"),
  read("client/src/pages/StockEntryHistory.tsx"),
]);

assert.match(main, /import "\.\/lib\/heavyListPaginationClient";/, "main.tsx must install the pagination client");
assert.match(
  clientBridge,
  /const STOCK_ENTRY_ENDPOINT = "\/api\/factory\/bales\/stock-entry-history";/,
  "client bridge must target stock-entry history"
);
assert.match(clientBridge, /url\.searchParams\.get\("lite"\) !== "1"/, "only lite screen requests may be paged");
assert.match(clientBridge, /searchParams\.set\("pagination", "1"\)/, "paged requests must opt into server pagination");
assert.match(clientBridge, /JSON\.stringify\(payload\.items\)/, "legacy array response must be preserved for the page");
assert.match(clientBridge, /button-view-detailed/, "controls must hide in detailed mode");
assert.match(clientBridge, /button-view-condensed/, "controls must return in condensed mode");
assert.match(clientBridge, /stock-entry-page-previous/, "previous-page control is required");
assert.match(clientBridge, /stock-entry-page-next/, "next-page control is required");
assert.match(clientBridge, /stock-entry-page-size/, "page-size control is required");
assert.match(clientBridge, /screen totals are this page/, "the UI must disclose page-scoped screen totals");

assert.match(viteConfig, /heavyListPaginationPlugin\(\)/, "Vite must register the export-safety transform");
assert.match(vitePlugin, /groupsWithBales\.map/, "summary export must use the complete filtered groups");
assert.match(vitePlugin, /Missing transform target/, "transform drift must fail loudly");
assert.match(vitePlugin, /Ambiguous transform target/, "ambiguous transforms must fail loudly");

const originalSummaryMarker = "const summaryRows = filteredGroups.map((g) => ({";
const fullFetchMarker = "const groupsWithBales = await fetchGroupsWithBales();";
assert.ok(stockEntrySource.includes(originalSummaryMarker), "source marker for the exact transform must still exist");
assert.ok(stockEntrySource.includes(fullFetchMarker), "stock-entry source must retain the full export fetch marker");

console.log(
  JSON.stringify(
    {
      ok: true,
      checks: [
        "pagination client startup wiring",
        "lite-only request pagination",
        "legacy array compatibility",
        "visible previous/next/page-size controls",
        "condensed/detailed mode isolation",
        "page-total disclosure",
        "full-data Excel summary transform",
        "transform drift guards",
      ],
    },
    null,
    2
  )
);
