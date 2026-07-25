#!/usr/bin/env node
import fs from "node:fs";

const failures = [];

const read = (path) => fs.readFileSync(path, "utf8");
const activeEnvLines = (source) =>
  source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

const rootProduction = read(".env.production");
const clientProduction = read("client/.env.production");
const capacitorEnv = read("client/.env.capacitor");
const gitignore = read(".gitignore");
const pkg = JSON.parse(read("package.json"));
const serviceWorker = read("client/public/sw.js");
const main = read("client/src/main.tsx");
const indexHtml = read("client/index.html");

for (const [label, source] of [
  ["root production env", rootProduction],
  ["client production env", clientProduction],
]) {
  const active = activeEnvLines(source);
  for (const key of ["VITE_API_BASE_URL=", "VITE_WS_URL="]) {
    if (active.some((line) => line.startsWith(key))) {
      failures.push(`${label} must not define ${key.slice(0, -1)}; browser production must stay same-origin`);
    }
  }
}

const capacitorLines = activeEnvLines(capacitorEnv);
for (const expected of [
  "VITE_API_BASE_URL=https://www.hmdinternationalgroup.com",
  "VITE_WS_URL=wss://www.hmdinternationalgroup.com/ws",
]) {
  if (!capacitorLines.includes(expected)) failures.push(`Capacitor env missing: ${expected}`);
}

if (pkg.scripts?.["build:cap"] !== "vite build --mode capacitor") {
  failures.push("build:cap must use Vite capacitor mode");
}

if (pkg.scripts?.build?.includes("--mode capacitor")) {
  failures.push("standard web build must not use Capacitor mode");
}

if (!gitignore.includes("!client/.env.capacitor")) {
  failures.push("client/.env.capacitor must remain tracked");
}

for (const token of [
  'const CACHE_VERSION = "erp-v9"',
  'const CACHE_PREFIX = "erp-"',
  'type: "SW_UPDATED", version: CACHE_VERSION',
  'event.data?.type === "CLEAR_APP_CACHES"',
  'type: "APP_CACHES_CLEARED"',
  'key.startsWith(CACHE_PREFIX)',
  'fetch(request.clone(), { cache: "no-store" })',
  'await cache.put("/", response.clone())',
  'contentType.includes("text/html")',
]) {
  if (!serviceWorker.includes(token)) failures.push(`Service-worker recovery contract missing: ${token}`);
}

for (const token of [
  'const ASSET_RECOVERY_PREFIX = "assetRecovery:"',
  'const SW_RELOAD_PREFIX = "swReload:"',
  'const RECOVERY_STABLE_MS = 10_000',
  'event.preventDefault()',
  'type: "CLEAR_APP_CACHES"',
  'currentUrl.searchParams.set("_asset_recovery"',
  'url.searchParams.set("_sw", version)',
  'showStaleAssetRecoveryMessage()',
  'removeRecoveryMarkersAfterStableLoad()',
]) {
  if (!main.includes(token)) failures.push(`Client stale-asset recovery contract missing: ${token}`);
}

for (const token of [
  "register('/sw.js', { updateViaCache: 'none' })",
  "return navigator.serviceWorker.register('/sw.js')",
]) {
  if (!indexHtml.includes(token)) failures.push(`Service-worker registration contract missing: ${token}`);
}

if (failures.length) {
  console.error("Mobile/web compatibility verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Mobile/web routing and cache-recovery contracts verified.");
