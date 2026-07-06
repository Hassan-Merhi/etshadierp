/**
 * Phase 3 — Lazy Import Safety Tests
 *
 * Verifies that every React.lazy() entry in lazyPages.ts points to a file
 * that actually exists on disk. This catches broken imports, renamed files,
 * deleted components, and split-file regressions immediately at CI time —
 * without needing jsdom, React, or a running server.
 *
 * Also verifies named-export shapes for the `.then((m) => ({ default: m.Named }))`
 * pattern: the target named export must actually be exported from the source file.
 *
 * How it works:
 *   1. Read client/src/lazyPages.ts as text.
 *   2. Extract every import("@/pages/...") path with a regex.
 *   3. Resolve `@/` → `client/src/` and check existsSync for .tsx/.ts/.jsx/.js
 *      or an index file inside a same-named directory.
 *   4. Extract .then((m) => ({ default: m.ExportName })) patterns and verify
 *      ExportName is actually exported from the target file.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// ── Setup ────────────────────────────────────────────────────────────────────

const WORKSPACE = resolve(__dirname, "..");
const LAZY_PAGES_FILE = resolve(WORKSPACE, "client/src/lazyPages.ts");
const lazyPagesSource = readFileSync(LAZY_PAGES_FILE, "utf-8");

/** Extract unique @/ import paths from all lazy(() => import("@/...")) patterns. */
function extractLazyPaths(source: string): string[] {
  const seen = new Set<string>();
  const regex = /import\("(@\/[^"]+)"\)/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(source)) !== null) {
    seen.add(m[1]);
  }
  return [...seen].sort();
}

/**
 * Extract named re-export shapes: { aliasPath, exportName }
 * Covers the pattern:
 *   lazy(() => import("@/pages/X").then((m) => ({ default: m.ExportName })))
 */
function extractNamedReExports(
  source: string
): Array<{ aliasPath: string; exportName: string }> {
  const results: Array<{ aliasPath: string; exportName: string }> = [];
  // Match: import("@/...").then((m) => ({ default: m.Something }))
  // Note: the multi-line format has a trailing comma — `m.Name,\n  }))` —
  // so we use [,\s]* (not just \s*) between the export name and closing }.
  const regex =
    /import\("(@\/[^"]+)"\)\.then\(\s*\(m\)\s*=>\s*\(\{\s*default:\s*m\.(\w+)[,\s]*\}\)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(source)) !== null) {
    results.push({ aliasPath: m[1], exportName: m[2] });
  }
  return results;
}

/**
 * Resolve an @/-prefixed path to an absolute file path that exists,
 * or return null if no matching file is found.
 */
function resolveAlias(aliasPath: string): string | null {
  // @/ → client/src/
  const relative = aliasPath.replace(/^@\//, "client/src/");
  const base = resolve(WORKSPACE, relative);

  // Direct file with common extensions
  for (const ext of [".tsx", ".ts", ".jsx", ".js"]) {
    const candidate = base + ext;
    if (existsSync(candidate)) return candidate;
  }

  // Directory with index file
  for (const ext of [".tsx", ".ts", ".jsx", ".js"]) {
    const candidate = resolve(base, "index" + ext);
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

/**
 * Returns true if `exportName` appears as a named export in `filePath`.
 * Checks for: export function X, export const X, export class X, export { X }
 */
function fileHasNamedExport(filePath: string, exportName: string): boolean {
  const source = readFileSync(filePath, "utf-8");
  // Direct named export declarations
  if (
    new RegExp(
      `export\\s+(function|const|class|let|var)\\s+${exportName}\\b`
    ).test(source)
  )
    return true;
  // Re-export: export { X } or export { Foo as X }
  if (new RegExp(`export\\s+\\{[^}]*\\b${exportName}\\b[^}]*\\}`).test(source))
    return true;
  return false;
}

const lazyPaths = extractLazyPaths(lazyPagesSource);
const namedReExports = extractNamedReExports(lazyPagesSource);

// ── Tests: file existence ─────────────────────────────────────────────────────

describe("lazyPages.ts — lazy import file existence", () => {
  it("lazyPages.ts exports a substantial number of lazy pages (sanity check)", () => {
    // If this drops below 50 something has gone badly wrong with the file
    expect(lazyPaths.length).toBeGreaterThanOrEqual(50);
  });

  it("lazyPages.ts itself is parseable and contains React.lazy calls", () => {
    expect(lazyPagesSource).toContain("React.lazy");
    // The file uses the `lazy` import from react
    expect(lazyPagesSource).toContain('import { lazy }');
  });

  // One test per unique import path — dynamic generation so failures show
  // exactly which path is broken.
  for (const importPath of lazyPaths) {
    it(`${importPath} → file exists on disk`, () => {
      const resolved = resolveAlias(importPath);
      expect(
        resolved,
        `No file found for lazy import "${importPath}". ` +
          `Expected one of: ${importPath.replace("@/", "client/src/")}.{tsx,ts,jsx,js}`
      ).not.toBeNull();
    });
  }
});

// ── Tests: named re-export shapes ────────────────────────────────────────────

describe("lazyPages.ts — named re-export shapes (.then((m) => m.Named))", () => {
  it("has at least one named re-export pattern to verify", () => {
    // Sanity: the regex should find FactoryBaleProductMonthDetail and
    // FactoryBaleProductAllMonths at minimum.
    expect(namedReExports.length).toBeGreaterThanOrEqual(1);
  });

  for (const { aliasPath, exportName } of namedReExports) {
    it(`${aliasPath} exports "${exportName}" (used in .then() re-export)`, () => {
      const filePath = resolveAlias(aliasPath);
      expect(
        filePath,
        `File not found for ${aliasPath}`
      ).not.toBeNull();

      const hasExport = fileHasNamedExport(filePath!, exportName);
      expect(
        hasExport,
        `Expected "${exportName}" to be a named export in ${aliasPath}. ` +
          `If the component was renamed or moved, update lazyPages.ts to match.`
      ).toBe(true);
    });
  }
});

// ── Tests: critical page exports present ────────────────────────────────────

describe("lazyPages.ts — critical page exports present", () => {
  const REQUIRED_EXPORTS = [
    "Dashboard",
    "Accounts",
    "Vouchers",
    "StockHub",
    "InventoryHub",
    "Settings",
    "SalesReport",
    "POS",
    "FactoryDashboardIntel",
    "FactoryContainersHub",
    "FactoryWorkersHub",
  ];

  for (const name of REQUIRED_EXPORTS) {
    it(`exports ${name}`, () => {
      // The export const <name> = lazy(... line must be present
      expect(lazyPagesSource).toMatch(new RegExp(`export const ${name}\\s*=\\s*lazy`));
    });
  }
});
