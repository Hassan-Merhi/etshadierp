import { describe, expect, it } from "vitest";
import {
  canAccessTargetUser,
  canAssignCompany,
  canAssignRole,
  canMutateGlobalUserAccount,
  filterRolesForCompany,
  visibleUserIdsForCompany,
} from "../server/services/security/companyUserAdminScopePolicy";

const rows = [
  { userId: "admin-a", companyId: 1, role: "Admin" },
  { userId: "shared", companyId: 1, role: "Manager" },
  { userId: "shared", companyId: 2, role: "Normal User" },
  { userId: "company-b", companyId: 2, role: "Admin" },
  { userId: "developer", companyId: 1, role: "Developer" },
];

describe("company-scoped user administration policy", () => {
  it("shows only non-developer users assigned to the active company", () => {
    expect([...visibleUserIdsForCompany(rows, 1)].sort()).toEqual(["admin-a", "shared"]);
  });

  it("filters a user's role response to the active company", () => {
    expect(filterRolesForCompany(rows.filter((row) => row.userId === "shared"), 1)).toEqual([
      { userId: "shared", companyId: 1, role: "Manager" },
    ]);
  });

  it("denies targets that are not assigned to the active company", () => {
    expect(canAccessTargetUser(rows, "company-b", 1, "Admin")).toBe(false);
  });

  it("hides developer targets from non-developer administrators", () => {
    expect(canAccessTargetUser(rows, "developer", 1, "Admin")).toBe(false);
    expect(canAccessTargetUser(rows, "developer", 1, "Developer")).toBe(true);
  });

  it("prevents one company admin from changing a shared global user account", () => {
    expect(canMutateGlobalUserAccount(rows, "shared", 1, "Admin")).toBe(false);
    expect(canMutateGlobalUserAccount(rows, "admin-a", 1, "Admin")).toBe(true);
    expect(canMutateGlobalUserAccount(rows, "shared", 1, "Developer")).toBe(true);
  });

  it("allows only Developers to assign the Developer role", () => {
    expect(canAssignRole("Admin", "Developer")).toBe(false);
    expect(canAssignRole("Developer", "Developer")).toBe(true);
    expect(canAssignRole("Admin", "Manager")).toBe(true);
  });

  it("binds tenant-admin role creation to the active company", () => {
    expect(canAssignCompany("Admin", 1, 1)).toBe(true);
    expect(canAssignCompany("Admin", 2, 1)).toBe(false);
    expect(canAssignCompany("Admin", "2", 1)).toBe(false);
    expect(canAssignCompany("Developer", 2, 1)).toBe(true);
  });
});
