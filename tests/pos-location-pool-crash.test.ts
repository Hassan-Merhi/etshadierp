import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("POS location database-pool crash protection", () => {
  it("contains POS authorization database failures inside Express", () => {
    const auth = source("server/auth.ts");
    const middleware = auth.slice(
      auth.indexOf("export async function checkPOSLocation"),
      auth.indexOf("export async function requirePasswordConfirmation")
    );

    expect(middleware).toContain("try {");
    expect(middleware).toContain("eq(userLocations.locationId, locationId)");
    expect(middleware).toContain(".limit(1)");
    expect(middleware).toContain("return next(error)");
    expect(middleware).not.toContain("assignedLocations.map");
  });

  it("serializes cold-cache net-profit calculations", () => {
    const guard = source("server/runtimeMemoryGuard.mjs");

    expect(guard).toContain(
      '{ test: (path) => path === "/api/stats/net-profit", max: 1, name: "stats-net-profit" }'
    );
  });

  it("keeps schema and production SQL aligned", () => {
    const usersSchema = source("shared/schema/users.ts");
    const migration = source("migrations/20260721_fix_pos_location_pool_crash.sql");

    expect(usersSchema).toContain("user_locations_user_company_location_idx");
    expect(migration).toContain("ON user_locations (user_id, company_id, location_id)");
    expect(migration).toContain("base_debit_amount NUMERIC(20,6)");
    expect(migration).toContain("base_credit_amount NUMERIC(20,6)");
  });
});
