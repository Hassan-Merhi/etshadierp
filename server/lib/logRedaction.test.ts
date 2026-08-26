import { describe, expect, it } from "vitest";
import { redactLogString, redactLogValue } from "./logRedaction";

describe("log redaction", () => {
  it("redacts credentials and authorization values", () => {
    expect(redactLogValue("super-secret", "password")).toBe("[REDACTED]");
    expect(redactLogString("Bearer abc.def.ghi")).toContain("[AUTH_REDACTED]");
  });

  it("masks WhatsApp groups and contacts", () => {
    expect(redactLogString("243900005252-1614178245@g.us")).toBe("WhatsApp group …5252");
    expect(redactLogString("243900005252@c.us")).toBe("WhatsApp contact …5252");
  });

  it("removes signed query values and private file URLs", () => {
    expect(redactLogString("https://example.com/file.pdf?token=abc&signature=xyz")).toContain("REDACTED");
    expect(redactLogString("https://storage.example.com/private/invoice-1.pdf?token=abc", "fileUrl")).toBe("[PRIVATE_URL:invoice-1.pdf]");
  });

  it("masks phone and email fields", () => {
    expect(redactLogString("+243900005252", "customerPhone")).toBe("contact …5252");
    expect(redactLogString("adam@example.com", "email")).toBe("a***@example.com");
  });

  it("redacts inline CSRF token fragments from legacy warning strings", () => {
    const redacted = redactLogString(
      "CSRF: BLOCKED POST /api/example expected=abcdef12… got=1234abcd…",
    );
    expect(redacted).toContain("expected=[REDACTED]");
    expect(redacted).toContain("got=[REDACTED]");
    expect(redacted).not.toContain("abcdef12");
    expect(redacted).not.toContain("1234abcd");
  });
});
