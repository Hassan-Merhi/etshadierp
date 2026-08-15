import "./lib/observabilityBootstrap";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage, Server } from "http";
import type { RequestHandler } from "express";
import { runWithTraceContext } from "./lib/traceContext";
import { logger } from "./lib/logger";
import { shouldDeliverBroadcast } from "./lib/broadcastScope";

let wss: WebSocketServer | null = null;
let resolveSession: SessionResolver | null = null;

/** Runs the app's session middleware over a bare upgrade request. */
type SessionResolver = (request: IncomingMessage) => Promise<number | null>;

/**
 * Every client used to receive every broadcast, so a sale in one company woke
 * clients in every other company — and each of them refetched everything on
 * screen. Sockets now carry the company their session is in, and a write only
 * reaches the company it happened in.
 */
const socketCompanies = new WeakMap<WebSocket, number | null>();

/**
 * express-session decorates the response to write its cookie. An upgrade has no
 * response to write to, so it gets a stand-in that accepts those calls and does
 * nothing — the session is only being read here.
 */
function upgradeResponseStub() {
  const noop = () => undefined;
  return {
    setHeader: noop,
    getHeader: () => undefined,
    removeHeader: noop,
    writeHead: noop,
    write: () => true,
    end: noop,
    on: noop,
    once: noop,
    emit: () => false,
    headersSent: false,
    finished: false,
  };
}

function sessionCompanyResolver(sessionMiddleware: RequestHandler): SessionResolver {
  return (request) =>
    new Promise((resolve) => {
      let settled = false;
      const finish = (companyId: number | null) => {
        if (settled) return;
        settled = true;
        resolve(companyId);
      };

      try {
        // The upgrade request carries the session cookie, and express-session
        // reads it from the same store the HTTP routes use.
        sessionMiddleware(request as unknown, upgradeResponseStub() as unknown, () => {
          const session = (request as unknown).session;
          const companyId = Number(session?.currentCompanyId);
          finish(Number.isInteger(companyId) && companyId > 0 ? companyId : null);
        });
      } catch (error) {
        logger.warn("[WS] Could not resolve the session for a socket; it will receive every broadcast.", { error });
        finish(null);
      }

      // A store that never answers must not leave the socket in limbo. Falling
      // back to null keeps it subscribed to everything, which is the safe side.
      setTimeout(() => finish(null), 5_000).unref?.();
    });
}

export function setupWS(server: Server, sessionMiddleware?: RequestHandler): void {
  wss = new WebSocketServer({ server, path: "/ws" });
  resolveSession = sessionMiddleware ? sessionCompanyResolver(sessionMiddleware) : null;

  wss.on("connection", (ws, request) => {
    const connectionId = `websocket-${randomUUID()}`;

    // Until the session resolves, the socket has no company. An unscoped socket
    // receives every broadcast: missing an invalidation is worse than an extra
    // one, so the fallback stays on the safe side.
    socketCompanies.set(ws, null);
    if (resolveSession) {
      void resolveSession(request)
        .then((companyId) => socketCompanies.set(ws, companyId))
        .catch(() => socketCompanies.set(ws, null));
    }

    runWithTraceContext(
      {
        requestId: connectionId,
        routeTemplate: "/ws",
        buildVersion: process.env.BUILD_VERSION || process.env.RENDER_GIT_COMMIT?.substring(0, 8) || "dev",
        source: "websocket",
      },
      () => {
        ws.on("error", () => {});

        ws.on("message", () => {
          runWithTraceContext(
            {
              requestId: `websocket-message-${randomUUID()}`,
              routeTemplate: "/ws:message",
              buildVersion: process.env.BUILD_VERSION || process.env.RENDER_GIT_COMMIT?.substring(0, 8) || "dev",
              source: "websocket",
            },
            () => undefined,
          );
        });

        const pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
          }
        }, 30_000);

        ws.on("close", () => {
          clearInterval(pingInterval);
          socketCompanies.delete(ws);
        });
      },
    );
  });
}

export interface BroadcastOptions {
  /**
   * The company the change belongs to. Sockets in other companies are skipped;
   * sockets whose company is not known yet still receive it. Omit to reach
   * every client — correct for server-wide messages, wasteful for writes.
   */
  companyId?: number | null;
}

function shouldDeliver(client: WebSocket, companyId: number | null | undefined): boolean {
  return shouldDeliverBroadcast(socketCompanies.get(client), companyId);
}

export function broadcast(message: object, options: BroadcastOptions = {}): void {
  if (!wss) return;
  const data = JSON.stringify(message);
  runWithTraceContext(
    {
      requestId: `websocket-broadcast-${randomUUID()}`,
      routeTemplate: "/ws:broadcast",
      buildVersion: process.env.BUILD_VERSION || process.env.RENDER_GIT_COMMIT?.substring(0, 8) || "dev",
      source: "websocket",
    },
    () => {
      let delivered = 0;
      let skipped = 0;
      wss?.clients.forEach((client) => {
        if (client.readyState !== WebSocket.OPEN) return;
        if (!shouldDeliver(client, options.companyId)) {
          skipped += 1;
          return;
        }
        client.send(data);
        delivered += 1;
      });
      recordBroadcast(delivered, skipped);
    },
  );
}

// ── Broadcast volume ────────────────────────────────────────────────────────
// Every write broadcasts, and every broadcast makes each receiving client
// refetch what it has on screen. Counting delivered vs skipped messages is what
// tells us whether narrowing this further is worth doing — without it any
// further tuning here is guesswork.
const BROADCAST_REPORT_INTERVAL_MS = 5 * 60_000;
let broadcastCount = 0;
let deliveredCount = 0;
let skippedCount = 0;
let lastReportAt = Date.now();

function recordBroadcast(delivered: number, skipped: number): void {
  broadcastCount += 1;
  deliveredCount += delivered;
  skippedCount += skipped;

  const elapsed = Date.now() - lastReportAt;
  if (elapsed < BROADCAST_REPORT_INTERVAL_MS) return;

  logger.info("[WS] Broadcast volume", {
    broadcasts: broadcastCount,
    messagesDelivered: deliveredCount,
    messagesSkippedByCompanyScope: skippedCount,
    windowMinutes: Math.round(elapsed / 60_000),
  });

  broadcastCount = 0;
  deliveredCount = 0;
  skippedCount = 0;
  lastReportAt = Date.now();
}
