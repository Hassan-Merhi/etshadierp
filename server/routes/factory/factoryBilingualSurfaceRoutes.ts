import type { Express, NextFunction, Request, Response } from "express";
import { parseFactoryCatalogLanguage, type FactoryCatalogLanguage } from "@shared/factoryBilingualContract";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { resolveFactoryBilingualSurfacePayload } from "../../services/factoryBilingualSurfaceResolver";

const LANGUAGE_COOKIE = "factory_catalog_language";
const READ_SURFACE_PATTERNS = [
  /^\/bales(?:\/|$)/, /^\/bale-transfers(?:\/|$)/, /^\/bale-ledger(?:\/|$)/,
  /^\/barcode(?:\/|$)/, /^\/lookup(?:\/|$)/, /^\/daily-bale-scans(?:\/|$)/,
  /^\/ground-scan(?:\/|$)/, /^\/stock(?:\/|$)/, /^\/stock-entry(?:\/|$)/, /^\/location-inventory(?:\/|$)/,
  /^\/production(?:\/|$)/, /^\/pressing(?:\/|$)/, /^\/customer-proformas(?:\/|$)/, /^\/customer-orders(?:\/|$)/,
  /^\/customer-invoices(?:\/|$)/, /^\/invoices(?:\/|$)/, /^\/invoice-loading(?:\/|$)/, /^\/container-loading(?:\/|$)/,
  /^\/dispatch(?:\/|$)/, /^\/stock-allocation(?:\/|$)/, /^\/bale-recode(?:\/|$)/, /^\/factory-pos(?:\/|$)/,
  /^\/reports(?:\/|$)/, /^\/backup(?:\/|$)/, /^\/offline(?:\/|$)/, /^\/prepare(?:\/|$)/, /^\/worker(?:\/|$)/,
];

function readCookie(header: unknown, name: string): string | null {
  if (typeof header !== "string") return null;
  for (const segment of header.split(";")) {
    const [key, ...parts] = segment.trim().split("=");
    if (key === name) return decodeURIComponent(parts.join("="));
  }
  return null;
}
function requestedLanguage(req: Request): FactoryCatalogLanguage {
  return parseFactoryCatalogLanguage(req.query.lang ?? req.headers["x-factory-catalog-language"] ?? readCookie(req.headers.cookie, LANGUAGE_COOKIE), "en");
}
function companyId(req: Request): number | null {
  const session = req.session as any;
  const value = Number(session?.factoryCompanyId ?? session?.currentCompanyId);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
function isReadSurface(req: Request): boolean {
  if (req.method !== "GET") return false;
  if (req.query.legacy === "1") return false;
  return READ_SURFACE_PATTERNS.some((pattern) => pattern.test(req.path));
}
function isPreservationPayload(req: Request): boolean {
  return /^\/(backup|offline|prepare|import)/.test(req.path);
}
function acceptsJson(res: Response, payload: unknown): boolean {
  if (payload === null || payload === undefined || Buffer.isBuffer(payload) || typeof payload === "string") return false;
  const contentType = String(res.getHeader("Content-Type") ?? "");
  return !contentType || contentType.includes("json");
}
function bilingualSurfaceMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!isReadSurface(req)) return next();
  const selectedCompanyId = companyId(req);
  if (!selectedCompanyId) return next();
  const language = requestedLanguage(req);
  const originalJson = res.json.bind(res);
  res.json = ((payload: unknown) => {
    if (res.statusCode < 200 || res.statusCode >= 300 || !acceptsJson(res, payload)) return originalJson(payload);
    void resolveFactoryBilingualSurfacePayload(selectedCompanyId, payload, language, { mutateLegacyDisplayFields: !isPreservationPayload(req) })
      .then((localized) => originalJson(localized))
      .catch((error) => {
        logger.error("Failed to resolve bilingual Factory surface payload", { error, path: req.path, companyId: selectedCompanyId, language });
        if (!res.headersSent) res.status(500);
        originalJson({ message: getErrorMessage(error) });
      });
    return res;
  }) as typeof res.json;
  next();
}
export function registerFactoryBilingualSurfaceRoutes(app: Express): void {
  app.use("/api/factory", bilingualSurfaceMiddleware);
  app.use("/api", bilingualSurfaceMiddleware);
}
