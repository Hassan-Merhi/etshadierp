import { and, eq, inArray } from "drizzle-orm";
import { userCompanyRoles, userLocationCashAccounts } from "@shared/schema";

export type AccountMigrationControlSnapshot = {
  roleCashAccounts: Array<{ roleId: number; accountId: number }>;
  locationCashAccounts: Array<{
    userId: string;
    companyId: number;
    locationId: number;
    cashAccountId: number;
    posStation: number | null;
    createdAt: string | null;
  }>;
};

export class AccountMigrationControlConflict extends Error {
  readonly status = 409;
  readonly code = "23514";

  constructor(message: string) {
    super(message);
    this.name = "AccountMigrationControlConflict";
  }
}

export async function detachAccountMigrationControlReferences(
  tx: any,
  sourceCompanyId: number,
  accountIds: number[],
): Promise<AccountMigrationControlSnapshot> {
  const roleRows = await tx
    .select({ id: userCompanyRoles.id, cashAccountId: userCompanyRoles.cashAccountId })
    .from(userCompanyRoles)
    .where(
      and(
        eq(userCompanyRoles.companyId, sourceCompanyId),
        inArray(userCompanyRoles.cashAccountId, accountIds),
      ),
    );

  const locationRows = await tx
    .select()
    .from(userLocationCashAccounts)
    .where(
      and(
        eq(userLocationCashAccounts.companyId, sourceCompanyId),
        inArray(userLocationCashAccounts.cashAccountId, accountIds),
      ),
    );

  if (roleRows.length > 0) {
    await tx
      .update(userCompanyRoles)
      .set({ cashAccountId: null })
      .where(inArray(userCompanyRoles.id, roleRows.map((row: any) => row.id)));
  }

  if (locationRows.length > 0) {
    await tx
      .delete(userLocationCashAccounts)
      .where(inArray(userLocationCashAccounts.id, locationRows.map((row: any) => row.id)));
  }

  return {
    roleCashAccounts: roleRows
      .filter((row: any) => row.cashAccountId !== null)
      .map((row: any) => ({ roleId: row.id, accountId: row.cashAccountId })),
    locationCashAccounts: locationRows.map((row: any) => ({
      userId: row.userId,
      companyId: row.companyId,
      locationId: row.locationId,
      cashAccountId: row.cashAccountId,
      posStation: row.posStation ?? null,
      createdAt: row.createdAt ? row.createdAt.toISOString() : null,
    })),
  };
}

export async function assertDestinationControlReferencesAreClear(
  tx: any,
  destinationCompanyId: number,
  accountIds: number[],
): Promise<void> {
  const roleRows = await tx
    .select({ id: userCompanyRoles.id })
    .from(userCompanyRoles)
    .where(
      and(
        eq(userCompanyRoles.companyId, destinationCompanyId),
        inArray(userCompanyRoles.cashAccountId, accountIds),
      ),
    );
  const locationRows = await tx
    .select({ id: userLocationCashAccounts.id })
    .from(userLocationCashAccounts)
    .where(
      and(
        eq(userLocationCashAccounts.companyId, destinationCompanyId),
        inArray(userLocationCashAccounts.cashAccountId, accountIds),
      ),
    );

  if (roleRows.length > 0 || locationRows.length > 0) {
    throw new AccountMigrationControlConflict(
      "The migrated account is assigned to a destination-company user or POS location. Remove that assignment before undoing.",
    );
  }
}

export async function restoreAccountMigrationControlReferences(
  tx: any,
  sourceCompanyId: number,
  snapshot: AccountMigrationControlSnapshot,
): Promise<void> {
  for (const role of snapshot.roleCashAccounts) {
    const [current] = await tx
      .select({ companyId: userCompanyRoles.companyId, cashAccountId: userCompanyRoles.cashAccountId })
      .from(userCompanyRoles)
      .where(eq(userCompanyRoles.id, role.roleId));
    if (!current || current.companyId !== sourceCompanyId || current.cashAccountId !== null) {
      throw new AccountMigrationControlConflict(
        `Source-company user role ${role.roleId} changed after migration.`,
      );
    }
  }

  if (snapshot.locationCashAccounts.length > 0) {
    const existing = await tx
      .select({
        userId: userLocationCashAccounts.userId,
        companyId: userLocationCashAccounts.companyId,
        locationId: userLocationCashAccounts.locationId,
      })
      .from(userLocationCashAccounts)
      .where(eq(userLocationCashAccounts.companyId, sourceCompanyId));
    const occupied = new Set(
      existing.map((row: any) => `${row.userId}:${row.companyId}:${row.locationId}`),
    );
    const conflict = snapshot.locationCashAccounts.find((row) =>
      occupied.has(`${row.userId}:${row.companyId}:${row.locationId}`),
    );
    if (conflict) {
      throw new AccountMigrationControlConflict(
        `A POS cash mapping now exists for user ${conflict.userId} and location ${conflict.locationId}.`,
      );
    }
  }

  for (const role of snapshot.roleCashAccounts) {
    await tx
      .update(userCompanyRoles)
      .set({ cashAccountId: role.accountId })
      .where(and(eq(userCompanyRoles.id, role.roleId), eq(userCompanyRoles.companyId, sourceCompanyId)));
  }

  if (snapshot.locationCashAccounts.length > 0) {
    await tx.insert(userLocationCashAccounts).values(
      snapshot.locationCashAccounts.map((row) => ({
        userId: row.userId,
        companyId: row.companyId,
        locationId: row.locationId,
        cashAccountId: row.cashAccountId,
        posStation: row.posStation,
        createdAt: row.createdAt ? new Date(row.createdAt) : undefined,
      })),
    );
  }
}
