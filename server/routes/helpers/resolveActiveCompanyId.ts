import type { Request } from "express";

/**
 * Resolve the active company ID for the current request.
 *
 * Rules:
 *   - Factory routes (and Properties routes that use factoryCompanyId) set
 *     `req.session.factoryCompanyId` when the user switches to factory/properties mode.
 *   - ERP routes use `req.session.currentCompanyId`.
 *   - When the user switches back to ERP, the company-switch route clears
 *     `factoryCompanyId` from the session, so the fallback to `currentCompanyId`
 *     is safe for ERP contexts.
 *
 * Never trust a company ID from the request query string or body — this
 * function uses only the server-owned session.
 *
 * This is the single authoritative implementation; import it from here
 * instead of inlining the same pattern in every route file.
 */
export function resolveActiveCompanyId(req: Request): number | null {
  return (
    (req.session as any).factoryCompanyId ||
    (req.session as any).currentCompanyId ||
    null
  );
}
