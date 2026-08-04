import crypto from "node:crypto";
import fs from "node:fs";

import { startupMigrations } from "../server/startup-schema/index.ts";

const testPath = "tests/startup-schema-integrity.test.ts";
let source = fs.readFileSync(testPath, "utf8");
const count = startupMigrations.length;
const hash = crypto.createHash("sha256").update(JSON.stringify(startupMigrations)).digest("hex");

source = source.replace(/const EXPECTED_STATEMENT_COUNT = \d+;/, `const EXPECTED_STATEMENT_COUNT = ${count};`);
source = source.replace(
  /const EXPECTED_CONTENT_HASH = "[a-f0-9]+";/,
  `const EXPECTED_CONTENT_HASH = "${hash}";`
);
fs.writeFileSync(testPath, source);
console.log(`Updated startup schema integrity: ${count} statements, ${hash}`);
