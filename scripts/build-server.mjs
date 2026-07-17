/**
 * Server build script.
 *
 * Builds the web server plus the isolated full-export worker. decimal.js is
 * bundled inline in both outputs so Render never depends on Replit's internal
 * package-firewall URL at runtime.
 */

import { build } from "esbuild";
import { fileURLToPath } from "url";
import { resolve } from "path";

const pkgRoot = fileURLToPath(new URL("../node_modules/decimal.js/", import.meta.url));
const decimalEntry = resolve(pkgRoot, "decimal.mjs");

await build({
  entryPoints: {
    index: "server/index.ts",
    "full-export-worker": "server/workers/fullExportWorker.ts",
  },
  platform: "node",
  bundle: true,
  format: "esm",
  outdir: "dist",
  entryNames: "[name]",
  packages: "external",
  plugins: [
    {
      name: "bundle-decimal-js",
      setup(b) {
        b.onResolve({ filter: /^decimal\.js$/ }, () => ({
          path: decimalEntry,
        }));
      },
    },
  ],
});
