import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const lines = (file) => read(file).split(/\r?\n/).length;

const facade = read("server/chat/reports.ts");
const chatService = read("server/chatService.ts");
const dispatcher = read("server/chat/reports/domains/reportDomainDispatcher.ts");

const failures = [];
if (lines("server/chat/reports.ts") > 30) failures.push("server/chat/reports.ts must remain a thin facade");
if (!facade.includes("dispatchDataQuery")) failures.push("report facade must delegate to the domain dispatcher");
if (!chatService.includes('from "./chat/reports"')) failures.push("chatService must use the stable report facade");
if ((chatService.match(/runDataQuery/g) || []).length < 2) failures.push("chatService report gateway wiring is missing");
if (chatService.includes("switch (params.queryType)")) failures.push("chatService must not own report dispatch logic");
if (!dispatcher.includes("reportDomains")) failures.push("domain registry is missing");
if (!dispatcher.includes("runLegacyDataQuery")) failures.push("compatibility fallback is missing");

const domainFiles = fs.readdirSync(path.join(root, "server/chat/reports/domains"))
  .filter((name) => name.endsWith("ReportDomain.ts"));
if (domainFiles.length < 7) failures.push("expected at least seven focused report domains");

const seen = new Map();
for (const file of domainFiles) {
  const source = read(path.join("server/chat/reports/domains", file));
  for (const match of source.matchAll(/"([a-z0-9_]+)"/g)) {
    const queryType = match[1];
    if (queryType === "accounting" || queryType === "inventory" || queryType === "factory" || queryType === "containers" || queryType === "sales" || queryType === "operations") continue;
    const owner = seen.get(queryType);
    if (owner) failures.push(`duplicate report ownership for ${queryType}: ${owner}, ${file}`);
    seen.set(queryType, file);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`Phase 6 chat report domains verified (${seen.size} classified query types).`);
