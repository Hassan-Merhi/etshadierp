import { describe, expect, it } from "vitest";

import { AVATAR_COLORS, fmt, getAvatarColor, getInitials } from "./utils";

describe("ERP payroll presentation helpers", () => {
  it("keeps worker initials limited to the first two names", () => {
    expect(getInitials("  jane   mary doe ")).toBe("JM");
  });

  it("assigns the same palette color for the same worker name", () => {
    const color = getAvatarColor("Jane Doe");

    expect(AVATAR_COLORS).toContain(color);
    expect(getAvatarColor("Jane Doe")).toBe(color);
  });

  it("formats payroll values to two decimals and defaults invalid values to zero", () => {
    expect(fmt("12.5")).toBe("12.50");
    expect(fmt(null)).toBe("0.00");
    expect(fmt("not-a-number")).toBe("0.00");
  });
});
