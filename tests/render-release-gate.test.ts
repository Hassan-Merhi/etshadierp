import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const renderBlueprint = readFileSync(new URL("../render.yaml", import.meta.url), "utf8");

describe("Render release gate", () => {
  it("deploys the production web service only after repository checks pass", () => {
    expect(renderBlueprint).toMatch(/^\s{4}autoDeployTrigger:\s*checksPass\s*$/m);
    expect(renderBlueprint).not.toMatch(/^\s{4}autoDeploy:\s*true\s*$/m);
  });
});
