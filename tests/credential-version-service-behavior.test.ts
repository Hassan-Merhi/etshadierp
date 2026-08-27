import { describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  credentialVersions: {
    userId: "credential.userId",
    credentialVersion: "credential.credentialVersion",
  },
}));

vi.mock("@shared/schema", () => ({
  userCredentialVersions: harness.credentialVersions,
}));
vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ type: "eq", column, value }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings: [...strings],
    values,
  }),
}));

import {
  bumpCredentialVersion,
  hydrateActiveCredentialVersion,
  loadCredentialVersion,
  revokeUserCompanySessions,
  revokeUserSessions,
  rotateCredentialsAndRevokeSessions,
} from "../server/services/security/credentialVersionService";

function selectBuilder(rows: any[]) {
  const builder: any = {
    from: vi.fn(() => builder),
    where: vi.fn(() => builder),
    limit: vi.fn(async () => rows),
  };
  return builder;
}

function insertBuilder(rows: any[]) {
  const builder: any = {
    values: vi.fn(() => builder),
    onConflictDoNothing: vi.fn(() => builder),
    onConflictDoUpdate: vi.fn(() => builder),
    returning: vi.fn(async () => rows),
  };
  return builder;
}

describe("credential version service behavior", () => {
  it("loads an existing version and hydrates session state", async () => {
    const db: any = {
      execute: vi.fn(async () => undefined),
      select: vi.fn(() => selectBuilder([{ credentialVersion: 4 }])),
    };

    await expect(loadCredentialVersion(db, "u1")).resolves.toBe(4);

    const session: any = { userId: "u1" };
    await expect(
      hydrateActiveCredentialVersion(db, session, {
        now: 1000,
        refreshMs: 60_000,
      }),
    ).resolves.toBe(4);
    expect(session).toMatchObject({
      activeCredentialVersion: 4,
      credentialVersion: 4,
      credentialVersionCheckedAt: 1000,
    });
  });

  it("uses a fresh cached active version without hitting the database", async () => {
    const db: any = { select: vi.fn() };
    const session: any = {
      userId: "u2",
      credentialVersion: 7,
      activeCredentialVersion: 7,
      credentialVersionCheckedAt: 1000,
    };

    await expect(
      hydrateActiveCredentialVersion(db, session, {
        now: 1500,
        refreshMs: 1000,
      }),
    ).resolves.toBe(7);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("returns zero for sessions without a user id", async () => {
    await expect(
      hydrateActiveCredentialVersion({}, {}, { now: 1 }),
    ).resolves.toBe(0);
  });

  it("creates a missing credential version row and defaults safely when insert returns nothing", async () => {
    const create = insertBuilder([{ credentialVersion: 0 }]);
    const db: any = {
      execute: vi.fn(async () => undefined),
      select: vi.fn(() => selectBuilder([])),
      insert: vi.fn(() => create),
    };
    await expect(loadCredentialVersion(db, "new-user")).resolves.toBe(0);
    expect(create.onConflictDoNothing).toHaveBeenCalled();

    const emptyCreate = insertBuilder([]);
    const db2: any = {
      execute: vi.fn(),
      select: vi.fn(() => selectBuilder([])),
      insert: vi.fn(() => emptyCreate),
    };
    await expect(loadCredentialVersion(db2, "new-user-2")).resolves.toBe(0);
  });

  it("bumps credential versions through upsert semantics", async () => {
    const upsert = insertBuilder([{ credentialVersion: 9 }]);
    const tx: any = { execute: vi.fn(), insert: vi.fn(() => upsert) };
    await expect(bumpCredentialVersion(tx, "u3")).resolves.toBe(9);
    expect(upsert.onConflictDoUpdate).toHaveBeenCalled();
  });

  it("revokes all sessions or preserves one explicitly exempt sid", async () => {
    const pool = { query: vi.fn(async () => undefined) };
    await revokeUserSessions(pool, "u4");
    expect(pool.query).toHaveBeenLastCalledWith(
      expect.stringContaining("sess->>'userId' = $1"),
      ["u4"],
    );

    await revokeUserSessions(pool, "u4", "sid-keep");
    expect(pool.query).toHaveBeenLastCalledWith(expect.stringContaining("sid <> $2"), [
      "u4",
      "sid-keep",
    ]);
  });

  it("revokes only sessions in the affected company and can preserve one sid", async () => {
    const pool = { query: vi.fn(async () => undefined) };

    await revokeUserCompanySessions(pool, "u-company", 42);
    expect(pool.query).toHaveBeenLastCalledWith(
      expect.stringContaining("sess->>'currentCompanyId' = $2"),
      ["u-company", "42"],
    );

    await revokeUserCompanySessions(pool, "u-company", 42, "sid-keep");
    expect(pool.query).toHaveBeenLastCalledWith(expect.stringContaining("sid <> $3"), [
      "u-company",
      "42",
      "sid-keep",
    ]);
  });

  it("rotates credentials transactionally and then revokes prior sessions", async () => {
    const upsert = insertBuilder([{ credentialVersion: 3 }]);
    const tx: any = { execute: vi.fn(), insert: vi.fn(() => upsert) };
    const db: any = {
      transaction: vi.fn(async (callback: (inner: any) => Promise<number>) =>
        callback(tx),
      ),
    };
    const pool = { query: vi.fn(async () => undefined) };

    await expect(
      rotateCredentialsAndRevokeSessions(db, pool, "u5", {
        exceptSid: "current",
      }),
    ).resolves.toBe(3);
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("sid <> $2"), [
      "u5",
      "current",
    ]);
  });
});
