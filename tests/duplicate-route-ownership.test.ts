import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Phase 8 duplicate route ownership", () => {
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

  it("keeps compatibility files free of active HTTP registrations", () => {
    const files = [
      "server/routesLegacy.ts",
      "server/routes/reportsRoutesLegacy.ts",
      "server/routes/authRoutesLegacy.ts",
      "server/routes/customerRoutesLegacy.ts",
    ];

    for (const file of files) {
      const source = read(file);
      expect(source).not.toMatch(/app\.(get|post|put|patch|delete|use)\(/);
    }
  });

  it("records duplicate cleanup as the current boundary", () => {
    const boundaries = JSON.parse(read("config/legacy-route-boundaries.json")) as {
      version: number;
      description: string;
      files: Array<{ owner: string }>;
    };

    expect(boundaries.version).toBe(8);
    expect(boundaries.description).toContain("uniquely composed");
    expect(boundaries.files.every((entry) => entry.owner.includes("no active HTTP ownership"))).toBe(true);
  });
});
