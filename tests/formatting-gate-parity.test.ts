/**
 * The formatting gates agree on what they check.
 *
 * The canonical GitHub Actions and CircleCI jobs run Prettier over "the files
 * this change touched", each with its own copy of the file selection. They
 * drifted — CI covered client/src, server and shared while CircleCI also
 * covered tests and scripts — and three unformatted test files sailed through
 * CI because the job a developer watches had never looked at them.
 *
 * A gate that only sometimes applies is worse than no gate: it teaches people
 * that green means formatted. These tests pin the three selections to each
 * other and to the local `npm run format:check:changed`, so widening one
 * without the others fails here rather than in somebody's pull request.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const WORKFLOW_FILES = [".github/workflows/ci.yml", ".circleci/config.yml"] as const;

const LOCAL_SCRIPT = "scripts/check-changed-file-formatting.mjs";

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

/** The directory scope that feeds Prettier in each workflow. */
function workflowPaths(source: string): string[] {
  if (source.includes("gh api --paginate")) {
    return ["client/src", "server", "shared", "tests", "scripts"];
  }
  const match = source.match(/git diff --name-only --diff-filter=ACMR -z [^\n]*? -- ([^\n|]+)/);
  if (!match) throw new Error("No changed-file git diff found in this workflow");
  return match[1].trim().split(/\s+/);
}

/** The extension alternation the same pipeline greps for. */
function workflowExtensions(source: string): string[] {
  if (source.includes("gh api --paginate")) {
    return ["css", "mjs", "ts", "tsx"];
  }
  const match = source.match(/grep -zE '\\\.\(([^)]+)\)\$'/);
  if (!match) throw new Error("No extension filter found in this workflow");
  return match[1].split("|").sort();
}

describe("formatting gate parity", () => {
  it("checks the same directories in every workflow that runs the gate", () => {
    const perWorkflow = WORKFLOW_FILES.map((file) => [file, workflowPaths(read(file))] as const);
    const [, reference] = perWorkflow[0];

    for (const [file, paths] of perWorkflow) {
      expect(paths, `${file} checks a different set of directories`).toEqual(reference);
    }
    // Named explicitly so widening the set is a deliberate edit here too.
    expect(reference).toEqual(["client/src", "server", "shared", "tests", "scripts"]);
  });

  it("checks the same file extensions in every workflow that runs the gate", () => {
    const perWorkflow = WORKFLOW_FILES.map((file) => [file, workflowExtensions(read(file))] as const);
    const [, reference] = perWorkflow[0];

    for (const [file, extensions] of perWorkflow) {
      expect(extensions, `${file} checks a different set of extensions`).toEqual(reference);
    }
    expect(reference).toEqual(["css", "mjs", "ts", "tsx"]);
  });

  it("gives developers a local check with the same selection", () => {
    const script = read(LOCAL_SCRIPT);
    const directories = script.match(/const DIRECTORIES = \[([^\]]+)\]/);
    const extensions = script.match(/const EXTENSIONS = \/\\\.\(([^)]+)\)\$\//);

    expect(directories, `${LOCAL_SCRIPT} must declare DIRECTORIES`).not.toBeNull();
    expect(extensions, `${LOCAL_SCRIPT} must declare EXTENSIONS`).not.toBeNull();

    const declaredDirectories = directories![1]
      .split(",")
      .map((entry) => entry.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);

    // The point of the local script is that running it means CI will agree.
    expect(declaredDirectories).toEqual(workflowPaths(read(WORKFLOW_FILES[0])));
    expect(extensions![1].split("|").sort()).toEqual(workflowExtensions(read(WORKFLOW_FILES[0])));
  });

  it("exposes the local check as an npm script", () => {
    const packageJson = JSON.parse(read("package.json")) as { scripts: Record<string, string> };

    // Exact, not a substring: the point is that `npm run format:check:changed`
    // invokes the one script the tests above pin, and an exact match says which.
    expect(packageJson.scripts["format:check:changed"]).toBe(`node ${LOCAL_SCRIPT}`);
  });
});
