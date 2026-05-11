/**
 * containerTrackingRoutes.ts — API endpoints for container tracking.
 *
 * Provider order: Maersk direct API → ParcelsApp fallback.
 * API keys are NEVER exposed to the client.
 * All routes require Admin, Developer, or Owner role.
 */

import type { Express, Request, Response } from "express";
import { db } from "../db";
import { requireAuth, requireRole } from "../auth";
import {
  containers,
  containerTrackingEvents,
} from "../../shared/schema";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import {
  trackOneContainerById,
  trackAllEnabledNow,
  setBulkTrackingEnabled,
} from "../services/containerTrackingService";
import { testConnection } from "../lib/parcelsAppClient";
import { isConfigured as isMaerskConfigured } from "../lib/trackingProviders/maerskProvider";

const ALLOWED_ROLES = ["Admin", "Developer", "Owner"] as const;

function requireAllowedRole(req: Request, res: Response): boolean {
  const role = (req.user as any)?.role;
  if (!ALLOWED_ROLES.includes(role as any)) {
    res.status(403).json({ message: "Insufficient permissions" });
    return false;
  }
  return true;
}

const updateTrackingSettingsSchema = z.object({
  trackingEnabled: z.boolean().optional(),
  trackingAutoUpdate: z.boolean().optional(),
  trackingCarrierHint: z.string().max(100).nullable().optional(),
  trackingProvider: z.string().max(50).nullable().optional(),
});

