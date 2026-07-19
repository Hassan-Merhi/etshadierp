import { describe, expect, it, vi } from "vitest";
import { decideSessionSecurity } from "../server/services/security/sessionSecurityPolicy";
import { hydrateActiveCredentialVersion, revokeUserSessions } from "../server/services/security/credentialVersionService";

function selectDb(version: number) {
  const limit = vi.fn(async () => [{ credentialVersion: version }]);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { db: { select }, select, from, where, limit };
}

describe("credential version lifecycle", () => {
  it("hydrates a legacy session once from the persistent version", async () => {
    const { db } = selectDb(4);
    const session: any = { userId: "user-1" };

    await expect(hydrateActiveCredentialVersion(db, session, { now: 1000 })).resolves.toBe(4);
    expect(session.credentialVersion).toBe(4);
    expect(session.activeCredentialVersion).toBe(4);
    expect(session.credentialVersionCheckedAt).toBe(1000);
  });

  it("uses the bounded cache before refreshing persistence", async () => {
    const { db, select } = selectDb(7);
    const session: any = {
      userId: "user-2",
      credentialVersion: 7,
      activeCredentialVersion: 7,
      credentialVersionCheckedAt: 1000,
    };

    await expect(hydrateActiveCredentialVersion(db, session, { now: 1500, refreshMs: 1000 })).resolves.toBe(7);
    expect(select).not.toHaveBeenCalled();
  });

  it("causes the pure session policy to reject stale credentials", () => {
    const now = 10_000;
    const decision = decideSessionSecurity({
      session: {
        userId: "user-3",
        currentCompanyId: 1,
        createdAt: now - 1000,
        lastSeenAt: now - 100,
        absoluteExpiresAt: now + 1000,
        credentialVersion: 2,
      },
      activeCredentialVersion: 3,
      now,
      requireCompanyContext: true,
    });

    expect(decision.valid).toBe(false);
    expect(decision.code).toBe("SESSION_CREDENTIALS_REVOKED");
  });

  it("revokes every session for a rotated user", async () => {
    const query = vi.fn(async () => ({ rowCount: 2 }));
    await revokeUserSessions({ query }, "user-4");
    expect(query).toHaveBeenCalledWith(
      `DELETE FROM session WHERE sess->>'userId' = $1`,
      ["user-4"]
    );
  });

  it("can preserve the current session while revoking the others", async () => {
    const query = vi.fn(async () => ({ rowCount: 1 }));
    await revokeUserSessions({ query }, "user-5", "sid-current");
    expect(query).toHaveBeenCalledWith(
      `DELETE FROM session WHERE sess->>'userId' = $1 AND sid <> $2`,
      ["user-5", "sid-current"]
    );
  });
});
