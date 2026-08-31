/**
 * Server build script — wraps esbuild CLI behaviour with targeted runtime
 * dependency bundling for packages that are unsafe to leave as external ESM
 * imports on Render.
 *
 * decimal.js is bundled because historical package-lock registry URLs can make
 * the runtime dependency unavailable on Render.
 *
 * xlsx-js-style is CommonJS. Keep it external so Node loads its own CommonJS
 * entry instead of asking esbuild to convert its dynamic built-in requires
 * into an ESM bundle, and harden the final artifact against named imports.
 *
 * archiver v8 is ESM-only and no longer exposes the legacy default factory
 * export. Keep it external like the other runtime packages, but normalize any
 * surviving legacy default import in the emitted artifact to the v8
 * ZipArchive constructor before publishing.
 *
 * All other npm packages remain external.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Resolve decimal.js to its ESM entry file (decimal.mjs) so esbuild can
// bundle it as a native ESM chunk rather than wrapping a CJS module.
const pkgRoot = fileURLToPath(new URL("../node_modules/decimal.js/", import.meta.url));
const decimalEntry = resolve(pkgRoot, "decimal.mjs");

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
            return { path: args.path, external: true };
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

// archiver v8 removed the default callable factory used by v7. If a legacy
// default import survives into the server artifact, replace that import with a
// small v8-compatible ZIP factory. The application only uses the legacy factory
// for ZIP archives, so reject any unexpected format rather than silently
// changing behaviour.
let archiverInteropRewriteCount = 0;
const archiverDefaultImport =
  /import\s+([A-Za-z_$][\w$]*)\s+from\s*["']archiver["'];?/g;

output = output.replace(archiverDefaultImport, (_match, localName) => {
  const zipArchiveName = `ArchiverZipArchiveCompat${archiverInteropRewriteCount++}`;
  return [
    `import { ZipArchive as ${zipArchiveName} } from "archiver";`,
    `const ${localName} = (format, options) => {`,
    `  if (format !== "zip") throw new Error(\`Unsupported archiver format: \${format}\`);`,
    `  return new ${zipArchiveName}(options);`,
    `};`,
  ].join("\n");
});

if (xlsxInteropRewriteCount > 0 || archiverInteropRewriteCount > 0) {
  await writeFile("dist/index.js", output, "utf8");
}

if (xlsxInteropRewriteCount > 0) {
  console.log(`Rewrote ${xlsxInteropRewriteCount} xlsx-js-style named import(s) for CommonJS runtime compatibility`);
}

if (archiverInteropRewriteCount > 0) {
  console.log(`Rewrote ${archiverInteropRewriteCount} archiver default import(s) for v8 ESM compatibility`);
}

// Refuse to publish artifacts that can reproduce the known startup crashes.
const unresolvedDecimalImport =
  /(?:from\s*["']decimal\.js["']|import\s*\(\s*["']decimal\.js["']\s*\)|node_modules\/decimal\.js\/index\.js)/;
const unresolvedXlsxNamedImport =
  /import\s*\{[^}]*\}\s*from\s*["']xlsx-js-style["']/;
const unresolvedArchiverDefaultImport =
  /import\s+[A-Za-z_$][\w$]*\s+from\s*["']archiver["']/;

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

if (unresolvedArchiverDefaultImport.test(output)) {
  throw new Error(
    "Production bundle still contains an archiver default import; refusing to publish an archiver v8-incompatible artifact.",
  );
}

console.log("Server bundle verified: xlsx-js-style and archiver have safe runtime interop, and decimal.js is embedded");
