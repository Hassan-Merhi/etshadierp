import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const committedEnvLikeFiles = [".replit", ".env.production", "client/.env.capacitor"];
const secretName = /(?:API_KEY|SECRET|TOKEN|PASSWORD|CONSUMER_KEY|CONSUMER_SECRET)/;

function literalAssignments(relativePath: string) {
  const text = fs.readFileSync(path.join(root, relativePath), "utf8");
  const findings: string[] = [];
  const assignment = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*["']?([^\s"'#]+)["']?\s*$/gm;

  for (const match of text.matchAll(assignment)) {
    const [, name, value] = match;
    if (secretName.test(name) && value) findings.push(`${relativePath}:${name}`);
  }
  return findings;
}

describe("committed configuration secret hygiene", () => {
  it("keeps credential-bearing values out of committed deployment environment files", () => {
    const findings = committedEnvLikeFiles.flatMap(literalAssignments);

    const render = fs.readFileSync(path.join(root, "render.yaml"), "utf8");
    for (const match of render.matchAll(/-\s+key:\s*([A-Z][A-Z0-9_]*)\s*\n\s*value:\s*([^\s#]+)/g)) {
      if (secretName.test(match[1])) findings.push(`render.yaml:${match[1]}`);
    }

    expect(
      findings,
      `Committed config contains literal credential-bearing values:\n${findings.join("\n")}\n` +
        "Use platform secrets/environment variables instead; examples belong only in .env.example."
    ).toEqual([]);
  });
});
