/**
 * Server build script — wraps esbuild CLI behaviour with one addition:
 * decimal.js is bundled inline (not left as an external runtime import).
 *
 * Why: package-lock.json resolved URLs point to the Replit-internal package
 * firewall (package-firewall.replit.local), which is unreachable on Render.
 * That causes `node dist/index.js` to throw
 *   "Cannot find package … decimal.js/index.js"
 * at startup.  By bundling decimal.js into the output we remove the runtime
 * dependency entirely — the package only needs to exist in local node_modules
 * at BUILD time, which it does.
 *
 * All other npm packages remain external (they are already cached in Render's
 * node_modules from previous deploys, or installed normally via npm install).
 */

import { build } from "esbuild";
import { fileURLToPath } from "url";
import { resolve } from "path";

// Resolve decimal.js to its ESM entry file (decimal.mjs) so esbuild can
// bundle it as a native ESM chunk rather than wrapping a CJS module.
const pkgRoot = fileURLToPath(
  new URL("../node_modules/decimal.js/", import.meta.url)
);
const decimalEntry = resolve(pkgRoot, "decimal.mjs");

await build({
  entryPoints: ["server/index.ts"],
  platform: "node",
  bundle: true,
  format: "esm",
  outdir: "dist",
  packages: "external",
  plugins: [
    {
      name: "bundle-decimal-js",
      setup(b) {
        // Intercept every `import … from 'decimal.js'` and redirect it to
        // the local .mjs file so esbuild includes it in the bundle instead
        // of emitting an external import statement.
        b.onResolve({ filter: /^decimal\.js$/ }, () => ({
          path: decimalEntry,
        }));
      },
    },
  ],
});
