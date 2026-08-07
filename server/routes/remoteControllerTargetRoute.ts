import type { Express, Request, Response } from "express";
import { requireAuth } from "../auth";
import { requireActionAccess } from "../lib/permissionMiddleware";
import { getSessionCompanyId, getSessionRole, getSessionUserId } from "../lib/requestContext";
import { getRemoteMouseAuthorization, type RemoteMouseAuthorization } from "../services/remoteControlCommandService";
import {
  getRemoteKeyboardAuthorization,
  type RemoteKeyboardAuthorization,
} from "../services/remoteKeyboardCommandService";
import {
  isRemoteControlControllerRole,
  listActiveRemoteControlSessionsForController,
  type RemoteControlSession,
} from "../services/remoteControlSessionService";

const viewPermission = requireActionAccess("remote_support_view");

function controllerUserId(req: Request): string {
  const value = getSessionUserId(req);
  return value === null || value === undefined ? "" : String(value);
}

function requireController(req: Request, res: Response): boolean {
  if (!isRemoteControlControllerRole(getSessionRole(req))) {
    res.status(403).json({ message: "Access denied." });
    return false;
  }
  return true;
}

function serializeSession(session: RemoteControlSession) {
  return {
    ...session,
    startedAt: new Date(session.startedAt).toISOString(),
    expiresAt: new Date(session.expiresAt).toISOString(),
    lastControllerHeartbeatAt: new Date(session.lastControllerHeartbeatAt).toISOString(),
    lastTargetHeartbeatAt: new Date(session.lastTargetHeartbeatAt).toISOString(),
    stoppedAt: session.stoppedAt ? new Date(session.stoppedAt).toISOString() : null,
  };
}

function serializeAuthorization(authorization: RemoteMouseAuthorization | RemoteKeyboardAuthorization | null) {
  if (!authorization) return null;
  return {
    ...authorization,
    authorizedAt: new Date(authorization.authorizedAt).toISOString(),
    expiresAt: new Date(authorization.expiresAt).toISOString(),
  };
}

/**
 * Returns only the active session owned by this controller for the exact user
 * currently open in the watch dialog. This avoids the old sessions[0]/username
 * fallback and gives mouse + keyboard overlays one shared authoritative state.
 */
export function registerRemoteControllerTargetRoute(app: Express): void {
  app.get(
    "/api/screen-feed/control/sessions/controller-target/:userId",
    requireAuth,
    viewPermission,
    (req, res) => {
      if (!requireController(req, res)) return;
      const ownerId = controllerUserId(req);
      const targetUserId = String(req.params.userId ?? "").trim();
      const companyId = getSessionCompanyId(req);
      const session = listActiveRemoteControlSessionsForController(ownerId).find(
        (candidate) => candidate.companyId === companyId && candidate.targetUserId === targetUserId
      );

      res.setHeader("Cache-Control", "no-store");
      if (!session) return res.json({ session: null });

      res.json({
        session: {
          ...serializeSession(session),
          mouseAuthorization: serializeAuthorization(getRemoteMouseAuthorization(session.id, ownerId)),
          keyboardAuthorization: serializeAuthorization(getRemoteKeyboardAuthorization(session.id, ownerId)),
        },
      });
    }
  );
}
