import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("factory customer proforma summary payload", () => {
  it("keeps summaries line-free and preserves the lazy detail route", () => {
    const server = readFileSync("server/routes/factory/customer-proformas/proformas.ts", "utf8");
    const client = readFileSync("client/src/pages/factory/FactoryPendingLoadings.tsx", "utf8");

    expect(server).toContain('profile === "summary"');
    expect(server).toContain("lines: []");
    expect(server).toContain('app.get("/api/factory/customer-proformas/:id"');
    expect(server).toContain("lines: enrichedLines");
    expect(client).toContain("profile=summary");
  });
});
