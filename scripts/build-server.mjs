/**
 * Server build script — wraps esbuild CLI behaviour with targeted runtime
 * dependency bundling for packages that are unsafe to leave as external ESM
 * imports on Render.
 *
 * decimal.js is bundled because historical package-lock registry URLs can make
 * the runtime dependency unavailable on Render.
 *
 * xlsx-js-style is CommonJS. We try to bundle it so esbuild handles interop,
 * and we also harden the final artifact by rewriting any surviving named ESM
 * import to the default-import form Node supports for CommonJS packages.
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

// Resolve xlsx-js-style to its actual CommonJS entry.
const xlsxJsStyleEntry = require.resolve("xlsx-js-style");

const result = await build({
  entryPoints: ["server/index.ts"],
  platform: "node",
  bundle: true,
  format: "esm",
  outdir: "dist",
  metafile: true,
  // xlsx-js-style is bundled as CommonJS and calls require("stream") at load
  // time. An ESM bundle has no `require`, so esbuild's __require shim throws
  // "Dynamic require of \"stream\" is not supported" and the server dies at
  // boot. Defining a real require from import.meta.url makes that shim delegate
  // to Node instead of throwing.
  banner: {
    js: [
      'import { createRequire as __nodeCreateRequire } from "node:module";',
      "const require = __nodeCreateRequire(import.meta.url);",
    ].join("\n"),
  },
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

          // Node built-ins and every other package stay as runtime externals.
          return { path: args.path, external: true };
        });
      },
    },
  ],
});

await writeFile("dist/server-build-meta.json", JSON.stringify(result.metafile), "utf8");

// Render has repeatedly shown that a named ESM import can survive into the
// emitted artifact despite the resolver policy above. Node cannot reliably
// expose arbitrary CommonJS properties as named ESM exports, but it always
// supports the default import. Rewrite only the exact xlsx-js-style named
// imports that survive the build, preserving the local aliases esbuild chose.
let output = await readFile("dist/index.js", "utf8");
let xlsxInteropRewriteCount = 0;
const xlsxNamedImport =
  /import\s*\{\s*read\s+as\s+([A-Za-z_$][\w$]*)\s*,\s*utils\s+as\s+([A-Za-z_$][\w$]*)\s*,\s*write\s+as\s+([A-Za-z_$][\w$]*)\s*\}\s*from\s*["']xlsx-js-style["'];?/g;

output = output.replace(xlsxNamedImport, (_match, readName, utilsName, writeName) => {
  const pkgName = `xlsxJsStyleCompat${xlsxInteropRewriteCount++}`;
  return `import ${pkgName} from "xlsx-js-style";\nconst { read: ${readName}, utils: ${utilsName}, write: ${writeName} } = ${pkgName};`;
});

if (xlsxInteropRewriteCount > 0) {
  await writeFile("dist/index.js", output, "utf8");
  console.log(`Rewrote ${xlsxInteropRewriteCount} xlsx-js-style named import(s) for CommonJS runtime compatibility`);
}

// Refuse to publish artifacts that can reproduce the known startup crashes.
const unresolvedDecimalImport =
  /(?:from\s*["']decimal\.js["']|import\s*\(\s*["']decimal\.js["']\s*\)|node_modules\/decimal\.js\/index\.js)/;
const unresolvedXlsxNamedImport =
  /import\s*\{[^}]*\}\s*from\s*["']xlsx-js-style["']/;

if (unresolvedDecimalImport.test(output)) {
  throw new Error(
    "Production bundle still contains a runtime decimal.js import; refusing to publish a broken Render artifact.",
  );
}

if (unresolvedXlsxNamedImport.test(output)) {
  throw new Error(
    "Production bundle still contains a named xlsx-js-style runtime import; refusing to publish a broken Render artifact.",
  );
}

console.log("Server bundle verified: xlsx-js-style has safe CommonJS interop and decimal.js is embedded");
