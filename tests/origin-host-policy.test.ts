import { describe, expect, it } from "vitest";
import { isTrustedOriginHost } from "../server/security/originHostPolicy";

describe("origin host policy", () => {
  it("accepts exact same-host requests", () => {
    expect(isTrustedOriginHost("app.example.com", "app.example.com")).toBe(true);
  });

  it("accepts the explicit HMD apex and www production aliases in both directions", () => {
    expect(isTrustedOriginHost("hmdinternationalgroup.com", "www.hmdinternationalgroup.com")).toBe(true);
    expect(isTrustedOriginHost("www.hmdinternationalgroup.com", "hmdinternationalgroup.com")).toBe(true);
  });

  it("does not generically trust www aliases for unrelated domains", () => {
    expect(isTrustedOriginHost("example.com", "www.example.com")).toBe(false);
  });

  it("does not trust unrelated origins", () => {
    expect(isTrustedOriginHost("evil.example", "www.hmdinternationalgroup.com")).toBe(false);
  });

  it("does not widen trust across explicit port boundaries", () => {
    expect(isTrustedOriginHost("hmdinternationalgroup.com:8443", "www.hmdinternationalgroup.com")).toBe(false);
    expect(isTrustedOriginHost("hmdinternationalgroup.com:8443", "www.hmdinternationalgroup.com:9443")).toBe(false);
    expect(isTrustedOriginHost("hmdinternationalgroup.com:8443", "www.hmdinternationalgroup.com:8443")).toBe(true);
  });

  it("normalizes hostname case and a trailing dot", () => {
    expect(isTrustedOriginHost("HMDInternationalGroup.com.", "www.hmdinternationalgroup.com")).toBe(true);
  });
});
