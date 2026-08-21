/**
 * Server build script — wraps esbuild CLI behaviour with targeted runtime
 * dependency bundling for packages that are unsafe to leave as external ESM
 * imports on Render.
 *
 * decimal.js is bundled because historical package-lock registry URLs can make
 * the runtime dependency unavailable on Render.
 *
 * xlsx-js-style is bundled because it is CommonJS. Leaving it external while
 * source files use named imports makes Node evaluate emitted code such as
 *   import { read } from "xlsx-js-style";
 * and crash at startup with "Named export 'read' not found". Bundling lets
 * esbuild apply the CommonJS interop wrapper at build time instead.
 *
 * All other npm packages remain external.
 */

import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const require = createRequire(import.meta.url);

// Resolve decimal.js to its ESM entry file (decimal.mjs) so esbuild can
// bundle it as a native ESM chunk rather than wrapping a CJS module.
const pkgRoot = fileURLToPath(new URL("../node_modules/decimal.js/", import.meta.url));
const decimalEntry = resolve(pkgRoot, "decimal.mjs");

// Resolve xlsx-js-style to its actual CommonJS entry. Returning an absolute
// path from onResolve overrides packages:"external" for this dependency and
// forces esbuild to generate the correct CJS↔ESM interop inside dist/index.js.
const xlsxJsStyleEntry = require.resolve("xlsx-js-style");

const result = await build({
  entryPoints: ["server/index.ts"],
  platform: "node",
  bundle: true,
  format: "esm",
  outdir: "dist",
  packages: "external",
  // Records which packages the output actually imports, and whether each is a
  // static import-statement or a dynamic import(). scripts/verify-runtime-
  // dependencies.mjs reads this to check every static import is declared in
  // "dependencies". Reading it from esbuild rather than grepping the bundle
  // matters: the output embeds source text containing `import ... from "@/lib/…"`
  // inside template literals, which no regex can tell apart from a real import.
  metafile: true,
  plugins: [
    {
      name: "bundle-render-runtime-dependencies",
      setup(buildContext) {
        // Intercept every import from decimal.js and redirect it to the local
        // ESM file so esbuild includes it instead of emitting a runtime import.
        buildContext.onResolve({ filter: /^decimal\.js$/ }, () => ({
          path: decimalEntry,
        }));

        // xlsx-js-style is CommonJS. Bundle it so source-level named imports are
        // translated by esbuild rather than being emitted as invalid Node ESM.
        buildContext.onResolve({ filter: /^xlsx-js-style$/ }, () => ({
          path: xlsxJsStyleEntry,
        }));
      },
    },
  ],
});

await writeFile("dist/server-build-meta.json", JSON.stringify(result.metafile), "utf8");

// Refuse to publish an artifact that can reproduce either known Render startup
// crash. Keep these checks separate from the resolver implementation so future
// build refactors cannot silently reintroduce broken runtime imports.
const output = await readFile("dist/index.js", "utf8");
const unresolvedDecimalImport =
  /(?:from\s*["']decimal\.js["']|import\s*\(\s*["']decimal\.js["']\s*\)|node_modules\/decimal\.js\/index\.js)/;
const unresolvedXlsxJsStyleImport =
  /(?:from\s*["']xlsx-js-style["']|import\s*\(\s*["']xlsx-js-style["']\s*\))/;

if (unresolvedDecimalImport.test(output)) {
  throw new Error(
    "Production bundle still contains a runtime decimal.js import; refusing to publish a broken Render artifact.",
  );
}

if (unresolvedXlsxJsStyleImport.test(output)) {
  throw new Error(
    "Production bundle still contains a runtime xlsx-js-style import; refusing to publish a broken Render artifact.",
  );
}

console.log("Server bundle verified: decimal.js and xlsx-js-style are embedded in dist/index.js");
