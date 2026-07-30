#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createReleaseEvidence } from "./releaseEvidencePolicy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policy = JSON.parse(fs.readFileSync(path.join(root, "config", "release-readiness.json"), "utf8"));
const commitArg = process.argv.find((argument) => argument.startsWith("--commit="));
const outputArg = process.argv.find((argument) => argument.startsWith("--output="));
const force = process.argv.includes("--force");
const commitSha = commitArg?.slice("--commit=".length) || process.env.RELEASE_EXPECTED_COMMIT || "";
const outputPath = path.resolve(root, outputArg?.slice("--output=".length) || "release-evidence.json");

if (fs.existsSync(outputPath) && !force) {
  console.error(`Refusing to overwrite ${path.relative(root, outputPath)} without --force.`);
  process.exit(2);
}

let evidence;
try {
  evidence = createReleaseEvidence(policy, commitSha);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error("Use --commit=<full-40-character-sha> or set RELEASE_EXPECTED_COMMIT.");
  process.exit(2);
}

fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(`Created release evidence template: ${path.relative(root, outputPath)}`);
console.log("The template is intentionally incomplete and cannot pass verification until every gate has evidence.");
