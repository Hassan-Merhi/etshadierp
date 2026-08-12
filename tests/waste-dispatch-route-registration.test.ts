import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("waste dispatch route registration", () => {
  it("keeps the production factory employee registrar delegated to the canonical registrar", () => {
    const compatibilityRegistrar = read("server/routes/factory/factoryEmployeesPosRoutes.ts");

    expect(compatibilityRegistrar).toContain('from "./employee-pos/index";');
    expect(compatibilityRegistrar).toContain("registerCanonicalFactoryEmployeesPosRoutes(app);");
  });

  it("registers the optimized waste dispatch read routes used by the UI", () => {
    const canonicalRegistrar = read("server/routes/factory/employee-pos/index.ts");

    expect(canonicalRegistrar).toContain('from "./wasteDispatchBandwidthRoutes";');
    expect(canonicalRegistrar).toContain("registerWasteDispatchBandwidthRoutes(app);");
  });
});
