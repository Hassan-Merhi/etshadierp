import type { Request } from "express";
import { HttpError } from "./httpHandlers";

export function getSessionUserId(request: Request): string {
  const userId = request.session.userId;
  if (!userId) {
    throw new HttpError(401, "Not authenticated");
  }
  return userId;
}

export function getSessionCompanyId(request: Request): number {
  const companyId = request.session.currentCompanyId;
  if (!companyId) {
    throw new HttpError(400, "No company selected");
  }
  return companyId;
}

export function getSessionRole(request: Request): string {
  return request.session.currentRole ?? "";
}

export function requireSessionRole(request: Request, allowedRoles: readonly string[], message = "Access denied"): string {
  const role = getSessionRole(request);
  if (!allowedRoles.includes(role)) {
    throw new HttpError(403, message);
  }
  return role;
}

export function getSessionUsername(request: Request): string | undefined {
  const session = request.session as typeof request.session & { username?: string };
  return session.username;
}
