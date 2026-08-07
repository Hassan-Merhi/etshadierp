import type { Express, Request, Response } from "express";
import { requireAuth, requireLogin } from "../auth";
import { logger } from "../lib/logger";
import { requireActionAccess } from "../lib/permissionMiddleware";
import { getSessionCompanyId, getSessionRole, getSessionUserId, getSessionUsername } from "../lib/requestContext";
import {
  screenFeedCursorStore,
  screenFeedStore,
  watcherPollStore,
  type ScreenFeedCursor,
  type ScreenFrame,
} from "../screenFeedStore";
import {
  RemoteControlSessionError,
  heartbeatRemoteControlController,
  isRemoteControlControllerRole,
  startRemoteControlSession,
  stopAllRemoteControlSessions,
  stopRemoteControlSession,
  type RemoteControlSession,
} from "../services/remoteControlSessionService";
import { screenFeedLiveHub } from "../services/screenFeedLiveHub";
import {
  isValidScreenFeedDataUrl,
  sanitizeScreenFeedCapture,
  sanitizeScreenFeedClicks,
  sanitizeScreenFeedClientCapturedAt,
  sanitizeScreenFeedCursor,
  sanitizeScreenFeedViewport,
} from "../services/screenFeedService";
import { writeRemoteSupportAudit } from "../services/remoteSupportAuditService";
import {
  emergencyDisableRemoteSupport,
  getRemoteSupportRuntimeSnapshot,
  isRemoteSupportEnabled,
  recordRemoteSupportMetric,
  resetRemoteSupportMetrics,
  restoreRemoteSupportBootDefaults,
  updateRemoteSupportFlags,
} from "../services/remoteSupportRuntime";

const WATCHER_TIMEOUT_MS = 12000;
const LIVE_STATUS_REFRESH_MS = 4000;
const LIVE_HEARTBEAT_MS = 5000;
const MAX_FRAME_SIZE = 1_500_000;
const isDev = process.env.NODE_ENV !== "production";
const viewPermission = requireActionAccess("remote_support_view");

type FlushableResponse = Response & { flush?: () => void };

function requireDeveloper(req: Request, res: Response): boolean {
  if (getSessionRole(req) !== "Developer") {
    res.status(403).json({ message: "Access denied." });
    return false;
  }
  return true;
}

function requireSupportController(req: Request, res: Response): boolean {
  if (!isRemoteControlControllerRole(getSessionRole(req))) {
    res.status(403).json({ message: "Access denied." });
    return false;
  }
  return true;
}

