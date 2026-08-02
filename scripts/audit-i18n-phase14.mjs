import fs from "node:fs";
import path from "node:path";
import {
  buildReport,
  createSuggestedBaseline,
  enforceBaseline,
  renderMarkdown,
} from "./i18n-audit-lib.mjs";

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function writeOutput(file, content) {
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

const policyPath = argumentValue("--policy") ?? "config/i18n-audit-policy.json";
const baselinePath = argumentValue("--baseline") ?? "config/i18n-phase14-baseline.json";
const jsonOutput = argumentValue("--json-out");
const markdownOutput = argumentValue("--markdown-out");
const suggestedBaselineOutput = argumentValue("--suggested-baseline-out");
const noEnforce = process.argv.includes("--no-enforce");

const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
const baseline = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, "utf8")) : null;
const report = buildReport(policy);

writeOutput(jsonOutput, `${JSON.stringify(report, null, 2)}\n`);
writeOutput(markdownOutput, renderMarkdown(report, baseline));
if (suggestedBaselineOutput) {
  writeOutput(suggestedBaselineOutput, `${JSON.stringify(createSuggestedBaseline(report), null, 2)}\n`);
}

console.log(
  `I18n audit: ${report.totals.actionable} actionable, ${report.totals.excluded} reviewed exclusions, ${report.totals.candidates} total candidates.`
);
for (const [module, counts] of Object.entries(report.modules)) {
  console.log(`${module}: ${counts.actionable} actionable / ${counts.excluded} excluded`);
}

if (!noEnforce) {
  if (!baseline) {
    console.error(`Missing reviewed baseline: ${baselinePath}`);
    process.exit(1);
  }
  const errors = enforceBaseline(report, baseline);
  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    console.error("Run with --no-enforce and review the generated report before updating the baseline.");
    process.exit(1);
  }
}
