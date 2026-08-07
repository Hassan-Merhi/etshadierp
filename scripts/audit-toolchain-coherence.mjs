#!/usr/bin/env node
/**
 * audit-toolchain-coherence.mjs
 *
 * One Node version, asserted across every file that states one.
 *
 * Before this existed, seven sources disagreed: `.node-version` said 20.19.2,
 * `.nvmrc` said 22, `.replit` provisioned nodejs-20, `package.json` required
 * >=22.0.0, the workflows used a mix of "22" and "22.14", CircleCI pinned
 * cimg/node:22.14 — and `README.md` told a new contributor to install Node 20,
 * citing `.node-version` as the authority. A fresh clone followed literally
 * produced an environment that violated the engines constraint.
 *
 * None of that is the kind of thing anyone notices by reading. It is exactly
 * the kind of thing a script notices every time.
 *
 * Usage:
 *   npm run audit:toolchain
 *   node scripts/audit-toolchain-coherence.mjs --json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const read = (relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
const exists = (relativePath) => fs.existsSync(path.join(projectRoot, relativePath));

/** `.node-version` is the authority; README says so, so the audit does too. */
function canonicalVersion() {
  return read(".node-version").trim();
}

function collectWorkflowVersions() {
  const dir = path.join(projectRoot, ".github/workflows");
  if (!fs.existsSync(dir)) return [];
  const found = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".yml") && !name.endsWith(".yaml")) continue;
    const text = fs.readFileSync(path.join(dir, name), "utf8");
    for (const match of text.matchAll(/node-version:\s*['"]?([\d.x]+)['"]?/g)) {
      found.push({ file: `.github/workflows/${name}`, version: match[1] });
    }
  }
  return found;
}

export function auditToolchainCoherence() {
  const failures = [];
  const sources = [];
  const canonical = canonicalVersion();
  const major = canonical.split(".")[0];

  sources.push({ file: ".node-version", states: canonical, ok: true });

  // .nvmrc
  const nvmrc = read(".nvmrc").trim();
  const nvmrcOk = nvmrc === canonical;
  sources.push({ file: ".nvmrc", states: nvmrc, ok: nvmrcOk });
  if (!nvmrcOk) failures.push(`.nvmrc says ${nvmrc}; .node-version says ${canonical}.`);

  // package.json engines — a range, so check it admits the canonical major and
  // excludes the one below it. A range that accepts anything is not coherence.
  const pkg = JSON.parse(read("package.json"));
  const enginesNode = pkg.engines?.node ?? "";
  const enginesOk = enginesNode.includes(major);
  sources.push({ file: "package.json (engines.node)", states: enginesNode, ok: enginesOk });
  if (!enginesOk) {
    failures.push(`package.json engines.node is "${enginesNode}", which does not mention major ${major}.`);
  }

  // .replit provisions by major only — that is the granularity it offers.
  if (exists(".replit")) {
    const replit = read(".replit");
    const match = replit.match(/nodejs-(\d+)/);
    const replitOk = match ? match[1] === major : true;
    sources.push({ file: ".replit", states: match ? `nodejs-${match[1]}` : "none", ok: replitOk });
    if (!replitOk) failures.push(`.replit provisions nodejs-${match[1]}; the canonical major is ${major}.`);
  }

  // Every workflow that sets up Node.
  for (const { file, version } of collectWorkflowVersions()) {
    const ok = version === canonical;
    sources.push({ file, states: version, ok });
    if (!ok) failures.push(`${file} sets node-version ${version}; .node-version says ${canonical}.`);
  }

  // CircleCI is the external anchor: its image tag is what the parity workflow
  // exists to mirror, so a drift here means the mirror has stopped mirroring.
  if (exists(".circleci/config.yml")) {
    const circle = read(".circleci/config.yml");
    const images = [...circle.matchAll(/cimg\/node:([\d.]+)/g)].map((match) => match[1]);
    for (const image of new Set(images)) {
      const ok = image === canonical;
      sources.push({ file: ".circleci/config.yml", states: `cimg/node:${image}`, ok });
      if (!ok) {
        failures.push(
          `.circleci/config.yml uses cimg/node:${image} while .node-version says ${canonical}. ` +
            `CircleCI is the anchor these agree on — change both together.`
        );
      }
    }
  }

  // README is where a new contributor looks first, and was the one that was
  // wrong for longest.
  const readme = read("README.md");
  const readmeOk = readme.includes(`Node.js **${canonical}**`);
  sources.push({ file: "README.md", states: readmeOk ? canonical : "does not state it", ok: readmeOk });
  if (!readmeOk) {
    failures.push(`README.md does not state "Node.js **${canonical}**" in its prerequisites.`);
  }

  return {
    canonical,
    failures,
    sources,
    summary: {
      canonical,
      sourcesChecked: sources.length,
      disagreeing: sources.filter((source) => !source.ok).length,
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = auditToolchainCoherence();

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.failures.length > 0 ? 1 : 0);
  }

  if (report.failures.length > 0) {
    console.error(report.failures.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(
      `Toolchain coherent: Node ${report.canonical} across ${report.summary.sourcesChecked} sources ` +
        `(.node-version, .nvmrc, package.json, .replit, workflows, CircleCI, README).`
    );
  }
}
