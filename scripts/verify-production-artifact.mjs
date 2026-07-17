#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { resolve } from "node:path";

const root = process.cwd();
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const bundlePath = resolve(root, "dist/index.js");
const requiredFiles = [
  bundlePath,
  resolve(root, "server/exportBufferBridge.mjs"),
  resolve(root, "server/scheduledAttachmentBridge.mjs"),
  resolve(root, "server/apiPaginationBridge.mjs"),
  resolve(root, "server/runtimeMemoryGuard.mjs"),
];

const errors = [];
for (const file of requiredFiles) {
  if (!existsSync(file)) errors.push(`Missing production runtime file: ${file.replace(`${root}/`, "")}`);
}

if (existsSync(bundlePath)) {
  const source = readFileSync(bundlePath, "utf8");
  const imports = new Set();
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) imports.add(match[1]);
  }

  const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
  const declared = new Set(Object.keys(packageJson.dependencies ?? {}));
  const require = createRequire(import.meta.url);

  for (const specifier of imports) {
    if (specifier.startsWith(".") || specifier.startsWith("/") || builtins.has(specifier)) continue;
    const packageName = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
    if (!declared.has(packageName)) {
      errors.push(`Runtime import ${specifier} is not declared in dependencies`);
      continue;
    }
    try {
      require.resolve(packageName);
    } catch (error) {
      errors.push(`Runtime dependency ${packageName} cannot be resolved: ${error.message}`);
    }
  }
}

if (errors.length) {
  console.error("PRODUCTION ARTIFACT VERIFICATION FAILED");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Production artifact verification passed: bundle, preload files, and runtime imports are deployable.");
