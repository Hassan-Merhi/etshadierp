import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Phase 6 inventory route ownership", () => {
  it("keeps inventory registration in the focused application composition path", () => {
    const applicationRoutes = read("server/routes/applicationRoutes.ts");
    const inventoryRoutes = read("server/routes/inventoryRoutes.ts");

    expect(applicationRoutes).toContain('import { registerInventoryRoutes } from "./inventoryRoutes";');
    expect(applicationRoutes).toContain("registerInventoryRoutes(app);");

    expect(inventoryRoutes).toContain("registerInventoryListRoutes(app);");
    expect(inventoryRoutes).toContain("registerInventoryQuickAdjustRoutes(app);");
    expect(inventoryRoutes).toContain("registerInventoryMovementRoutes(app);");
  });

  it("prevents inventory HTTP ownership from returning to routesLegacy", () => {
    const legacyRoutes = read("server/routesLegacy.ts");
    const boundaries = read("config/legacy-route-boundaries.json");

    expect(legacyRoutes).not.toMatch(/\bapp\.(get|post|put|patch|delete|use)\s*\(/);
    expect(legacyRoutes).not.toMatch(/registerInventoryRoutes/);
    expect(boundaries).toContain("no inventory HTTP ownership");
  });
});
