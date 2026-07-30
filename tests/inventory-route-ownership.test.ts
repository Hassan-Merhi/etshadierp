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

  it("keeps the retired top-level route registry absent", () => {
    expect(fs.existsSync(path.join(root, "server/routesLegacy.ts"))).toBe(false);
    const boundaries = JSON.parse(read("config/legacy-route-boundaries.json")) as {
      description: string;
      files: unknown[];
    };
    expect(boundaries.description).toContain("focused domain modules");
    expect(boundaries.files).toEqual([]);
  });
});
