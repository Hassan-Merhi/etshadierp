import "./lib/observabilityBootstrap";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { runWithTraceContext } from "./lib/traceContext";

let wss: WebSocketServer | null = null;

export function setupWS(server: Server): void {
  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws) => {
    const connectionId = `websocket-${randomUUID()}`;

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

        ws.on("close", () => clearInterval(pingInterval));
      },
    );
  });
}

export function broadcast(message: object): void {
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
      wss?.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data);
        }
      });
    },
  );
}
