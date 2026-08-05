import crypto from "node:crypto";
import fs from "node:fs";
import { startupMigrations } from "../server/startup-schema";

const path = "tests/startup-schema-integrity.test.ts";
let source = fs.readFileSync(path, "utf8");
const hash = crypto.createHash("sha256").update(JSON.stringify(startupMigrations)).digest("hex");
source = source.replace(
  /const EXPECTED_STATEMENT_COUNT = \d+;/,
  `const EXPECTED_STATEMENT_COUNT = ${startupMigrations.length};`
);
source = source.replace(
  /const EXPECTED_CONTENT_HASH = "[a-f0-9]+";/,
  `const EXPECTED_CONTENT_HASH = "${hash}";`
);
fs.writeFileSync(path, source);
console.log(JSON.stringify({ statementCount: startupMigrations.length, contentHash: hash }, null, 2));
