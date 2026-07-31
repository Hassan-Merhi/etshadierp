import { randomUUID } from "crypto";
import type { Notification, PoolClient } from "pg";
import { pool } from "../../db";
import { logger } from "../../lib/logger";

const INVALIDATION_CHANNEL = "erp_read_microcache_invalidate";
const RECONNECT_DELAY_MS = 5_000;

export interface ReadMicrocacheCoordinator {
  isReady: () => boolean;
  publishInvalidation: () => Promise<void>;
}

export function startReadMicrocacheCoordinator(onExternalInvalidation: () => void): ReadMicrocacheCoordinator {
  const instanceId = process.env.RENDER_INSTANCE_ID || `${process.pid}-${randomUUID()}`;
  let ready = false;
  let activeClient: PoolClient | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;

  const scheduleReconnect = () => {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, RECONNECT_DELAY_MS);
    reconnectTimer.unref();
  };

  const detachClient = (client: PoolClient) => {
    client.removeAllListeners("notification");
    client.removeAllListeners("error");
    client.removeAllListeners("end");
    client.release(true);
  };

  const handleDisconnect = (client: PoolClient, error?: unknown) => {
    if (activeClient !== client) return;
    activeClient = null;
    ready = false;
    onExternalInvalidation();
    detachClient(client);
    logger.warn("Read microcache invalidation listener disconnected", {
      module: "read-microcache",
      action: "coordinator-disconnect",
      error,
    });
    scheduleReconnect();
  };

  const connect = async () => {
    let client: PoolClient | null = null;
    try {
      client = await pool.connect();
      activeClient = client;

      client.on("notification", (notification: Notification) => {
        if (notification.channel !== INVALIDATION_CHANNEL || notification.payload === instanceId) return;
        onExternalInvalidation();
      });
      client.on("error", (error) => handleDisconnect(client as PoolClient, error));
      client.on("end", () => handleDisconnect(client as PoolClient));

      await client.query(`LISTEN ${INVALIDATION_CHANNEL}`);
      ready = true;
      logger.info("Read microcache invalidation listener ready", {
        module: "read-microcache",
        action: "coordinator-ready",
      });
    } catch (error) {
      ready = false;
      if (client) {
        if (activeClient === client) activeClient = null;
        detachClient(client);
      }
      logger.warn("Read microcache invalidation listener failed to start", {
        module: "read-microcache",
        action: "coordinator-connect-failed",
        error,
      });
      scheduleReconnect();
    }
  };

  void connect();

  return {
    isReady: () => ready,
    publishInvalidation: async () => {
      try {
        await pool.query("SELECT pg_notify($1, $2)", [INVALIDATION_CHANNEL, instanceId]);
      } catch (error) {
        logger.warn("Read microcache invalidation publish failed", {
          module: "read-microcache",
          action: "coordinator-publish-failed",
          error,
        });
      }
    },
  };
}
