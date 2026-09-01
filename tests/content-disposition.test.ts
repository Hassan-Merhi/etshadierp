/**
 * Unit tests for server/lib/contentDisposition.ts — builds Content-Disposition
 * headers for file downloads. The security-critical property is that the header
 * value is always Latin-1/ASCII-safe (Node throws ERR_INVALID_CHAR otherwise),
 * while full Unicode still survives via the RFC 5987 filename* parameter.
 */
import {
  sanitiseFilename,
  buildSafeFilename,
  contentDisposition,
} from "../server/lib/contentDisposition";

const isAscii = (s: string) => /^[\x00-\x7F]*$/.test(s);

describe("sanitiseFilename", () => {
  it("replaces spaces with underscores", () => {
    expect(sanitiseFilename("My Report.xlsx")).toBe("My_Report.xlsx");
  });

  it("strips quotes, backslashes, and apostrophes", () => {
    expect(sanitiseFilename('O\'Br"ien\\file')).toBe("OBrienfile");
  });

  it("strips filesystem- and header-unsafe characters", () => {
    expect(sanitiseFilename("a/b*c?d:e;f")).toBe("abcdef");
  });

  it("trims leading/trailing dots and underscores", () => {
    expect(sanitiseFilename("..hidden..")).toBe("hidden");
  });

  it("falls back to 'download' when nothing printable remains", () => {
    expect(sanitiseFilename("تقرير")).toBe("download");
    expect(sanitiseFilename("")).toBe("download");
  });

  it("always yields an ASCII-safe result", () => {
    expect(isAscii(sanitiseFilename("naïve—résumé.pdf"))).toBe(true);
  });
});

describe("buildSafeFilename", () => {
  it("joins non-empty parts with underscores and appends an extension", () => {
    expect(buildSafeFilename(["container", "customer"], "xlsx")).toBe("container_customer.xlsx");
  });

  it("skips null/undefined/blank parts", () => {
    expect(buildSafeFilename(["A", null, "  ", undefined, "B"])).toBe("A_B");
  });

  it("falls back to 'export' when no usable parts remain", () => {
    expect(buildSafeFilename([null, "تقرير"], "csv")).toBe("export.csv");
    expect(buildSafeFilename([])).toBe("export");
  });
});

describe("contentDisposition", () => {
  it("emits both an ASCII fallback and an RFC 5987 filename*", () => {
    const header = contentDisposition("My Report.xlsx");
    expect(header).toBe("attachment; filename=\"My_Report.xlsx\"; filename*=UTF-8''My%20Report.xlsx");
  });

  it("honours an inline disposition", () => {
    expect(contentDisposition("f.pdf", "inline")).toMatch(/^inline; filename=/);
  });

  it("keeps the whole header ASCII-safe even for Unicode names", () => {
    const header = contentDisposition("تقرير الشحن.xlsx");
    expect(isAscii(header)).toBe(true);
    expect(header).toContain("filename*=UTF-8''");
    // Arabic bytes survive percent-encoded in filename* (UTF-8 lead byte 0xD8).
    expect(header).toMatch(/%D8/i);
  });
});
