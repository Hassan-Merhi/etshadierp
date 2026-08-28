import fs from "node:fs/promises";
import path from "node:path";

const token = process.env.GH_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;

if (!token) throw new Error("GH_TOKEN is required");
if (!repository || !repository.includes("/")) throw new Error("GITHUB_REPOSITORY is required");

const [owner, repo] = repository.split("/");
const apiBase = "https://api.github.com";
const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "etshadierp-codeql-phase1-inventory",
};

async function ghJson(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status} ${response.statusText}: ${body}`);
  }
  return response.json();
}

async function mainSha() {
  const data = await ghJson(`${apiBase}/repos/${owner}/${repo}/git/ref/heads/main`);
  return data.object.sha;
}

async function fetchOpenAlerts() {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const startSha = await mainSha();
    const alerts = [];
    let page = 1;

    while (true) {
      const url = new URL(`${apiBase}/repos/${owner}/${repo}/code-scanning/alerts`);
      url.searchParams.set("state", "open");
      url.searchParams.set("ref", "refs/heads/main");
      url.searchParams.set("per_page", "100");
      url.searchParams.set("page", String(page));
      const batch = await ghJson(url);
      alerts.push(...batch);
      if (batch.length < 100) break;
      page += 1;
      if (page > 100) throw new Error("Refusing to paginate beyond 10,000 code-scanning alerts");
    }

    const endSha = await mainSha();
    if (startSha === endSha) {
      return { alerts, mainSha: startSha, pages: page };
    }

    console.log(`main moved during inventory attempt ${attempt}: ${startSha} -> ${endSha}; retrying`);
  }

  throw new Error("main kept moving during CodeQL inventory; retry when the branch is stable");
}

const severityOrder = new Map([
  ["critical", 0],
  ["high", 1],
  ["medium", 2],
  ["low", 3],
  ["error", 4],
  ["warning", 5],
  ["note", 6],
  ["unknown", 7],
]);

function normalizedSeverity(alert) {
  const security = String(alert.rule?.security_severity_level ?? "").toLowerCase();
  if (["critical", "high", "medium", "low"].includes(security)) return security;
  const base = String(alert.rule?.severity ?? "unknown").toLowerCase();
  return ["error", "warning", "note"].includes(base) ? base : "unknown";
}

function moduleFor(filePath) {
  if (!filePath) return "(no-path)";
  const parts = filePath.split("/").filter(Boolean);
  if (parts[0] === "server" && parts[1] === "routes") return `server/routes/${parts[2] ?? "(root)"}`;
  if (parts[0] === "server" && parts[1] === "services") return `server/services/${parts[2] ?? "(root)"}`;
  if (parts[0] === "server" && parts[1] === "storage") return `server/storage/${parts[2] ?? "(root)"}`;
  if (parts[0] === "server") return `server/${parts[1] ?? "(root)"}`;
  if (parts[0] === "client" && parts[1] === "src") return `client/src/${parts[2] ?? "(root)"}`;
  if (parts[0] === "client") return `client/${parts[1] ?? "(root)"}`;
  if (parts[0] === "shared") return `shared/${parts[1] ?? "(root)"}`;
  if (parts[0] === "tests") return `tests/${parts[1] ?? "(root)"}`;
  if (parts[0] === "scripts") return `scripts/${parts[1] ?? "(root)"}`;
  if (parts[0] === ".github") return `.github/${parts[1] ?? "(root)"}`;
  return parts.slice(0, Math.min(2, parts.length)).join("/") || "(root)";
}

function cwesFor(alert) {
  return (alert.rule?.tags ?? [])
    .filter((tag) => /^external\/cwe\/cwe-\d+$/i.test(tag))
    .map((tag) => tag.split("/").at(-1).toUpperCase());
}

function isCodeQL(alert) {
  return String(alert.tool?.name ?? "").toLowerCase().includes("codeql");
}

function inc(map, key, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function sortedEntries(map) {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function groupRules(alerts) {
  const groups = new Map();
  for (const alert of alerts) {
    const key = `${alert.toolName}::${alert.ruleId}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        toolName: alert.toolName,
        ruleId: alert.ruleId,
        ruleName: alert.ruleName,
        ruleDescription: alert.ruleDescription,
        severity: alert.severity,
        count: 0,
        modules: new Map(),
        files: new Map(),
        cwes: new Set(),
      };
      groups.set(key, group);
    }
    group.count += 1;
    inc(group.modules, alert.module);
    inc(group.files, alert.path || "(no-path)");
    for (const cwe of alert.cwes) group.cwes.add(cwe);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      modules: sortedEntries(group.modules).map(([name, count]) => ({ name, count })),
      files: sortedEntries(group.files).map(([name, count]) => ({ name, count })),
      cwes: [...group.cwes].sort(),
    }))
    .sort((a, b) => {
      const severityDelta = (severityOrder.get(a.severity) ?? 99) - (severityOrder.get(b.severity) ?? 99);
      return severityDelta || b.count - a.count || a.ruleId.localeCompare(b.ruleId);
    });
}

