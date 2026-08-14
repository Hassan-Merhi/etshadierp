#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const workerPath = "scripts/phase4-bridge-worker.mjs";
const original = fs.readFileSync(workerPath, "utf8");
const oldTarget = `function targetFor(node) {
  const expected = expectedTypeText(node);
  if (!expected || expected === "unknown") return null;
  const source = printType(checker.getTypeAtLocation(node.expression), node);
  if (source && source !== "never" && source !== expected) {
    const intersection = safeTypeText(\`(\${source}) & (\${expected})\`);
    if (intersection) return intersection;
  }
  return safeTypeText(expected);
}`;
const newTarget = `function targetFor(node) {
  const expected = expectedTypeText(node);
  if (!expected || expected === "unknown") return null;
  return safeTypeText(expected);
}`;

if (!original.includes(oldTarget)) {
  throw new Error("phase4-bridge-worker targetFor implementation changed; expected-only runner needs review");
}

fs.writeFileSync(workerPath, original.replace(oldTarget, newTarget));
let status = 1;
try {
  const result = spawnSync(process.execPath, [workerPath], {
    stdio: "inherit",
    maxBuffer: 128 * 1024 * 1024,
  });
  status = result.status ?? 1;
} finally {
  fs.writeFileSync(workerPath, original);
}

process.exit(status);
