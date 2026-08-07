import type { Express } from "express";
import { requireAuth, requireLogin } from "../auth";
import { requireActionAccess } from "../lib/permissionMiddleware";
import { isRemoteSupportEnabled } from "../services/remoteSupportRuntime";

const viewPermission = requireActionAccess("remote_support_view");

function liveTransportEnabled(): boolean {
  return isRemoteSupportEnabled("screenFeedEnabled") && isRemoteSupportEnabled("fastScreenFeed");
}

function stopEventSourceReconnect(res: Parameters<Express["get"]>[1] extends never ? never : any): void {
  res.setHeader("Cache-Control", "no-store");
  res.status(204).end();
}

/**
 * EventSource reconnects aggressively after HTTP errors. When the fast/live
 * transport is intentionally disabled, answer with 204 before the legacy live
 * routes run. Per the EventSource protocol, 204 tells the browser not to
 * reconnect; the existing polling fallback can then take over quietly.
 */
export function registerScreenFeedConnectionGate(app: Express): void {
  app.get("/api/screen-feed/live/status", requireLogin, (_req, res, next) => {
    if (liveTransportEnabled()) return next();
    stopEventSourceReconnect(res);
  });

  app.get("/api/screen-feed/live/:userId", requireAuth, viewPermission, (_req, res, next) => {
    if (liveTransportEnabled()) return next();
    stopEventSourceReconnect(res);
  });
}