function mapObject(map) {
  return Object.fromEntries(sortedEntries(map));
}

function escapeTable(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function markdownTable(headers, rows) {
  const head = `| ${headers.join(" | ")} |`;
  const rule = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map(escapeTable).join(" | ")} |`).join("\n");
  return [head, rule, body].filter(Boolean).join("\n");
}

const snapshot = await fetchOpenAlerts();
const seen = new Set();
const duplicates = [];
const normalized = [];

for (const alert of snapshot.alerts) {
  if (seen.has(alert.number)) duplicates.push(alert.number);
  seen.add(alert.number);
  const instance = alert.most_recent_instance ?? {};
  const location = instance.location ?? {};
  const filePath = location.path ?? "";
  normalized.push({
    number: alert.number,
    htmlUrl: alert.html_url,
    state: alert.state,
    toolName: alert.tool?.name ?? "unknown",
    toolGuid: alert.tool?.guid ?? null,
    ruleId: alert.rule?.id ?? "unknown",
    ruleName: alert.rule?.name ?? alert.rule?.id ?? "unknown",
    ruleDescription: alert.rule?.description ?? "",
    ruleSeverity: String(alert.rule?.severity ?? "unknown").toLowerCase(),
    securitySeverityLevel: alert.rule?.security_severity_level ?? null,
    severity: normalizedSeverity(alert),
    cwes: cwesFor(alert),
    path: filePath,
    module: moduleFor(filePath),
    startLine: location.start_line ?? null,
    endLine: location.end_line ?? null,
    ref: instance.ref ?? null,
    commitSha: instance.commit_sha ?? null,
    createdAt: alert.created_at ?? null,
    updatedAt: alert.updated_at ?? null,
  });
}

const byTool = new Map();
const bySeverity = new Map();
const byModule = new Map();
const byFile = new Map();
for (const alert of normalized) {
  inc(byTool, alert.toolName);
  inc(bySeverity, alert.severity);
  inc(byModule, alert.module);
  inc(byFile, alert.path || "(no-path)");
}

const codeql = normalized.filter((alert) => alert.toolName.toLowerCase().includes("codeql"));
const codeqlBySeverity = new Map();
const codeqlByModule = new Map();
const codeqlFiles = new Set();
for (const alert of codeql) {
  inc(codeqlBySeverity, alert.severity);
  inc(codeqlByModule, alert.module);
  codeqlFiles.add(alert.path || "(no-path)");
}

const ruleGroups = groupRules(normalized);
const codeqlRuleGroups = ruleGroups.filter((group) => group.toolName.toLowerCase().includes("codeql"));
const criticalTypeConfusion = codeql.filter(
  (alert) =>
    alert.severity === "critical" &&
    (`${alert.ruleName} ${alert.ruleDescription} ${alert.ruleId}`).toLowerCase().includes("type confusion")
);
const criticalCodeql = codeql.filter((alert) => alert.severity === "critical");
const remainingCritical = criticalCodeql.length - criticalTypeConfusion.length;

const generatedAt = new Date().toISOString();
const summary = {
  generatedAt,
  repository,
  mainSha: snapshot.mainSha,
  pagesFetched: snapshot.pages,
  openCodeScanningAlerts: normalized.length,
  uniqueAlertNumbers: seen.size,
  duplicateAlertNumbers: duplicates,
  codeqlOpenAlerts: codeql.length,
  nonCodeqlOpenAlerts: normalized.length - codeql.length,
  uniqueCodeqlRules: new Set(codeql.map((alert) => alert.ruleId)).size,
  uniqueCodeqlFiles: codeqlFiles.size,
  uniqueCodeqlModules: codeqlByModule.size,
  codeqlBySeverity: mapObject(codeqlBySeverity),
  allTools: mapObject(byTool),
  phaseTargets: {
    phase2CriticalTypeConfusion: criticalTypeConfusion.length,
    phase3RemainingCritical: remainingCritical,
    phase4High: codeqlBySeverity.get("high") ?? 0,
    phase5Medium: codeqlBySeverity.get("medium") ?? 0,
    phase6LowAndNonSecurity: [...codeqlBySeverity.entries()]
      .filter(([severity]) => !["critical", "high", "medium"].includes(severity))
      .reduce((sum, [, count]) => sum + count, 0),
  },
};

const inventory = {
  schemaVersion: 1,
  summary,
  counts: {
    allBySeverity: mapObject(bySeverity),
    allByModule: mapObject(byModule),
    allByFile: mapObject(byFile),
    codeqlBySeverity: mapObject(codeqlBySeverity),
    codeqlByModule: mapObject(codeqlByModule),
  },
  ruleGroups,
  alerts: normalized.sort((a, b) => {
    const severityDelta = (severityOrder.get(a.severity) ?? 99) - (severityOrder.get(b.severity) ?? 99);
    return severityDelta || a.ruleId.localeCompare(b.ruleId) || a.path.localeCompare(b.path) || a.number - b.number;
  }),
};

const reportLines = [];
reportLines.push("# CodeQL Phase 1 — Open Alert Inventory");
reportLines.push("");
reportLines.push(`Generated: \`${generatedAt}\``);
reportLines.push(`Repository: \`${repository}\``);
reportLines.push(`Main snapshot: \`${snapshot.mainSha}\``);
reportLines.push("");
reportLines.push("## Scope and completeness");
reportLines.push("");
reportLines.push(
  `The inventory paginated GitHub's code-scanning API with \`state=open\` and \`ref=refs/heads/main\`, then verified that \`main\` had not moved during collection. It fetched **${normalized.length}** open alerts across **${snapshot.pages}** page(s), with **${seen.size}** unique alert numbers and **${duplicates.length}** duplicate numbers.`
);
reportLines.push("");
reportLines.push(`CodeQL accounts for **${codeql.length}** open alerts; the remaining **${normalized.length - codeql.length}** are from other code-scanning tools.`);
reportLines.push("");
reportLines.push("## Tools");
reportLines.push("");
reportLines.push(markdownTable(["Tool", "Open alerts"], sortedEntries(byTool).map(([name, count]) => [name, count])));
reportLines.push("");
reportLines.push("## CodeQL severity inventory");
reportLines.push("");
reportLines.push(
  markdownTable(
    ["Severity", "Open alerts"],
    [...codeqlBySeverity.entries()]
      .sort((a, b) => (severityOrder.get(a[0]) ?? 99) - (severityOrder.get(b[0]) ?? 99) || b[1] - a[1])
      .map(([severity, count]) => [severity, count])
  )
);
reportLines.push("");
reportLines.push(`Unique CodeQL rules: **${summary.uniqueCodeqlRules}**  `);
reportLines.push(`Unique CodeQL files: **${summary.uniqueCodeqlFiles}**  `);
reportLines.push(`Unique CodeQL modules: **${summary.uniqueCodeqlModules}**`);
reportLines.push("");
reportLines.push("## Phase targets derived from the inventory");
reportLines.push("");
reportLines.push(
  markdownTable(
    ["Phase", "Target", "Current alert count"],
    [
      ["2", "Critical — type confusion / parameter tampering", criticalTypeConfusion.length],
      ["3", "Remaining Critical CodeQL rules", remainingCritical],
      ["4", "High CodeQL", codeqlBySeverity.get("high") ?? 0],
      ["5", "Medium CodeQL", codeqlBySeverity.get("medium") ?? 0],
      ["6", "Low + non-security severity + false-positive review", summary.phaseTargets.phase6LowAndNonSecurity],
      ["7", "Final re-scan and certification", "fresh main scan"],
    ]
  )
);
reportLines.push("");
reportLines.push("## Critical CodeQL rule groups");
reportLines.push("");
const criticalGroups = codeqlRuleGroups.filter((group) => group.severity === "critical");
reportLines.push(
  criticalGroups.length
    ? markdownTable(
        ["Rule", "Name", "Alerts", "Top modules", "CWEs"],
        criticalGroups.map((group) => [
          group.ruleId,
          group.ruleName,
          group.count,
          group.modules.slice(0, 5).map((entry) => `${entry.name} (${entry.count})`).join(", "),
          group.cwes.join(", ") || "—",
        ])
      )
    : "No Critical CodeQL rule groups are open."
);
reportLines.push("");
reportLines.push("## All CodeQL rule groups");
reportLines.push("");
reportLines.push(
  markdownTable(
    ["Severity", "Rule", "Name", "Alerts", "Files", "Top modules"],
    codeqlRuleGroups.map((group) => [
      group.severity,
      group.ruleId,
      group.ruleName,
      group.count,
      group.files.length,
      group.modules.slice(0, 4).map((entry) => `${entry.name} (${entry.count})`).join(", "),
    ])
  )
);
reportLines.push("");
reportLines.push("## CodeQL module groups");
reportLines.push("");
reportLines.push(markdownTable(["Module", "Open alerts"], sortedEntries(codeqlByModule).map(([name, count]) => [name, count])));
reportLines.push("");
reportLines.push("## Highest-density CodeQL files");
reportLines.push("");
const codeqlFileCounts = new Map();
for (const alert of codeql) inc(codeqlFileCounts, alert.path || "(no-path)");
reportLines.push(markdownTable(["File", "Open alerts"], sortedEntries(codeqlFileCounts).slice(0, 100).map(([name, count]) => [name, count])));
reportLines.push("");
reportLines.push("## Phase 1 completion criteria");
reportLines.push("");
reportLines.push("- [x] Enumerate every open code-scanning alert on `main` across all API pages.");
reportLines.push("- [x] Isolate the CodeQL subset.");
reportLines.push("- [x] Group CodeQL alerts by severity, rule, module, and file.");
reportLines.push("- [x] Derive Phase 2–7 remediation targets from the live snapshot.");
reportLines.push("- [x] Preserve normalized per-alert evidence in the JSON companion artifact.");
reportLines.push("- [x] Do not dismiss, suppress, or weaken any scanner finding.");
reportLines.push("");
reportLines.push("The JSON companion file is the machine-readable baseline for later phases. Alerts are expected to close through code fixes and fresh CodeQL analysis, not through bulk dismissal.");

const outDir = path.join(process.cwd(), "artifacts", "security");
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, "codeql-phase1-open-alerts.json"), `${JSON.stringify(inventory, null, 2)}\n`);
await fs.writeFile(path.join(outDir, "codeql-phase1-inventory.md"), `${reportLines.join("\n")}\n`);

console.log(JSON.stringify(summary, null, 2));
