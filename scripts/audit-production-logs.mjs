import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const serverRoot = path.join(root, "server");
const jsonOutput = process.argv.includes("--json");

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const IGNORED_SUFFIXES = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"];

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      files.push(...walk(absolute));
      continue;
    }
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
    if (IGNORED_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) continue;
    files.push(absolute);
  }
  return files;
}

function classify(message) {
  const value = message.toLowerCase();
  if (/auth|session|access.denied|permission|login/.test(value)) return "authentication_security";
  if (/bandwidth|response.bytes|large.http|endpoint.performance/.test(value)) return "bandwidth_performance";
  if (/slow.request|runtime.pressure|memory|event.loop|health/.test(value)) return "runtime_health";
  if (/whatsapp|green.api|upload|invoice|pdf/.test(value)) return "external_integration";
  if (/sale|voucher|container|tracking|payment|stock.transfer|offload/.test(value)) return "business_activity";
  if (/inventory|ledger.account|supplier|customer|employee|reference/.test(value)) return "reference_data";
  if (/database|query|pool|drizzle|postgres/.test(value)) return "database";
  if (/started|starting|debug|cache|poll/.test(value)) return "debug_lifecycle";
  if (/http|request|route|status/.test(value)) return "http_request";
  return "other";
}

function extractMessages(source) {
  const matches = [];
  const patterns = [
    /logger\.(debug|info|warn|error)\(\s*(["'`])([^\n]*?)\2/g,
    /console\.(log|info|warn|error|debug)\(\s*(["'`])([^\n]*?)\2/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      matches.push({ level: match[1], message: match[3] });
    }
  }
  return matches;
}

const report = {
  scannedAt: new Date().toISOString(),
  filesScanned: 0,
  loggerCalls: 0,
  directConsoleCalls: 0,
  bracketPrefixedMessages: 0,
  lifecycleStartMessages: 0,
  embeddedJsonMessages: 0,
  categories: {},
  directConsoleFiles: [],
  examples: {},
};

if (!fs.existsSync(serverRoot)) {
  console.error("server directory was not found; run this script from the repository root.");
  process.exit(1);
}

for (const file of walk(serverRoot)) {
  report.filesScanned += 1;
  const relative = path.relative(root, file).replaceAll(path.sep, "/");
  const source = fs.readFileSync(file, "utf8");
  const directConsoleCount = (source.match(/console\.(?:log|info|warn|error|debug)\s*\(/g) || []).length;
  if (directConsoleCount > 0 && relative !== "server/lib/logger.ts") {
    report.directConsoleCalls += directConsoleCount;
    report.directConsoleFiles.push({ file: relative, count: directConsoleCount });
  }

  const loggerCount = (source.match(/logger\.(?:debug|info|warn|error)\s*\(/g) || []).length;
  report.loggerCalls += loggerCount;

  for (const entry of extractMessages(source)) {
    const category = classify(entry.message);
    report.categories[category] = (report.categories[category] || 0) + 1;
    if (/^\[[^\]]+\]/.test(entry.message)) report.bracketPrefixedMessages += 1;
    if (/\b(started|starting)\b/i.test(entry.message)) report.lifecycleStartMessages += 1;
    if (/^\{.*\}$/.test(entry.message.trim())) report.embeddedJsonMessages += 1;
    if (!report.examples[category]) report.examples[category] = [];
    if (report.examples[category].length < 3) {
      report.examples[category].push({ file: relative, level: entry.level, message: entry.message.slice(0, 180) });
    }
  }
}

report.directConsoleFiles.sort((left, right) => right.count - left.count || left.file.localeCompare(right.file));
report.directConsoleFiles = report.directConsoleFiles.slice(0, 25);

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

console.log("Production log audit");
console.log("====================");
console.log(`Files scanned: ${report.filesScanned}`);
console.log(`Shared logger calls: ${report.loggerCalls}`);
console.log(`Direct console calls outside shared logger: ${report.directConsoleCalls}`);
console.log(`Bracket-prefixed messages: ${report.bracketPrefixedMessages}`);
console.log(`Lifecycle start messages: ${report.lifecycleStartMessages}`);
console.log(`Embedded JSON messages: ${report.embeddedJsonMessages}`);
console.log("");
console.log("Classifications:");
for (const [category, count] of Object.entries(report.categories).sort((a, b) => b[1] - a[1])) {
  console.log(`- ${category}: ${count}`);
}

if (report.directConsoleFiles.length > 0) {
  console.log("");
  console.log("Highest direct-console sources:");
  for (const entry of report.directConsoleFiles.slice(0, 10)) {
    console.log(`- ${entry.file}: ${entry.count}`);
  }
}

console.log("");
console.log("Use --json for machine-readable output.");
