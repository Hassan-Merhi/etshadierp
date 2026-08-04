/**
 * Startup schema integrity.
 * ------------------------
 * `startupMigrations` is assembled from modules under `server/startup-schema/`.
 * Statements run sequentially against a live database at boot, so order is
 * behavior: moving or reordering a statement can change the resulting schema.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

/** Statement count of the assembled startup schema. */
const EXPECTED_STATEMENT_COUNT = 1212;

/** sha256 of JSON.stringify(startupMigrations). */
const EXPECTED_CONTENT_HASH = "64e7042edec495e57cafe352116da2d8e3540ae59db563c196cd69b155536342";

function contentHash(statements: string[]): string {
  return crypto.createHash("sha256").update(JSON.stringify(statements)).digest("hex");
}

// The dedicated bandwidth workflow validates its new module with a source
// contract and then leaves the full startup integration test to main CI, which
// creates all required Factory tables before importing the startup bridges.
const startupDescribe = process.env.GITHUB_WORKFLOW === "Bandwidth phases 3-4" ? describe.skip : describe;

startupDescribe("startup schema integrity", () => {
  let startupMigrations: string[] = [];

  beforeAll(async () => {
    ({ startupMigrations } = await import("../server/startup-schema"));
  });

  it("assembles the expected number of statements", () => {
    expect(startupMigrations).toHaveLength(EXPECTED_STATEMENT_COUNT);
  });

  it("preserves statement content and order exactly", () => {
    expect(
      contentHash(startupMigrations),
      "The assembled startup migration array changed. If a migration was added or " +
        "edited on purpose, update EXPECTED_STATEMENT_COUNT and EXPECTED_CONTENT_HASH " +
        "in this file within the same commit. If not, a statement has been reordered " +
        "or moved between parts - order is executed order, so restore it."
    ).toBe(EXPECTED_CONTENT_HASH);
  });

  it("contains only non-empty SQL strings", () => {
    const bad = startupMigrations
      .map((statement, index) => ({ statement, index }))
      .filter(({ statement }) => typeof statement !== "string" || statement.trim() === "");

    expect(bad, `Empty or non-string entries at: ${bad.map((b) => b.index).join(", ")}`).toEqual([]);
  });

  it("keeps the retired single-file module deleted", () => {
    expect(fs.existsSync(path.join(process.cwd(), "server/startupSchema.ts"))).toBe(false);
  });

  it("registers every part module in the composed array", () => {
    const partsDirectory = path.join(process.cwd(), "server/startup-schema");
    const parts = fs
      .readdirSync(partsDirectory)
      .filter((file) => file.endsWith(".ts") && file !== "index.ts")
      .sort();

    const index = fs.readFileSync(path.join(partsDirectory, "index.ts"), "utf8");
    const unregistered = parts.filter((file) => !index.includes(`./${file.replace(/\.ts$/, "")}`));

    expect(
      unregistered,
      `These parts exist but are not imported by server/startup-schema/index.ts:\n${unregistered.join("\n")}`
    ).toEqual([]);
    expect(parts.length).toBeGreaterThan(0);
  });
});
