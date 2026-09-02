import type { NextFunction, Request, RequestHandler, Response } from "express";
import multer from "multer";

import {
  createTenantDatabaseScope,
  getDatabaseScopeRuntimeContext,
  runWithDatabaseScopeRuntimeContext,
} from "../../services/security/databaseScopeRuntimeContext";

const baseUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function continueInSessionTenantScope(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.userId) {
    next();
    return;
  }

  const companyId = Number(req.session.currentCompanyId);
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    next();
    return;
  }

  const currentScope = getDatabaseScopeRuntimeContext();
  if (currentScope?.kind === "tenant" && currentScope.companyId !== companyId) {
    res.status(403).json({
      code: "UPLOAD_COMPANY_SCOPE_MISMATCH",
      message: "Upload company scope does not match the active company.",
    });
    return;
  }

  const tenantScope =
    currentScope?.kind === "tenant" ? currentScope : createTenantDatabaseScope(companyId, [], "active-company");

  runWithDatabaseScopeRuntimeContext(tenantScope, () => next());
}

function withPostMultipartTenantScope(middleware: RequestHandler): RequestHandler {
  // The route manifest records each handler slot by function name, and this wrapper occupies the
  // multipart slot that Multer used to fill directly. Keeping the name means the snapshot still
  // reads `multerMiddleware` for every upload route, so a genuine handler-chain change stays
  // visible instead of being buried under a rename of every upload route at once.
  const multerMiddleware: RequestHandler = (req, res, next) => {
    middleware(req, res, (error?: unknown) => {
      if (error) {
        next(error);
        return;
      }

      continueInSessionTenantScope(req, res, next);
    });
  };
  return multerMiddleware;
}

/**
 * Multer can complete its multipart work from async resources that do not retain
 * request AsyncLocalStorage state. Every upload middleware therefore re-roots
 * the already-authenticated session company scope after Multer finishes and
 * immediately before the route handler executes.
 *
 * This does not authorize a company supplied by the request body. The only
 * fallback scope comes from the server-owned authenticated session company, and
 * an existing conflicting tenant scope still fails closed.
 */
export const upload = new Proxy(baseUpload, {
  get(target, property, receiver) {
    if (property === "single") {
      return (...args: Parameters<typeof target.single>) => withPostMultipartTenantScope(target.single(...args));
    }
    if (property === "array") {
      return (...args: Parameters<typeof target.array>) => withPostMultipartTenantScope(target.array(...args));
    }
    if (property === "fields") {
      return (...args: Parameters<typeof target.fields>) => withPostMultipartTenantScope(target.fields(...args));
    }
    if (property === "none") {
      return (...args: Parameters<typeof target.none>) => withPostMultipartTenantScope(target.none(...args));
    }
    if (property === "any") {
      return (...args: Parameters<typeof target.any>) => withPostMultipartTenantScope(target.any(...args));
    }

    return Reflect.get(target, property, receiver);
  },
});
