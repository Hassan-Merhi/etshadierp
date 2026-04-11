import type { Request } from "express";

/**
 * Returns today's date string (YYYY-MM-DD) in the client's local timezone.
 * Reads the X-Client-Date header sent by the browser (which uses the user's
 * system timezone). Falls back to UTC today if the header is absent.
 */
export function getClientDate(req: Request): string {
  const header = req.headers["x-client-date"];
  if (typeof header === "string" && /^\d{4}-\d{2}-\d{2}$/.test(header)) {
    return header;
  }
  return new Date().toISOString().split("T")[0];
}
