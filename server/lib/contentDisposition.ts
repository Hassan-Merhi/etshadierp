/**
 * contentDisposition.ts
 *
 * Shared helper for building safe Content-Disposition headers for file downloads.
 *
 * Problem: Node.js throws ERR_INVALID_CHAR if res.setHeader() receives a header
 * value containing non-Latin-1 bytes (e.g. Arabic, CJK characters in customer
 * names/destinations).  It also chokes on bare apostrophes, newlines, and other
 * special bytes inside the quoted filename parameter.
 *
 * Solution: emit both
 *   filename="<ASCII-safe fallback>"            ← legacy browsers / Excel
 *   filename*=UTF-8''<RFC-5987-encoded>         ← modern browsers (full Unicode)
 *
 * Usage:
 *   res.setHeader("Content-Disposition", contentDisposition("My Report.xlsx"));
 *   res.setHeader("Content-Disposition", contentDisposition("report", "xlsx"));
 */

/**
 * Sanitise a raw string into a filename that is safe to embed in both the
 * ASCII quoted-string fallback and the RFC 5987 encoded parameter.
 *
 * What gets stripped / replaced:
 *  - non-ASCII characters (Latin-1 range 0x80-0xFF are replaced with "_")
 *  - control characters and NUL
 *  - characters illegal in HTTP quoted-strings: " \ CR LF
 *  - apostrophes ' (break RFC 5987 token parsing in some browsers/proxies)
 *  - filesystem-unsafe: / \ * ? : [ ] < > |
 *  - semicolons (would split the header parameter list)
 *  - runs of whitespace → single underscore
 *  - leading/trailing dots and underscores
 */
export function sanitiseFilename(raw: string): string {
  return raw
    .replace(/[^\x20-\x7E]/g, "_")       // non-ASCII / non-printable → _
    .replace(/[\r\n\t]/g, "_")            // control chars
    .replace(/["\\]/g, "")               // breaks quoted-string
    .replace(/[']/g, "")                 // apostrophe — breaks RFC 5987 token
    .replace(/[/\\*?:[\]<>|;]/g, "")    // filesystem + header-param unsafe
    .replace(/\s+/g, "_")               // whitespace → underscore
    .replace(/^[._]+|[._]+$/g, "")      // trim leading/trailing dots & underscores
    .trim() || "download";
}

/**
 * Build a safe filename from one or more string parts (e.g. container number,
 * customer name, destination) joined with underscores, with an optional extension.
 *
 * Drop-in replacement for all the local buildExportFilename helpers scattered
 * across route files.
 */
export function buildSafeFilename(
  parts: (string | null | undefined)[],
  ext?: string
): string {
  const safe = parts
    .filter((p): p is string => Boolean(p && p.trim()))
    .map((p) => sanitiseFilename(p))
    .filter((p) => p.length > 0 && p !== "download");
  const base = safe.join("_") || "export";
  return ext ? `${base}.${ext}` : base;
}

/**
 * Return a complete Content-Disposition header value for a file attachment.
 *
 * Emits both the ASCII fallback (`filename=`) and the RFC 5987 encoded form
 * (`filename*=`) so every browser/client gets the best experience:
 *
 *   attachment; filename="My_Report.xlsx"; filename*=UTF-8''My%20Report.xlsx
 *
 * Pass the full filename including extension as `filenameWithExt`, OR pass
 * a base name and `ext` separately.
 *
 * @param filenameWithExt  Full filename string (may contain special chars — will be sanitised)
 * @param disposition      "attachment" (default) or "inline"
 */
export function contentDisposition(
  filenameWithExt: string,
  disposition: "attachment" | "inline" = "attachment"
): string {
  const safe = sanitiseFilename(filenameWithExt);
  // RFC 5987: percent-encode everything except unreserved chars + a small set of safe chars.
  // We start from the *original* filename (not the stripped one) so Unicode names survive.
  const encoded = encodeRFC5987(filenameWithExt);
  return `${disposition}; filename="${safe}"; filename*=UTF-8''${encoded}`;
}

/**
 * RFC 5987 / RFC 8187 percent-encoding for Content-Disposition filename* parameter.
 * Encodes all bytes that are not in the "attr-char" set defined by RFC 8187 §3.2.1:
 *   ALPHA / DIGIT / "!" / "#" / "$" / "&" / "+" / "-" / "." / "^" / "_" / "`" / "|" / "~"
 */
function encodeRFC5987(str: string): string {
  return encodeURIComponent(str)
    // encodeURIComponent encodes most things; RFC 8187 also allows these:
    .replace(/%20/g, "%20") // keep space encoded
    // Decode chars that RFC 8187 attr-char permits unencoded (optional but cleaner):
    .replace(/%21/gi, "!")
    .replace(/%23/gi, "#")
    .replace(/%24/gi, "$")
    .replace(/%26/gi, "&")
    .replace(/%2B/gi, "+")
    .replace(/%2D/gi, "-")
    .replace(/%2E/gi, ".")
    .replace(/%5E/gi, "^")
    .replace(/%5F/gi, "_")
    .replace(/%60/gi, "`")
    .replace(/%7C/gi, "|")
    .replace(/%7E/gi, "~");
}
