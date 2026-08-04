import type { Express, Request, Response } from "express";
import { requireAuth, requireLogin } from "../auth";
import { getSessionRole, getSessionUserId, getSessionUsername } from "../lib/requestContext";
import { isRemoteSupportEnabled } from "../services/remoteSupportRuntime";
import {
  RemoteControlSessionError,
  getActiveRemoteControlSession,
  getRemoteControlSession,
  heartbeatRemoteControlController,
  isRemoteControlControllerRole,
  listRemoteControlTabs,
  registerRemoteControlTab,
  startRemoteControlSession,
  stopRemoteControlSession,
  subscribeRemoteControlTarget,
  type RemoteControlSession,
} from "../services/remoteControlSessionService";

const STATUS_REFRESH_MS = 5000;

type FlushableResponse = Response & { flush?: () => void };

function sessionUserId(req: Request): string {
  const value = getSessionUserId(req);
  return value === null || value === undefined ? "" : String(value);
}

function sessionUsername(req: Request): string {
  return getSessionUsername(req) || sessionUserId(req);
}

function sessionRole(req: Request): string {
  return getSessionRole(req) || "";
}

function requireController(req: Request, res: Response): boolean {
  if (!isRemoteControlControllerRole(sessionRole(req))) {
    res.status(403).json({ message: "Access denied." });
    return false;
  }
  return true;
}

function serializeSession(session: RemoteControlSession | null) {
  if (!session) return null;
  return {
    ...session,
    startedAt: new Date(session.startedAt).toISOString(),
    expiresAt: new Date(session.expiresAt).toISOString(),
    lastControllerHeartbeatAt: new Date(session.lastControllerHeartbeatAt).toISOString(),
    lastTargetHeartbeatAt: new Date(session.lastTargetHeartbeatAt).toISOString(),
    stoppedAt: session.stoppedAt ? new Date(session.stoppedAt).toISOString() : null,
  };
}

function openEventStream(res: Response): void {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  res.write("retry: 3000\n\n");
}

function writeEvent(res: Response, event: string, payload: unknown): void {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  (res as FlushableResponse).flush?.();
}

function handleSessionError(error: unknown, res: Response): void {
  if (error instanceof RemoteControlSessionError) {
    res.status(error.statusCode).json({ code: error.code, message: error.message });
    return;
  }
  res.status(500).json({ message: "Unable to manage the support session." });
}

export function registerRemoteControlSessionRoutes(app: Express): void {
  app.get("/api/screen-feed/control/tabs/:userId", requireAuth, (req, res) => {
    if (!requireController(req, res)) return;
    res.setHeader("Cache-Control", "no-store");
    res.json({ tabs: listRemoteControlTabs(req.params.userId) });
  });

  app.post("/api/screen-feed/control/tab-heartbeat", requireLogin, (req, res) => {
    try {
      const session = registerRemoteControlTab({
        userId: sessionUserId(req),
        username: sessionUsername(req),
        tabId: req.body?.tabId,
        route: req.body?.route,
      });
      res.setHeader("Cache-Control", "no-store");
      res.json({
        enabled: isRemoteSupportEnabled("remoteControl"),
        session: serializeSession(session),
      });
    } catch (error) {
      handleSessionError(error, res);
    }
  });

  app.get("/api/screen-feed/control/status", requireLogin, (req, res) => {
    const userId = sessionUserId(req);
    const tabId = typeof req.query.tabId === "string" ? req.query.tabId : "";
    if (!tabId) return res.status(400).json({ message: "A browser tab identifier is required." });

    try {
      registerRemoteControlTab({
        userId,
        username: sessionUsername(req),
        tabId,
        route: typeof req.query.route === "string" ? req.query.route : "/",
      });
    } catch (error) {
      return handleSessionError(error, res);
    }

    openEventStream(res);
    let closed = false;

    const sendStatus = () => {
      writeEvent(res, "control", {
        enabled: isRemoteSupportEnabled("remoteControl"),
        session: serializeSession(getActiveRemoteControlSession(userId, tabId)),
      });
    };

    const unsubscribe = subscribeRemoteControlTarget(userId, sendStatus);
    const refreshId = setInterval(sendStatus, STATUS_REFRESH_MS);
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(refreshId);
      unsubscribe();
      if (!res.writableEnded) res.end();
    };

    req.once("close", cleanup);
    res.once("close", cleanup);
    sendStatus();
  });

  app.get("/api/screen-feed/control/sessions/active/:userId", requireAuth, (req, res) => {
    if (!requireController(req, res)) return;
    res.setHeader("Cache-Control", "no-store");
    res.json({ session: serializeSession(getActiveRemoteControlSession(req.params.userId)) });
  });

  app.post("/api/screen-feed/control/sessions", requireAuth, (req, res) => {
    if (!requireController(req, res)) return;
    try {
      const durationMinutes = Number(req.body?.durationMinutes);
      const session = startRemoteControlSession({
        targetUserId: req.body?.targetUserId,
        targetUsername: req.body?.targetUsername,
        requestedTabId: req.body?.tabId,
        controllerUserId: sessionUserId(req),
        controllerUsername: sessionUsername(req),
        controllerRole: sessionRole(req),
        durationMs: Number.isFinite(durationMinutes) ? durationMinutes * 60 * 1000 : undefined,
      });
      res.status(201).json({ session: serializeSession(session) });
    } catch (error) {
      handleSessionError(error, res);
    }
  });

  app.post("/api/screen-feed/control/sessions/:sessionId/heartbeat", requireAuth, (req, res) => {
    if (!requireController(req, res)) return;
    const session = heartbeatRemoteControlController(req.params.sessionId, sessionUserId(req));
    if (!session) return res.status(404).json({ message: "The support session is no longer active." });
    res.setHeader("Cache-Control", "no-store");
    res.json({ session: serializeSession(session) });
  });

  app.post("/api/screen-feed/control/sessions/:sessionId/stop", requireLogin, (req, res) => {
    const session = getRemoteControlSession(req.params.sessionId);
    if (!session) return res.status(404).json({ message: "Support session not found." });

    const actorUserId = sessionUserId(req);
    const actorIsTarget = session.targetUserId === actorUserId;
    const actorIsController = session.controllerUserId === actorUserId;
    const actorIsAuthorizedController = isRemoteControlControllerRole(sessionRole(req));
    if (!actorIsTarget && !actorIsController && !actorIsAuthorizedController) {
      return res.status(403).json({ message: "Access denied." });
    }

    const reason =
      typeof req.body?.reason === "string" && req.body.reason.trim()
        ? req.body.reason.trim().slice(0, 160)
        : actorIsTarget
          ? "target-emergency-stop"
          : "controller-stopped";
    const stopped = stopRemoteControlSession(session.id, reason);
    res.setHeader("Cache-Control", "no-store");
    res.json({ session: serializeSession(stopped) });
  });
}
