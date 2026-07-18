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

function tokenizeModuleSyntax(source) {
  const tokens = [];
  let index = 0;

  const isIdentifierStart = (char) => /[A-Za-z_$]/.test(char);
  const isIdentifierPart = (char) => /[A-Za-z0-9_$]/.test(char);

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === "/" && next === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
      index += 2;
      continue;
    }

    if (char === "`" ) {
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
          continue;
        }
        if (source[index] === "`") {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      const quote = char;
      let value = "";
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") {
          value += source[index];
          if (index + 1 < source.length) value += source[index + 1];
          index += 2;
          continue;
        }
        if (source[index] === quote) {
          index += 1;
          break;
        }
        value += source[index];
        index += 1;
      }
      tokens.push({ type: "string", value });
      continue;
    }

    if (isIdentifierStart(char)) {
      let value = char;
      index += 1;
      while (index < source.length && isIdentifierPart(source[index])) {
        value += source[index];
        index += 1;
      }
      tokens.push({ type: "identifier", value });
      continue;
    }

    tokens.push({ type: "punctuator", value: char });
    index += 1;
  }

  return tokens;
}

function collectRuntimeImports(source) {
  const tokens = tokenizeModuleSyntax(source);
  const imports = new Set();

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "identifier") continue;

    if (token.value === "require" && tokens[index + 1]?.value === "(" && tokens[index + 2]?.type === "string") {
      imports.add(tokens[index + 2].value);
      continue;
    }

    if (token.value === "import") {
      if (tokens[index + 1]?.type === "string") {
        imports.add(tokens[index + 1].value);
        continue;
      }
      if (tokens[index + 1]?.value === "(" && tokens[index + 2]?.type === "string") {
        imports.add(tokens[index + 2].value);
        continue;
      }
    }

    if (token.value === "import" || token.value === "export") {
      for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
        const candidate = tokens[cursor];
        if (candidate.value === ";") break;
        if (candidate.type === "identifier" && candidate.value === "from" && tokens[cursor + 1]?.type === "string") {
          imports.add(tokens[cursor + 1].value);
          break;
        }
      }
    }
  }

  return imports;
}

function isInternalSpecifier(specifier, builtins) {
  return (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("@/") ||
    specifier.startsWith("#") ||
    specifier.startsWith("file:") ||
    specifier.startsWith("data:") ||
    specifier.startsWith("http:") ||
    specifier.startsWith("https:") ||
    builtins.has(specifier)
  );
}

const errors = [];
for (const file of requiredFiles) {
  if (!existsSync(file)) errors.push(`Missing production runtime file: ${file.replace(`${root}/`, "")}`);
}

if (existsSync(bundlePath)) {
  const source = readFileSync(bundlePath, "utf8");
  const imports = collectRuntimeImports(source);
  const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
  const declared = new Set(Object.keys(packageJson.dependencies ?? {}));
  const require = createRequire(import.meta.url);

  for (const specifier of imports) {
    if (isInternalSpecifier(specifier, builtins)) continue;
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
