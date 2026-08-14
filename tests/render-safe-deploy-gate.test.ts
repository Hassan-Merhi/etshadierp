import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Render production release gate", () => {
  const blueprint = readFileSync(resolve(process.cwd(), "render.yaml"), "utf8");

  it("waits for repository CI checks before deploying the production web service", () => {
    expect(blueprint).toMatch(/^\s{4}autoDeployTrigger:\s*checksPass\s*$/m);
  });

  it("does not fall back to deploy-on-every-commit behavior", () => {
    expect(blueprint).not.toMatch(/^\s+autoDeploy:\s*true\s*$/m);
  });
});
