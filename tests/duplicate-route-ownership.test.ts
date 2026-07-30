import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

const retiredFiles = [
  "server/routesLegacy.ts",
  "server/routes/reportsRoutesLegacy.ts",
  "server/routes/authRoutesLegacy.ts",
  "server/routes/customerRoutesLegacy.ts",
];

describe("Phase 9 duplicate route ownership", () => {
  it("registers each focused application registrar only once", () => {
    const applicationRoutes = read("server/routes/applicationRoutes.ts");
    const names = Array.from(
      applicationRoutes.matchAll(/(register[A-Z][A-Za-z0-9]+Routes?)\(app/g),
      (match) => match[1],
    );
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);

    expect(names.length).toBeGreaterThan(0);
    expect([...new Set(duplicates)]).toEqual([]);
  });

  it("keeps all legacy route compatibility files physically retired", () => {
    for (const file of retiredFiles) {
      expect(fs.existsSync(path.join(root, file)), file).toBe(false);
    }
  });

  it("records direct focused composition as the current boundary", () => {
    const boundaries = JSON.parse(read("config/legacy-route-boundaries.json")) as {
      version: number;
      description: string;
      files: unknown[];
    };

    expect(boundaries.version).toBeGreaterThanOrEqual(9);
    expect(boundaries.description).toContain("removed");
    expect(boundaries.description).toContain("focused domain modules");
    expect(boundaries.files).toEqual([]);
  });
});
