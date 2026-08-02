#!/usr/bin/env node
/**
 * verify-env-documentation.mjs
 *
 * Fails when the server reads an environment variable that .env.example does
 * not mention, or when .env.example documents one nothing reads.
 *
 * Without this the file drifts silently: it described 4 variables while the
 * server read 94, so every operator had to grep the source to configure a
 * deployment. A guard is the only thing that keeps that from happening again.
 *
 * Usage:  node scripts/verify-env-documentation.mjs
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

const ROOT = resolve(process.cwd());
const SERVER_DIR = join(ROOT, "server");
const ENV_EXAMPLE = join(ROOT, ".env.example");

/**
 * Variables the platform injects or that belong to tooling rather than to
 * configuring a deployment. Documented in .env.example's closing section as
 * context, but never something an operator sets, so they are exempt from the
 * "must be documented" rule in both directions.
 */
const IGNORED = new Set([
  "NODE_ENV",
  "PORT",
  // Injected by the host platform.
  "RENDER_GIT_COMMIT",
  "RENDER_INSTANCE_ID",
  "REPL_ID",
  "REPL_SLUG",
]);

function collectSourceFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...collectSourceFiles(full));
    else if (/\.(ts|mjs)$/.test(entry) && !entry.endsWith(".d.ts")) found.push(full);
  }
  return found;
}

// Two access shapes appear in this codebase: `process.env.FOO` directly, and
// `env.FOO` where `env` is a NodeJS.ProcessEnv parameter (see
// server/lib/databaseConfig.ts). Matching only the first missed 9 variables.
const DIRECT = /process\.env\.([A-Z][A-Z_0-9]{2,})/g;
const ALIASED = /(?<![.\w])env\.([A-Z][A-Z_0-9]{2,})/g;

const used = new Map();
for (const file of collectSourceFiles(SERVER_DIR)) {
  const source = readFileSync(file, "utf8");
  for (const pattern of [DIRECT, ALIASED]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const name = match[1];
      if (IGNORED.has(name)) continue;
      if (!used.has(name)) used.set(name, file.replace(ROOT + "/", ""));
    }
  }
}

const exampleText = readFileSync(ENV_EXAMPLE, "utf8");
const documented = new Set(
  [...exampleText.matchAll(/^#?\s*([A-Z][A-Z_0-9]{2,})=/gm)].map((match) => match[1])
);
// Platform-injected vars are described in prose, not as assignments.
for (const match of exampleText.matchAll(/^#\s{3}([A-Z][A-Z_0-9]{2,})\s{2,}/gm)) {
  documented.add(match[1]);
}

const undocumented = [...used.keys()].filter((name) => !documented.has(name)).sort();
const stale = [...documented].filter((name) => !used.has(name) && !IGNORED.has(name)).sort();

if (undocumented.length === 0 && stale.length === 0) {
  console.log(`✅  Environment documentation check passed — ${used.size} variables, all documented in .env.example.`);
  process.exit(0);
}

console.error("\n❌  ENVIRONMENT DOCUMENTATION CHECK FAILED");

if (undocumented.length > 0) {
  console.error(`\n   ${undocumented.length} variable(s) read by the server but missing from .env.example:\n`);
  for (const name of undocumented) console.error(`   • ${name}  (first seen in ${used.get(name)})`);
  console.error("\n   Add each to .env.example with its default and what it does.");
}

if (stale.length > 0) {
  console.error(`\n   ${stale.length} variable(s) documented in .env.example but read nowhere:\n`);
  for (const name of stale) console.error(`   • ${name}`);
  console.error("\n   Remove these, or confirm they are still wired up.");
}

console.error("");
process.exit(1);
