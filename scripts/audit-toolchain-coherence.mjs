#!/usr/bin/env node
/**
 * audit-toolchain-coherence.mjs
 *
 * One canonical Node runtime, asserted everywhere the repository chooses a
 * runtime. `.node-version` is the authority. Compatibility-only declarations
 * such as package.json engines may be a range, but they must start at the same
 * major and may not admit an older major.
 *
 * In addition to comparing literal versions, this audit checks GitHub Actions
 * job structure: any job that runs node/npm/npx must set up the canonical Node
 * version in that same job. That closes the escape hatch where a workflow uses
 * the runner's preinstalled Node and silently changes when `ubuntu-latest`
 * changes.
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

function canonicalVersion() {
  const version = read(".node-version").trim();
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(version)) {
    throw new Error(`.node-version must be an explicit major.minor[.patch] version; got "${version}".`);
  }
  return version;
}

function workflowFiles() {
  const dir = path.join(projectRoot, ".github/workflows");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort()
    .map((name) => `.github/workflows/${name}`);
}

function workflowJobs(text) {
  const jobs = [];
  const lines = text.split(/\r?\n/);
  let inJobs = false;
  let current = null;

  const finish = () => {
    if (current) jobs.push({ name: current.name, text: current.lines.join("\n") });
    current = null;
  };

  for (const line of lines) {
    if (!inJobs) {
      if (/^jobs:\s*(?:#.*)?$/.test(line)) inJobs = true;
      continue;
    }

    if (/^\S/.test(line) && line.trim() !== "") {
      finish();
      break;
    }

    const job = line.match(/^  ([A-Za-z0-9_-]+):\s*(?:#.*)?$/);
    if (job) {
      finish();
      current = { name: job[1], lines: [line] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  finish();
  return jobs;
}

function jobUsesNode(jobText) {
  // Deliberately broad and fail-closed. A false positive only asks the job to
  // pin Node; a false negative lets the hosted runner choose a runtime for us.
  return /\b(?:node|npm|npx)\b/i.test(jobText);
}

function setupNodeVersions(jobText) {
  if (!/uses:\s*actions\/setup-node@/i.test(jobText)) return [];
  return [...jobText.matchAll(/node-version:\s*["']?([^\s"'#]+)["']?/g)].map((match) => match[1]);
}

function packageEngineOk(range, major) {
  // package.json is a compatibility declaration, not a runtime pin. Require a
  // floor in the canonical major and reject ranges that mention an older major
  // or union together unrelated majors. Runtime selection stays exact elsewhere.
  if (typeof range !== "string" || range.includes("||")) return false;
  const lower = range.match(/>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!lower || Number(lower[1]) !== Number(major)) return false;
  const mentionedMajors = [...range.matchAll(/(?:^|[^\d])(\d+)(?:\.\d+)?(?:\.\d+)?/g)].map((match) =>
    Number(match[1])
  );
  return mentionedMajors.every((value) => value >= Number(major));
}

export function auditToolchainCoherence() {
  const failures = [];
  const sources = [];
  let canonical;

  try {
    canonical = canonicalVersion();
  } catch (error) {
    return {
      canonical: null,
      failures: [error instanceof Error ? error.message : String(error)],
      sources: [],
      workflowJobs: [],
      summary: { canonical: null, sourcesChecked: 0, workflowJobsChecked: 0, disagreeing: 1 },
    };
  }

  const major = canonical.split(".")[0];
  sources.push({ file: ".node-version", states: canonical, ok: true });

  const nvmrc = read(".nvmrc").trim();
  const nvmrcOk = nvmrc === canonical;
  sources.push({ file: ".nvmrc", states: nvmrc, ok: nvmrcOk });
  if (!nvmrcOk) failures.push(`.nvmrc says ${nvmrc}; .node-version says ${canonical}.`);

  const pkg = JSON.parse(read("package.json"));
  const enginesNode = pkg.engines?.node ?? "";
  const enginesOk = packageEngineOk(enginesNode, major);
  sources.push({ file: "package.json (engines.node)", states: enginesNode, ok: enginesOk });
  if (!enginesOk) {
    failures.push(
      `package.json engines.node is "${enginesNode}"; it must have a lower bound in canonical Node major ${major} and must not admit an older major.`
    );
  }

  if (exists(".replit")) {
    const replit = read(".replit");
    const modules = [...replit.matchAll(/nodejs-(\d+)/g)].map((match) => match[1]);
    const unique = [...new Set(modules)];
    const replitOk = unique.length === 1 && unique[0] === major;
    sources.push({ file: ".replit", states: unique.length ? unique.map((value) => `nodejs-${value}`).join(", ") : "none", ok: replitOk });
    if (!replitOk) {
      failures.push(
        `.replit must provision exactly one Node major and it must be nodejs-${major}; found ${unique.length ? unique.join(", ") : "none"}.`
      );
    }
  }

  if (exists("render.yaml")) {
    const render = read("render.yaml");
    const match = render.match(/-\s+key:\s*NODE_VERSION\s*\n\s*value:\s*["']?([^\s"']+)["']?/m);
    const renderVersion = match?.[1] ?? "missing";
    const renderOk = renderVersion === canonical;
    sources.push({ file: "render.yaml (NODE_VERSION)", states: renderVersion, ok: renderOk });
    if (!renderOk) failures.push(`render.yaml NODE_VERSION is ${renderVersion}; .node-version says ${canonical}.`);
  } else {
    failures.push("render.yaml is missing, so the production Node runtime is not pinned by this audit.");
  }

  const checkedWorkflowJobs = [];
  for (const file of workflowFiles()) {
    const text = read(file);
    for (const job of workflowJobs(text)) {
      const usesNode = jobUsesNode(job.text);
      const versions = setupNodeVersions(job.text);
      if (!usesNode && versions.length === 0) continue;

      const ok = !usesNode || (versions.length === 1 && versions[0] === canonical);
      const states = versions.length ? versions.join(", ") : "no actions/setup-node pin";
      checkedWorkflowJobs.push({ file, job: job.name, usesNode, states, ok });
      sources.push({ file: `${file}#${job.name}`, states, ok });

      if (usesNode && versions.length === 0) {
        failures.push(`${file} job "${job.name}" runs node/npm/npx but has no actions/setup-node pin.`);
      } else if (usesNode && versions.length !== 1) {
        failures.push(`${file} job "${job.name}" must declare exactly one node-version; found ${versions.length}.`);
      } else if (usesNode && versions[0] !== canonical) {
        failures.push(`${file} job "${job.name}" sets node-version ${versions[0]}; .node-version says ${canonical}.`);
      }
    }
  }

  if (exists(".circleci/config.yml")) {
    const circle = read(".circleci/config.yml");
    const images = [...circle.matchAll(/cimg\/node:([\d.]+)/g)].map((match) => match[1]);
    const unique = [...new Set(images)];
    if (unique.length === 0) {
      sources.push({ file: ".circleci/config.yml", states: "no cimg/node image", ok: false });
      failures.push(".circleci/config.yml has no cimg/node image, so CircleCI's Node runtime is not pinned.");
    } else {
      for (const image of unique) {
        const ok = image === canonical;
        sources.push({ file: ".circleci/config.yml", states: `cimg/node:${image}`, ok });
        if (!ok) failures.push(`.circleci/config.yml uses cimg/node:${image}; .node-version says ${canonical}.`);
      }
    }
  }

  const readme = read("README.md");
  const readmeOk = readme.includes(`Node.js **${canonical}**`);
  sources.push({ file: "README.md", states: readmeOk ? canonical : "does not state it", ok: readmeOk });
  if (!readmeOk) failures.push(`README.md does not state "Node.js **${canonical}**" in its prerequisites.`);

  return {
    canonical,
    failures,
    sources,
    workflowJobs: checkedWorkflowJobs,
    summary: {
      canonical,
      sourcesChecked: sources.length,
      workflowJobsChecked: checkedWorkflowJobs.length,
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
      `Toolchain coherent: Node ${report.canonical} across ${report.summary.sourcesChecked} runtime/config sources and ` +
        `${report.summary.workflowJobsChecked} Node-using GitHub Actions jobs.`
    );
  }
}
