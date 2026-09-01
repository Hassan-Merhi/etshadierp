import type { Session } from "express-session";
import { eq } from "drizzle-orm";
import { users } from "@shared/schema";
import { db, pool } from "../../db";
import { bumpCredentialVersion, revokeUserSessions } from "./credentialVersionService";

type CredentialVersionSession = Session & {
  credentialVersion?: number;
  activeCredentialVersion?: number;
  credentialVersionCheckedAt?: number;
  passwordConfirmedAt?: number;
};

/**
 * Replace a user's password and rotate the persisted credential version in one
 * database transaction, then revoke every other server-side session.
 */
export async function replacePasswordAndRevokeSessions(
  userId: string,
  passwordHash: string,
  options: { exceptSid?: string | null } = {}
): Promise<number> {
  const credentialVersion = await db.transaction(async (tx) => {
    await tx.update(users).set({ password: passwordHash }).where(eq(users.id, userId));
    return bumpCredentialVersion(tx, userId);
  });

  await revokeUserSessions(pool, userId, options.exceptSid);
  return credentialVersion;
}

/** Keep the session that performed a verified self-service password change. */
export function advanceCurrentSessionAfterPasswordChange(
  session: Session,
  credentialVersion: number,
  now = Date.now()
): void {
  const securitySession = session as CredentialVersionSession;
  securitySession.credentialVersion = credentialVersion;
  securitySession.activeCredentialVersion = credentialVersion;
  securitySession.credentialVersionCheckedAt = now;
  securitySession.passwordConfirmedAt = now;
}
