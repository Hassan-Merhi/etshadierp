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

if (failures.length) {
  console.error("Mobile/web routing verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Mobile/web routing contracts verified.");
