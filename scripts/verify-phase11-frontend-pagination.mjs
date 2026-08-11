#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

async function read(relativePath) {
  return fs.readFile(path.join(ROOT, relativePath), "utf8");
}

const [main, accountingGuard, clientBridge, viteConfig, vitePlugin, stockEntrySource] = await Promise.all([
  read("client/src/main.tsx"),
  read("client/src/lib/accountingRequestFetchGuard.ts"),
  read("client/src/lib/heavyListPaginationClient.ts"),
  read("vite.config.ts"),
  read("build/viteHeavyListPaginationPlugin.ts"),
  read("client/src/pages/StockEntryHistory.tsx"),
]);

assert.match(main, /import "\.\/lib\/accountingRequestFetchGuard";/, "main.tsx must install the accounting request guard");
assert.match(
  accountingGuard,
  /import "\.\/heavyListPaginationClient";/,
  "the accounting request guard must install the pagination client"
);
assert.match(
  clientBridge,
  /const STOCK_ENTRY_ENDPOINT = "\/api\/factory\/bales\/stock-entry-history";/,
  "client bridge must target stock-entry history"
);
assert.match(clientBridge, /const SCREEN_SENTINEL_LIMIT = 9999;/, "the screen query sentinel must remain explicit");
assert.match(
  clientBridge,
  /Number\(url\.searchParams\.get\("limit"\)\) !== SCREEN_SENTINEL_LIMIT/,
  "only the stock-entry screen query may be paged"
);
assert.match(clientBridge, /searchParams\.set\("pagination", "1"\)/, "paged requests must opt into server pagination");
assert.match(clientBridge, /if \(!payload \|\| !Array\.isArray\(payload\.items\)\) return response;/, "paged responses must be validated");
assert.match(
  stockEntrySource,
  /const groups: GroupRow\[\] = pagedGroups\?\.items \?\? \[\];/,
  "the stock-entry screen must consume the paginated response object"
);
assert.match(stockEntrySource, /const useLite = viewMode === "condensed";/, "condensed mode must retain its lite payload");
assert.match(stockEntrySource, /if \(useLite\) params\.set\("lite", "1"\);/, "detailed mode must retain full rows");
assert.match(clientBridge, /stock-entry-page-previous/, "previous-page control is required");
assert.match(clientBridge, /stock-entry-page-next/, "next-page control is required");
assert.match(clientBridge, /stock-entry-page-size/, "page-size control is required");
assert.match(clientBridge, /of \$\{activeMeta\.total\} groups/, "the UI must disclose the page range and total groups");

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
        "paginated response compatibility",
        "visible previous/next/page-size controls",
        "condensed/detailed payload mode preservation",
        "page-total disclosure",
        "full-data Excel summary transform",
        "transform drift guards",
      ],
    },
    null,
    2
  )
);
