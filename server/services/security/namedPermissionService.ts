import { and, eq } from "drizzle-orm";
import { userCompanyRoles, userSecurityPermissions } from "@shared/schema";

export const KNOWN_SECURITY_PERMISSIONS = Object.freeze([
  "administration.repair",
  "security.permissions.manage",
  "security.anomalies.read",
  "factory.documents.download",
] as const);

export type KnownSecurityPermission = (typeof KNOWN_SECURITY_PERMISSIONS)[number];

export function normalizePermissionList(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("Invalid permissions");
  const known = new Set<string>(KNOWN_SECURITY_PERMISSIONS);
  const normalized = [...new Set(value.map((item) => (typeof item === "string" ? item.trim() : "")))].filter(Boolean);
  if (normalized.some((item) => !known.has(item))) throw new Error("Invalid permissions");
  return normalized.sort();
}

export async function loadNamedPermissions(db: any, userId: string, companyId: number): Promise<string[]> {
  const rows = await db
    .select({ permission: userSecurityPermissions.permission })
    .from(userSecurityPermissions)
    .where(and(eq(userSecurityPermissions.userId, userId), eq(userSecurityPermissions.companyId, companyId)));
  return [...new Set(rows.map((row: any) => String(row.permission)))].sort();
}

export async function assertUserBelongsToCompany(db: any, userId: string, companyId: number): Promise<void> {
  const [membership] = await db
    .select({ userId: userCompanyRoles.userId })
    .from(userCompanyRoles)
    .where(and(eq(userCompanyRoles.userId, userId), eq(userCompanyRoles.companyId, companyId)))
    .limit(1);
  if (!membership) throw new Error("User not found");
}

export async function replaceNamedPermissions(
  tx: any,
  params: { userId: string; companyId: number; permissions: string[]; grantedBy: string }
): Promise<string[]> {
  const permissions = normalizePermissionList(params.permissions);
  await assertUserBelongsToCompany(tx, params.userId, params.companyId);
  await tx
    .delete(userSecurityPermissions)
    .where(and(eq(userSecurityPermissions.userId, params.userId), eq(userSecurityPermissions.companyId, params.companyId)));
  if (permissions.length) {
    await tx.insert(userSecurityPermissions).values(
      permissions.map((permission) => ({
        userId: params.userId,
        companyId: params.companyId,
        permission,
        grantedBy: params.grantedBy,
        updatedAt: new Date(),
      }))
    );
  }
  return permissions;
}

export async function hydrateSessionNamedPermissions(db: any, session: any): Promise<string[]> {
  const userId = session?.userId;
  const companyId = session?.currentCompanyId;
  if (!userId || !Number.isSafeInteger(companyId) || companyId <= 0) {
    session.securityPermissions = [];
    session.securityPermissionsCompanyId = null;
    return [];
  }
  if (Array.isArray(session.securityPermissions)) {
    if (session.securityPermissionsCompanyId === companyId) return session.securityPermissions;
    if (session.securityPermissionsCompanyId == null) {
      session.securityPermissionsCompanyId = companyId;
      return session.securityPermissions;
    }
  }
  const permissions = await loadNamedPermissions(db, String(userId), companyId);
  session.securityPermissions = permissions;
  session.securityPermissionsCompanyId = companyId;
  return permissions;
}

export async function invalidateUserCompanySessions(pool: any, userId: string, companyId: number): Promise<void> {
  await pool.query(
    `DELETE FROM session WHERE sess->>'userId' = $1 AND COALESCE((sess->>'currentCompanyId')::int, 0) = $2`,
    [userId, companyId]
  );
}
