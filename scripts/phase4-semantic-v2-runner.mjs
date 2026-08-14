#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const workerPath = "scripts/phase4-semantic-worker.mjs";
const original = fs.readFileSync(workerPath, "utf8");

const queryableNeedle = `      for (const type of typeVariants) {
        add(\`as typeof \${innerText} & { \${prop}: \${type} }\`, \`property:\${prop}\`);
        add(\`as typeof \${innerText} & { \${prop}?: \${type} }\`, \`property-optional:\${prop}\`);
      }`;
const queryableReplacement = `      for (const type of typeVariants) {
        const requiredShape = \`typeof \${innerText} & { \${prop}: \${type} }\`;
        const optionalShape = \`typeof \${innerText} & { \${prop}?: \${type} }\`;
        add(\`as \${requiredShape}\`, \`property:\${prop}\`);
        add(\`as unknown as \${requiredShape}\`, \`property-double:\${prop}\`);
        add(\`as \${optionalShape}\`, \`property-optional:\${prop}\`);
        add(\`as unknown as \${optionalShape}\`, \`property-optional-double:\${prop}\`);
      }`;

const shapeNeedle = `      for (const type of typeVariants) add(\`as { \${prop}: \${type} }\`, \`property-shape:\${prop}\`);`;
const shapeReplacement = `      for (const type of typeVariants) {
        const shape = \`{ \${prop}: \${type} }\`;
        add(\`as \${shape}\`, \`property-shape:\${prop}\`);
        add(\`as unknown as \${shape}\`, \`property-shape-double:\${prop}\`);
      }`;

if (!original.includes(queryableNeedle) || !original.includes(shapeNeedle)) {
  throw new Error("phase4-semantic-worker structural option block changed; v2 runner needs review");
}

const patched = original.replace(queryableNeedle, queryableReplacement).replace(shapeNeedle, shapeReplacement);
fs.writeFileSync(workerPath, patched);
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
