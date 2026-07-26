import { describe, expect, it } from "vitest";
import {
  classifyScopedAdministrationRequest,
  decideSharedUserMutation,
} from "../server/services/security/companyScopedAdministrationPolicy";

describe("company-scoped administration policy", () => {
  it("classifies scoped user administration routes", () => {
    expect(classifyScopedAdministrationRequest("GET", "/api/users")).toBe("list-company-users");
    expect(
      classifyScopedAdministrationRequest("GET", "/api/users/user-1/company-roles")
    ).toBe("list-company-user-roles");
    expect(classifyScopedAdministrationRequest("PATCH", "/api/users/user-1")).toBe(
      "mutate-global-user"
    );
    expect(
      classifyScopedAdministrationRequest("POST", "/api/admin/reset-password/user-1")
    ).toBe("mutate-global-user");
    expect(
      classifyScopedAdministrationRequest("DELETE", "/api/user-company-roles/12")
    ).toBe("mutate-company-role");
    expect(
      classifyScopedAdministrationRequest("POST", "/api/cleanup/orphaned-charges")
    ).toBe("cleanup-orphaned-charges");
  });

  it("does not intercept unrelated routes", () => {
    expect(classifyScopedAdministrationRequest("GET", "/api/users/user-1")).toBe("none");
    expect(classifyScopedAdministrationRequest("POST", "/api/users")).toBe("none");
    expect(classifyScopedAdministrationRequest("GET", "/api/deleted-items")).toBe("none");
  });

  it("allows a global user mutation only for a user exclusive to the active company", () => {
    expect(decideSharedUserMutation(3, [3])).toBe("allow");
    expect(decideSharedUserMutation(3, [3, 3])).toBe("allow");
  });

  it("hides users that do not belong to the active company", () => {
    expect(decideSharedUserMutation(3, [4])).toBe("not-found");
    expect(decideSharedUserMutation(3, [])).toBe("not-found");
  });

  it("blocks global mutation of a user shared by multiple companies", () => {
    expect(decideSharedUserMutation(3, [3, 4])).toBe("shared-user-blocked");
  });
});