function runtimeActor(req: Request): string {
  return getSessionUsername(req) || String(getSessionUserId(req));
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

function writeHeartbeat(res: Response): void {
  if (res.writableEnded || res.destroyed) return;
  res.write(`: heartbeat ${Date.now()}\n\n`);
  (res as FlushableResponse).flush?.();
}

function isUserBeingWatched(userId: string): boolean {
  if (screenFeedLiveHub.hasViewer(userId)) return true;
  const lastPoll = watcherPollStore.get(userId) ?? 0;
  return lastPoll > 0 && Date.now() - lastPoll < WATCHER_TIMEOUT_MS;
}

function serializeCursor(cursor: ScreenFeedCursor | null | undefined) {
  if (!cursor) return null;
  return { x: cursor.x, y: cursor.y, ts: cursor.ts, visible: cursor.visible };
}

function serializeFrame(frame: ScreenFrame) {
  return {
    dataUrl: frame.dataUrl,
    capturedAt: frame.capturedAt.toISOString(),
    receivedAt: frame.capturedAt.toISOString(),
    clientCapturedAt: frame.clientCapturedAt?.toISOString() ?? null,
    username: frame.username,
    clicks: frame.clicks,
    cursor: serializeCursor(frame.cursor),
    viewport: frame.viewport ?? null,
    capture: frame.capture ?? null,
  };
}

function serializeControlSession(session: RemoteControlSession) {
  return {
    id: session.id,
    companyId: session.companyId,
    targetUserId: session.targetUserId,
    targetUsername: session.targetUsername,
    targetTabId: session.targetTabId,
    targetRoute: session.targetRoute,
    controllerUserId: session.controllerUserId,
    controllerUsername: session.controllerUsername,
    controllerRole: session.controllerRole,
    scope: session.scope,
    status: session.status,
    startedAt: new Date(session.startedAt).toISOString(),
    expiresAt: new Date(session.expiresAt).toISOString(),
    capabilities: session.capabilities,
  };
}

export function registerScreenFeedRoutes(app: Express) {
  app.get("/api/screen-feed/admin/runtime", requireAuth, (req, res) => {
    if (!requireDeveloper(req, res)) return;
    res.setHeader("Cache-Control", "no-store");
    res.json(getRemoteSupportRuntimeSnapshot());
  });

  app.patch("/api/screen-feed/admin/runtime", requireAuth, (req, res) => {
    if (!requireDeveloper(req, res)) return;
    const patch = req.body?.flags ?? req.body ?? {};
    const snapshot = updateRemoteSupportFlags(patch, runtimeActor(req));
    if (!snapshot.flags.screenFeedEnabled) {
      watcherPollStore.clear();
      screenFeedCursorStore.clear();
    }
    if (!snapshot.flags.screenFeedEnabled || !snapshot.flags.fastScreenFeed) {
      screenFeedLiveHub.disconnectAll();
    }
    if (!snapshot.flags.remoteControl) stopAllRemoteControlSessions("runtime-disabled");
    res.setHeader("Cache-Control", "no-store");
    res.json(snapshot);
  });

  app.post("/api/screen-feed/admin/runtime/emergency-stop", requireAuth, (req, res) => {
    if (!requireDeveloper(req, res)) return;
    watcherPollStore.clear();
    screenFeedCursorStore.clear();
    screenFeedLiveHub.disconnectAll();
    stopAllRemoteControlSessions("global-emergency-stop");
    const snapshot = emergencyDisableRemoteSupport(runtimeActor(req));
    logger.warn(`[RemoteSupport] emergency stop activated by ${runtimeActor(req)}`);
    res.setHeader("Cache-Control", "no-store");
    res.json(snapshot);
  });

  app.post("/api/screen-feed/admin/runtime/restore-defaults", requireAuth, (req, res) => {
    if (!requireDeveloper(req, res)) return;
    stopAllRemoteControlSessions("runtime-defaults-restored");
    const snapshot = restoreRemoteSupportBootDefaults(runtimeActor(req));
    res.setHeader("Cache-Control", "no-store");
    res.json(snapshot);
  });

  app.post("/api/screen-feed/admin/runtime/reset-metrics", requireAuth, (req, res) => {
    if (!requireDeveloper(req, res)) return;
    res.setHeader("Cache-Control", "no-store");
    res.json(resetRemoteSupportMetrics());
  });

  app.get("/api/screen-feed/live/status", requireLogin, (req, res) => {
    if (!isRemoteSupportEnabled("screenFeedEnabled") || !isRemoteSupportEnabled("fastScreenFeed")) {
      return res.status(409).json({ live: false });
    }
    const userId = String(getSessionUserId(req));
    openEventStream(res);
    recordRemoteSupportMetric("liveStatusConnected");
    const sendStatus = () => {
      writeEvent(res, "status", { watched: isUserBeingWatched(userId), fast: true });
    };
    const unsubscribeStatus = screenFeedLiveHub.subscribeStatus(userId, sendStatus);
    let unsubscribeDisconnect = () => {};
    let closed = false;
    const refreshId = setInterval(sendStatus, LIVE_STATUS_REFRESH_MS);
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(refreshId);
      unsubscribeStatus();
      unsubscribeDisconnect();
      if (!res.writableEnded) res.end();
    };
    unsubscribeDisconnect = screenFeedLiveHub.subscribeDisconnect(cleanup);
    req.once("close", cleanup);
    res.once("close", cleanup);
    sendStatus();
  });

  app.get("/api/screen-feed/live/:userId", requireAuth, viewPermission, (req, res) => {
    if (!requireSupportController(req, res)) return;
    if (!isRemoteSupportEnabled("screenFeedEnabled") || !isRemoteSupportEnabled("fastScreenFeed")) {
      return res.status(409).json({ live: false });
    }

    const watchedUserId = req.params.userId;
    const controllerUserId = String(getSessionUserId(req));
    const controllerUsername = getSessionUsername(req) || controllerUserId;
    const controllerRole = getSessionRole(req) || "";
    const controllerCompanyId = getSessionCompanyId(req);
    openEventStream(res);
    recordRemoteSupportMetric("liveViewerConnected");
    watcherPollStore.set(watchedUserId, Date.now());

    let controlSessionId: string | null = null;
    let controlStarting = false;
    const tryStartControlSession = async () => {
      if (controlSessionId || controlStarting || !isRemoteSupportEnabled("remoteControl")) return;
      controlStarting = true;
      try {
        const session = startRemoteControlSession({
          targetUserId: watchedUserId,
          controllerUserId,
          controllerUsername,
          controllerRole,
          controllerCompanyId,
        });
        try {
          await writeRemoteSupportAudit({
            event: "session_started",
            session,
            actorUserId: controllerUserId,
            actorUsername: controllerUsername,
            details: { capability: "view", status: "requested", route: session.targetRoute },
          });
        } catch {
          stopRemoteControlSession(session.id, "audit-unavailable");
          writeEvent(res, "control-error", {
            code: "REMOTE_SUPPORT_AUDIT_UNAVAILABLE",
            message: "Remote support auditing is unavailable. Control was not enabled.",
          });
          return;
        }
        controlSessionId = session.id;
        writeEvent(res, "control-session", serializeControlSession(session));
      } catch (error) {
        if (
          error instanceof RemoteControlSessionError &&
          ["TARGET_TAB_UNAVAILABLE", "TARGET_ALREADY_CONTROLLED", "REMOTE_CONTROL_DISABLED"].includes(error.code)
        ) {
          return;
        }
        logger.warn(`[RemoteSupport] unable to start control session for user ${watchedUserId}: ${String(error)}`);
      } finally {
        controlStarting = false;
      }
    };

    const unsubscribeFrames = screenFeedLiveHub.subscribeFrames(watchedUserId, (frame) => {
      writeEvent(res, "frame", serializeFrame(frame));
    });
    const unsubscribeCursors = screenFeedLiveHub.subscribeCursors(watchedUserId, (cursor) => {
      writeEvent(res, "cursor", serializeCursor(cursor));
    });
    let unsubscribeDisconnect = () => {};
    let closed = false;

    void tryStartControlSession();
    const heartbeatId = setInterval(() => {
      watcherPollStore.set(watchedUserId, Date.now());
      if (controlSessionId) {
        const active = heartbeatRemoteControlController(controlSessionId, controllerUserId);
        if (!active) controlSessionId = null;
      }
      void tryStartControlSession();
      writeHeartbeat(res);
    }, LIVE_HEARTBEAT_MS);

    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeatId);
      unsubscribeFrames();
      unsubscribeCursors();
      unsubscribeDisconnect();
      if (!screenFeedLiveHub.hasViewer(watchedUserId)) {
        watcherPollStore.delete(watchedUserId);
        screenFeedLiveHub.notifyStatus(watchedUserId);
        if (controlSessionId) {
          const stopped = stopRemoteControlSession(controlSessionId, "controller-stopped");
          if (stopped) {
            void writeRemoteSupportAudit({
              event: "session_stopped",
              session: stopped,
              actorUserId: controllerUserId,
              actorUsername: controllerUsername,
              details: { capability: "view", stopReason: "controller-stopped", route: stopped.targetRoute },
            }).catch(() => undefined);
          }
          controlSessionId = null;
        }
      }
      if (!res.writableEnded) res.end();
    };

    unsubscribeDisconnect = screenFeedLiveHub.subscribeDisconnect(cleanup);
    req.once("close", cleanup);
    res.once("close", cleanup);
    writeEvent(res, "ready", { userId: watchedUserId });
    const currentFrame = screenFeedStore.get(watchedUserId);
    if (currentFrame) writeEvent(res, "frame", serializeFrame(currentFrame));
    const currentCursor = screenFeedCursorStore.get(watchedUserId);
    if (currentCursor) writeEvent(res, "cursor", serializeCursor(currentCursor));
  });

  app.get("/api/screen-feed/being-watched", requireLogin, (req, res) => {
    recordRemoteSupportMetric("watcherStatusPoll");
    if (!isRemoteSupportEnabled("screenFeedEnabled")) {
      return res.json({ watched: false, fast: false });
    }
    const userId = String(getSessionUserId(req));
    const lastPoll = watcherPollStore.get(userId) ?? 0;
    const ageMs = Date.now() - lastPoll;
    const watched = isUserBeingWatched(userId);
    if (isDev) {
      logger.info(
        `[ScreenFeed] being-watched userId=${userId} watched=${watched} lastPollAgeMs=${lastPoll > 0 ? ageMs : "never"}`
      );
    }
    res.json({
      watched,
      fast: isRemoteSupportEnabled("fastScreenFeed"),
      ...(isDev ? { userId, lastWatcherPollAgeMs: lastPoll > 0 ? ageMs : null } : {}),
    });
  });

  app.get("/api/screen-feed/trace/:event", requireLogin, (req, res) => {
    if (!isDev) return res.status(204).end();
    const userId = String(getSessionUserId(req));
    const event = req.params.event;
    const extra = req.query.d ? String(req.query.d) : "";
    logger.info(`[ScreenFeed][TRACE] userId=${userId} event=${event}${extra ? " d=" + extra : ""}`);
    res.status(204).end();
  });

  app.post("/api/screen-feed/pointer", requireLogin, (req, res) => {
    if (!isRemoteSupportEnabled("screenFeedEnabled")) return res.status(204).end();
    const userId = String(getSessionUserId(req));
    if (!isUserBeingWatched(userId)) return res.status(204).end();
    const cursor = sanitizeScreenFeedCursor(req.body?.cursor ?? req.body);
    // Pointer telemetry is visual-only. A stale/skewed sample must never create
    // a 400 retry loop or interfere with the employee's ERP session.
    if (!cursor) return res.status(204).end();
    screenFeedCursorStore.set(userId, cursor);
    const existingFrame = screenFeedStore.get(userId);
    if (existingFrame) existingFrame.cursor = cursor;
    if (isRemoteSupportEnabled("fastScreenFeed")) screenFeedLiveHub.publishCursor(userId, cursor);
    res.status(204).end();
  });

  app.post("/api/screen-feed", requireLogin, (req, res) => {
    if (!isRemoteSupportEnabled("screenFeedEnabled")) return res.status(200).end();
    const userId = String(getSessionUserId(req));
    if (isDev) {
      logger.info(
        `[ScreenFeed] POST /api/screen-feed received from userId=${userId} body_keys=${Object.keys(req.body ?? {}).join(",")}`
      );
    }
    const { dataUrl, clicks, cursor, viewport, capture, clientCapturedAt } = req.body ?? {};
    if (!isValidScreenFeedDataUrl(dataUrl)) {
      recordRemoteSupportMetric("frameRejected");
      if (isDev) {
        logger.warn(
          `[ScreenFeed] POST rejected: missing or invalid dataUrl (type=${typeof dataUrl} starts=${typeof dataUrl === "string" ? dataUrl.slice(0, 30) : "N/A"})`
        );
      }
      return res.status(400).end();
    }
    if (dataUrl.length > MAX_FRAME_SIZE) {
      recordRemoteSupportMetric("frameRejected");
      if (isDev) logger.warn(`[ScreenFeed] POST rejected: frame too large (${dataUrl.length} bytes)`);
      return res.status(204).end();
    }
    const receivedAt = new Date();
    const username = getSessionUsername(req) || userId;
    const safeClicks = sanitizeScreenFeedClicks(clicks, receivedAt.getTime());
    const safeCursor =
      sanitizeScreenFeedCursor(cursor, receivedAt.getTime()) ?? screenFeedCursorStore.get(userId) ?? null;
    const frame: ScreenFrame = {
      dataUrl,
      capturedAt: receivedAt,
      clientCapturedAt: sanitizeScreenFeedClientCapturedAt(clientCapturedAt, receivedAt.getTime()),
      userId,
      username,
      clicks: safeClicks,
      cursor: safeCursor,
      viewport: sanitizeScreenFeedViewport(viewport),
      capture: sanitizeScreenFeedCapture(capture),
    };
    screenFeedStore.set(userId, frame);
    if (safeCursor) screenFeedCursorStore.set(userId, safeCursor);
    recordRemoteSupportMetric("frameAccepted", Buffer.byteLength(dataUrl, "utf8"));
    if (isRemoteSupportEnabled("fastScreenFeed")) {
      const pushed = screenFeedLiveHub.publishFrame(userId, frame);
      if (pushed > 0) recordRemoteSupportMetric("framePushed", pushed);
    }
    if (isDev) {
      logger.info(
        `[ScreenFeed] POST frame stored userId=${userId} frameLen=${dataUrl.length} clicks=${safeClicks.length}`
      );
    }
    res.status(204).end();
  });

  app.get("/api/screen-feed/:userId", requireAuth, viewPermission, (req, res) => {
    if (!requireSupportController(req, res)) return;
    recordRemoteSupportMetric("viewerPoll");
    res.setHeader("Cache-Control", "no-store");
    if (!isRemoteSupportEnabled("screenFeedEnabled")) return res.json(null);
    const watchedUserId = req.params.userId;
    watcherPollStore.set(watchedUserId, Date.now());
    screenFeedLiveHub.notifyStatus(watchedUserId);
    const frame = screenFeedStore.get(watchedUserId);
    const hasFrame = !!frame;
    if (isDev) {
      const frameAgeMs = frame ? Date.now() - frame.capturedAt.getTime() : null;
      logger.info(
        `[ScreenFeed] GET /:userId watchedUserId=${watchedUserId} hasFrame=${hasFrame} frameAgeMs=${frameAgeMs}`
      );
    }
    if (!frame) return res.json(null);
    const latestCursor = screenFeedCursorStore.get(watchedUserId);
    if (latestCursor) frame.cursor = latestCursor;
    res.json(serializeFrame(frame));
  });
}
