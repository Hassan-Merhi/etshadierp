#!/usr/bin/env node
/**
 * verify-production-dependencies.mjs
 *
 * Smoke-tests that decimal.js can be imported and produces correct results.
 * Exits with status 1 on any failure so CI/prebuild catches missing or
 * broken packages before the expensive build runs.
 */
import { createRequire } from "module";

let Decimal;
try {
  // Use createRequire so this script works regardless of whether decimal.js
  // exposes a default CJS or ESM export, and without depending on the
  // package's own exports field.
  const require = createRequire(import.meta.url);
  const mod = require("decimal.js");
  Decimal = mod.default ?? mod;
} catch (err) {
  console.error("❌  PRODUCTION DEPENDENCY CHECK FAILED");
  console.error(`   Could not import decimal.js: ${err.message}`);
  process.exit(1);
}

const EXPECTED = "30.370368";
let result;
try {
  result = new Decimal("10.123456").times("3").toFixed(6);
} catch (err) {
  console.error("❌  PRODUCTION DEPENDENCY CHECK FAILED");
  console.error(`   decimal.js imported but calculation threw: ${err.message}`);
  process.exit(1);
}

if (result !== EXPECTED) {
  console.error("❌  PRODUCTION DEPENDENCY CHECK FAILED");
  console.error(`   decimal.js calculation returned "${result}", expected "${EXPECTED}"`);
  process.exit(1);
}

console.log(`✅  decimal.js production dependency OK: new Decimal("10.123456").times("3").toFixed(6) = ${result}`);