export function registerContainerTrackingRoutes(app: Express) {

  // GET /api/container-tracking/status — provider config (no keys exposed)
  app.get("/api/container-tracking/status", requireAuth, (req: Request, res: Response) => {
    if (!requireAllowedRole(req, res)) return;

    const maerskConfigured = isMaerskConfigured();
    const parcelsAppConfigured = !!process.env.PARCELSAPP_API_KEY;

    const directProviders: string[] = [];
    if (maerskConfigured) directProviders.push("maersk");

    res.json({
      configured: maerskConfigured || parcelsAppConfigured,
      maerskConfigured,
      parcelsAppConfigured,
      directProviders,
      fallbackProvider: "parcelsapp",
    });
  });

  // POST /api/container-tracking/test-connection — verify ParcelsApp key works
  app.post("/api/container-tracking/test-connection", requireAuth, async (req: Request, res: Response) => {
    if (!requireAllowedRole(req, res)) return;
    try {
      const result = await testConnection();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // POST /api/container-tracking/:id/track-now — immediately track a single container
  app.post("/api/container-tracking/:id/track-now", requireAuth, async (req: Request, res: Response) => {
    if (!requireAllowedRole(req, res)) return;

    const containerId = parseInt(req.params.id, 10);
    if (isNaN(containerId)) {
      res.status(400).json({ message: "Invalid container ID" });
      return;
    }

    const maerskOk = isMaerskConfigured();
    const parcelsOk = !!process.env.PARCELSAPP_API_KEY;
    if (!maerskOk && !parcelsOk) {
      res.status(400).json({
        message: "No tracking provider is configured. Add MAERSK_CONSUMER_KEY / MAERSK_CONSUMER_SECRET (free) or PARCELSAPP_API_KEY to your environment variables.",
      });
      return;
    }

    try {
      const [row] = await db
        .select({ id: containers.id, containerNumber: containers.containerNumber, status: containers.status })
        .from(containers)
        .where(eq(containers.id, containerId))
        .limit(1);

      if (!row) {
        res.status(404).json({ message: "Container not found" });
        return;
      }

      const INACTIVE = new Set(["Offloaded", "Closed", "Completed"]);
      if (INACTIVE.has(row.status)) {
        res.status(409).json({
          message: `Container status is "${row.status}" — tracking updates are disabled for closed containers`,
        });
        return;
      }

      res.status(202).json({
        started: true,
        containerNumber: row.containerNumber,
        message: "Tracking started. Results will appear in about a minute — refresh the page to see updates.",
      });

      trackOneContainerById(containerId).catch((err: any) =>
        console.error(`[TrackNow] ${row.containerNumber}:`, err?.message),
      );
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).json({ message: err?.message ?? "Tracking failed" });
      }
    }
  });

  // GET /api/container-tracking/:id/events — list recent tracking events
  app.get("/api/container-tracking/:id/events", requireAuth, async (req: Request, res: Response) => {
    if (!requireAllowedRole(req, res)) return;

    const containerId = parseInt(req.params.id, 10);
    if (isNaN(containerId)) {
      res.status(400).json({ message: "Invalid container ID" });
      return;
    }

    try {
      const events = await db
        .select()
        .from(containerTrackingEvents)
        .where(eq(containerTrackingEvents.containerId, containerId))
        .orderBy(desc(containerTrackingEvents.eventTime))
        .limit(100);
      res.json(events);
    } catch (err: any) {
      res.status(500).json({ message: err?.message ?? "Failed to load events" });
    }
  });

  // POST /api/container-tracking/bulk-settings
  app.post("/api/container-tracking/bulk-settings", requireAuth, async (req: Request, res: Response) => {
    if (!requireAllowedRole(req, res)) return;

    const { trackingEnabled } = req.body;
    if (typeof trackingEnabled !== "boolean") {
      res.status(400).json({ message: "trackingEnabled must be a boolean" });
      return;
    }

    try {
      const updated = await setBulkTrackingEnabled(trackingEnabled);
      res.json({ updated, trackingEnabled });
    } catch (err: any) {
      res.status(500).json({ message: err?.message ?? "Bulk update failed" });
    }
  });

  // POST /api/container-tracking/bulk-track-now
  app.post("/api/container-tracking/bulk-track-now", requireAuth, async (req: Request, res: Response) => {
    if (!requireAllowedRole(req, res)) return;

    const maerskOk = isMaerskConfigured();
    const parcelsOk = !!process.env.PARCELSAPP_API_KEY;
    if (!maerskOk && !parcelsOk) {
      res.status(400).json({ message: "No tracking provider configured (MAERSK or PARCELSAPP)" });
      return;
    }

    try {
      const queued = await trackAllEnabledNow();
      res.json({
        queued,
        message: queued === 0
          ? "No containers have auto-tracking enabled."
          : `Tracking started for ${queued} container${queued !== 1 ? "s" : ""}. Results will appear shortly.`,
      });
    } catch (err: any) {
      res.status(500).json({ message: err?.message ?? "Bulk track failed" });
    }
  });

  // PATCH /api/container-tracking/:id/settings
  app.patch("/api/container-tracking/:id/settings", requireAuth, async (req: Request, res: Response) => {
    if (!requireAllowedRole(req, res)) return;

    const containerId = parseInt(req.params.id, 10);
    if (isNaN(containerId)) {
      res.status(400).json({ message: "Invalid container ID" });
      return;
    }

    const parsed = updateTrackingSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid body", errors: parsed.error.flatten() });
      return;
    }

    const updates: Record<string, unknown> = {};
    const data = parsed.data;
    if (data.trackingEnabled !== undefined) updates.trackingEnabled = data.trackingEnabled;
    if (data.trackingAutoUpdate !== undefined) updates.trackingAutoUpdate = data.trackingAutoUpdate;
    if ("trackingCarrierHint" in data) updates.trackingCarrierHint = data.trackingCarrierHint ?? null;
    if ("trackingProvider" in data) updates.trackingProvider = data.trackingProvider ?? null;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ message: "No valid fields to update" });
      return;
    }

    try {
      const [updated] = await db
        .update(containers)
        .set(updates)
        .where(eq(containers.id, containerId))
        .returning({
          id: containers.id,
          trackingEnabled: containers.trackingEnabled,
          trackingAutoUpdate: containers.trackingAutoUpdate,
          trackingCarrierHint: containers.trackingCarrierHint,
          trackingProvider: containers.trackingProvider,
        });

      if (!updated) {
        res.status(404).json({ message: "Container not found" });
        return;
      }
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err?.message ?? "Update failed" });
    }
  });
}
