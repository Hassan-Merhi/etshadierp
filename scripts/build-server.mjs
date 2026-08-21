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

// Resolve xlsx-js-style to its actual CommonJS entry. This package must be
// bundled so esbuild can translate its CommonJS exports safely for our ESM
// server bundle.
const xlsxJsStyleEntry = require.resolve("xlsx-js-style");

const result = await build({
  entryPoints: ["server/index.ts"],
  platform: "node",
  bundle: true,
  format: "esm",
  outdir: "dist",
  // Do not use packages:"external" here. That setting can re-externalize a
  // node_modules path even after a plugin resolves it, which is exactly what
  // allowed xlsx-js-style to survive as an invalid named ESM import on Render.
  // Instead, the plugin below explicitly externalizes ordinary packages while
  // forcing the two known-problem dependencies to bundle.
  metafile: true,
  plugins: [
    {
      name: "render-runtime-dependency-policy",
      setup(buildContext) {
        buildContext.onResolve({ filter: /.*/ }, (args) => {
          if (args.path === "decimal.js") {
            return { path: decimalEntry };
          }

          if (args.path === "xlsx-js-style") {
            return { path: xlsxJsStyleEntry };
          }

          // Keep repository-relative imports and project aliases inside the
          // bundle so existing server behaviour is unchanged.
          if (
            args.path.startsWith(".") ||
            args.path.startsWith("/") ||
            args.path.startsWith("@shared/") ||
            args.path.startsWith("@/") ||
            args.path.startsWith("@assets/")
          ) {
            return null;
          }

          // Node built-ins and every other package stay as runtime externals,
          // matching the previous packages:"external" behaviour.
          return { path: args.path, external: true };
        });
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
