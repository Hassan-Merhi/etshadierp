import fs from "node:fs";

const indexPath = "server/index.ts";
const startupModulePath = "server/startup/runServerStartupMigrations.ts";
const configPath = "config/god-file-boundaries.json";
const testPath = "tests/god-file-boundaries.test.ts";
const docs = ["docs/god-file-split-program.md", "docs/system-quality-program.md"];

let source = fs.readFileSync(indexPath, "utf8");
const runStartMarker = "  const runMigrations = async () => {";
const warmupMarker = "  // Pre-warm the DB connection pool so the first user request";
const puppeteerMarker = "  // Ensure Puppeteer's Chrome binary is present before the server starts";
const runStart = source.indexOf(runStartMarker);
const warmupStart = source.indexOf(warmupMarker, runStart);
const puppeteerStart = source.indexOf(puppeteerMarker, warmupStart);
if (runStart < 0 || warmupStart < 0 || puppeteerStart < 0) {
  throw new Error("Wave 7 could not find the startup migration/warmup extraction markers");
}

let runBlock = source.slice(runStart, warmupStart);
let warmupBlock = source.slice(warmupStart, puppeteerStart);
runBlock = runBlock.replace(
  "  const runMigrations = async () => {",
  "export async function runStartupMigrations(migrations: readonly string[], onComplete: () => void) {"
);
runBlock = runBlock.replace("      migrationsDone = true;", "      onComplete();");
runBlock = runBlock.replace(/\n  };\n\n$/, "\n}\n\n");
warmupBlock = warmupBlock.replace("  const warmupDb = async () => {", "export async function warmupDb() {");
warmupBlock = warmupBlock.replace(/\n  };\n\n$/, "\n}\n\n");

const moduleSource = `import { Client } from "pg";\n\nimport { pool } from "../db";\nimport { getErrorMessage } from "../lib/httpHandlers";\nimport { logger } from "../lib/logger";\nimport { resolveDatabaseSsl } from "../lib/databaseSsl.mjs";\nimport { markStartupMigrationsComplete, recordStartupMigrationFailures } from "../startupMigrationReport";\n\n${runBlock}${warmupBlock}`;
fs.mkdirSync("server/startup", { recursive: true });
fs.writeFileSync(startupModulePath, moduleSource);

source = source.slice(0, runStart) +
  `  const runMigrations = () =>\n    runStartupMigrations(migrations, () => {\n      migrationsDone = true;\n    });\n\n` +
  source.slice(puppeteerStart);
source = source.replace('import { Client } from "pg";\n', "");
const startupImportAnchor = 'import { startupMigrations, ensureCanonicalStockMovementJournal } from "./startup-schema";';
if (!source.includes(startupImportAnchor)) throw new Error("Wave 7 missing startup import anchor");
source = source.replace(
  startupImportAnchor,
  `${startupImportAnchor}\nimport { runStartupMigrations, warmupDb } from "./startup/runServerStartupMigrations";`
);
fs.writeFileSync(indexPath, source);

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
if (config.version !== 31) throw new Error(`Expected god-file boundary v31, found v${config.version}`);
if (!("server/index.ts" in config.repositoryScan.grandfathered)) {
  throw new Error("server/index.ts is not grandfathered before Wave 7");
}
config.version = 32;
delete config.repositoryScan.grandfathered["server/index.ts"];
config.description =
  "Version 32 completes cumulative Wave 7 by extracting startup migration execution and DB warmup from server/index.ts into server/startup/runServerStartupMigrations.ts, permanently retiring server/index.ts from the grandfathered backlog while preserving startup order and behavior. " +
  config.description;
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

let test = fs.readFileSync(testPath, "utf8");
test = test.replace("expect(report.version).toBe(31);", "expect(report.version).toBe(32);");
test = test.replace("toBeLessThanOrEqual(2);", "toBeLessThanOrEqual(1);");
test = test.replace("toBeLessThanOrEqual(1896);", "toBeLessThanOrEqual(1076);");
fs.writeFileSync(testPath, test);

for (const doc of docs) {
  if (!fs.existsSync(doc)) continue;
  let text = fs.readFileSync(doc, "utf8");
  text = text.replace(/Backlog: 2 files, 1,896 lines over the limit/g, "Backlog: 1 file, 1,076 lines over the limit");
  text = text.replace(/2 files, 1,896 lines over the limit/g, "1 file, 1,076 lines over the limit");
  text = text.replace(/2 files and 1,896/g, "1 file and 1,076");
  fs.writeFileSync(doc, text);
}

const countLines = (file) => fs.readFileSync(file, "utf8").split(/\r?\n/).length;
const indexLines = countLines(indexPath);
const startupLines = countLines(startupModulePath);
console.log(`WAVE7_SIZES server/index.ts=${indexLines} ${startupModulePath}=${startupLines}`);
if (indexLines > 900) throw new Error(`server/index.ts remains oversized at ${indexLines} lines`);
if (startupLines > 900) throw new Error(`${startupModulePath} is oversized at ${startupLines} lines`);
if (config.repositoryScan.grandfathered["server/chatService.ts"] === undefined) {
  throw new Error("Wave 7 unexpectedly removed the final chatService ratchet");
}
if (Object.keys(config.repositoryScan.grandfathered).length !== 1) {
  throw new Error(`Expected exactly one grandfathered file after Wave 7, found ${Object.keys(config.repositoryScan.grandfathered).length}`);
}
console.log("WAVE7_RATCHET version=32 grandfathered=server/chatService.ts expectedExcess=1076");
