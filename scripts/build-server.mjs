/**
 * Production server build.
 *
 * Most npm packages stay external so the server bundle remains small. decimal.js
 * is the exception: it is deliberately aliased to its concrete ESM file and
 * bundled into dist/index.js. This prevents Render startup from depending on a
 * separately installed decimal.js runtime package.
 */

import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const decimalEntry = fileURLToPath(
  new URL("../node_modules/decimal.js/decimal.mjs", import.meta.url)
);

await build({
  entryPoints: ["server/index.ts"],
  platform: "node",
  bundle: true,
  format: "esm",
  outdir: "dist",
  packages: "external",
  alias: {
    // esbuild applies aliases before package externalization. Resolving to an
    // absolute file path forces decimal.js into the generated server bundle.
    "decimal.js": decimalEntry,
  },
});

// Never publish a server artifact that can reproduce the Render crash. This
// check makes the build fail immediately if an esbuild/configuration change
// leaves decimal.js as a runtime package import again.
const output = await readFile("dist/index.js", "utf8");
const unresolvedDecimalImport =
  /(?:from\s*["']decimal\.js["']|import\s*\(\s*["']decimal\.js["']\s*\)|node_modules\/decimal\.js\/index\.js)/;

if (unresolvedDecimalImport.test(output)) {
  throw new Error(
    "Production bundle still contains a runtime decimal.js import; refusing to publish a broken Render artifact."
  );
}

console.log("Server bundle verified: decimal.js is embedded in dist/index.js");
