import { describe, expect, it } from "vitest";
import { getMigrationLockOptions } from "../server/startupMigrationCoordinator";

describe("startup migration coordinator configuration", () => {
  it("uses safe defaults", () => {
    expect(getMigrationLockOptions({})).toEqual({
      waitMs: 90_000,
      pollMs: 1_000,
      failOpen: false,
    });
  });

  it("accepts explicit positive timing overrides", () => {
    expect(
      getMigrationLockOptions({
        STARTUP_MIGRATION_LOCK_WAIT_MS: "120000",
        STARTUP_MIGRATION_LOCK_POLL_MS: "250",
        STARTUP_MIGRATION_LOCK_FAIL_OPEN: "true",
      }),
    ).toEqual({
      waitMs: 120_000,
      pollMs: 250,
      failOpen: true,
    });
  });

  it("rejects invalid timing overrides", () => {
    expect(
      getMigrationLockOptions({
        STARTUP_MIGRATION_LOCK_WAIT_MS: "0",
        STARTUP_MIGRATION_LOCK_POLL_MS: "not-a-number",
      }),
    ).toEqual({
      waitMs: 90_000,
      pollMs: 1_000,
      failOpen: false,
    });
  });
});
