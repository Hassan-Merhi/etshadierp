import { describe, expect, it } from "vitest";
import {
  decideSessionSecurity,
  nextCredentialVersion,
  SessionSecurityError,
  type SessionSecurityInput,
} from "../server/services/security/sessionSecurityPolicy";

const now = 1_800_000_000_000;

function input(overrides: Partial<SessionSecurityInput> = {}): SessionSecurityInput {
  return {
    session: {
      userId: 1,
      createdAt: now - 60_000,
      lastSeenAt: now - 1_000,
      absoluteExpiresAt: now + 60_000,
      credentialVersion: 4,
      currentCompanyId: 10,
      passwordConfirmedAt: now - 1_000,
    },
    activeCredentialVersion: 4,
    now,
    requireCompanyContext: true,
    ...overrides,
  };
}

describe("session security policy", () => {
  it("accepts a current, company-scoped session", () => {
    expect(decideSessionSecurity(input())).toEqual({ valid: true, code: "SESSION_VALID" });
  });

  it("rejects missing sessions", () => {
    expect(decideSessionSecurity(input({ session: null }))).toEqual({
      valid: false,
      code: "SESSION_REQUIRED",
    });
  });

  it("rejects idle and absolute expiry", () => {
    expect(
      decideSessionSecurity(
        input({ session: { ...input().session!, lastSeenAt: now - 31 * 60_000 } })
      ).code
    ).toBe("SESSION_IDLE_EXPIRED");
    expect(
      decideSessionSecurity(
        input({ session: { ...input().session!, absoluteExpiresAt: now } })
      ).code
    ).toBe("SESSION_ABSOLUTE_EXPIRED");
  });

  it("rejects sessions created before a credential-version change", () => {
    expect(decideSessionSecurity(input({ activeCredentialVersion: 5 })).code).toBe(
      "SESSION_CREDENTIALS_REVOKED"
    );
  });

  it("requires valid company context", () => {
    expect(
      decideSessionSecurity(input({ session: { ...input().session!, currentCompanyId: null } })).code
    ).toBe("SESSION_COMPANY_REQUIRED");
  });

  it("requires recent password confirmation for sensitive actions", () => {
    expect(
      decideSessionSecurity(
        input({
          requireRecentPasswordConfirmation: true,
          session: { ...input().session!, passwordConfirmedAt: now - 6 * 60_000 },
        })
      ).code
    ).toBe("SESSION_PASSWORD_CONFIRMATION_REQUIRED");
  });

  it("increments credential versions safely", () => {
    expect(nextCredentialVersion(4)).toBe(5);
    expect(() => nextCredentialVersion(-1)).toThrowError(SessionSecurityError);
  });
});
