import { describe, expect, it } from "vitest";

import { canUseAdminSearch, type ShellUser } from "./shellUser";

describe("canUseAdminSearch", () => {
  it.each(["Admin", "Owner", "Developer"])("allows %s users", (role) => {
    expect(canUseAdminSearch({ role } as ShellUser)).toBe(true);
  });

  it.each(["User", "Cashier", "Manager", undefined])("rejects non-admin role %s", (role) => {
    expect(canUseAdminSearch({ role } as ShellUser)).toBe(false);
  });
});
