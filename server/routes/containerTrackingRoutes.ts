/**
 * containerTrackingRoutes.ts — API endpoints for ParcelsApp container tracking.
 *
 * All routes require Admin, Developer, or Owner role.
 * The PARCELSAPP_API_KEY is never exposed to the client.
 */

import type { Express, Request, Response } from "express";
import { db } from "../db";
import { requireAuth, requireRole } from "../auth";
import {
  containers,
  containerTrackingEvents,
} from "../../shared/schema";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import { trackOneContainerById } from "../services/containerTrackingService";
import { testConnection } from "../lib/parcelsAppClient";

const ALLOWED_ROLES = ["Admin", "Developer", "Owner"] as const;
type AllowedRole = (typeof ALLOWED_ROLES)[number];

function requireAllowedRole(req: Request, res: Response): boolean {
  const role = (req.user as any)?.role;
  if (!ALLOWED_ROLES.includes(role)) {
    res.status(403).json({ message: "Insufficient permissions" });
    return false;
  }
  return true;
}

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const updateTrackingSettingsSchema = z.object({
  trackingEnabled: z.boolean().optional(),
  trackingAutoUpdate: z.boolean().optional(),
  trackingCarrierHint: z.string().max(100).nullable().optional(),
  trackingProvider: z.string().max(50).nullable().optional(),
});

// ─── Register routes ──────────────────────────────────────────────────────────

export function registerContainerTrackingRoutes(app: Express) {

  // GET /api/container-tracking/status — API key config status (no key value exposed)
  app.get("/api/container-tracking/status", requireAuth, (req: Request, res: Response) => {
    if (!requireAllowedRole(req, res)) return;
    const hasKey = !!process.env.PARCELSAPP_API_KEY;
    res.json({ configured: hasKey, provider: "parcelsapp" });
  });

  // POST /api/container-tracking/test-connection — verify API key works
  app.post("/api/container-tracking/test-connection", requireAuth, async (req: Request, res: Response) => {
    if (!requireAllowedRole(req, res)) return;
    try {
      const result = await testConnection();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // POST /api/container-tracking/:id/track-now — manually trigger tracking
  app.post("/api/container-tracking/:id/track-now", requireAuth, async (req: Request, res: Response) => {
    if (!requireAllowedRole(req, res)) return;

    const containerId = parseInt(req.params.id, 10);
    if (isNaN(containerId)) {
      res.status(400).json({ message: "Invalid container ID" });
      return;
    }

    try {
      const result = await trackOneContainerById(containerId);
      res.json(result);
    } catch (err: any) {
      const msg: string = err?.message ?? "Tracking failed";
      const status = msg.includes("not found") ? 404 : msg.includes("disabled") ? 409 : 500;
      res.status(status).json({ message: msg });
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

  // PATCH /api/container-tracking/:id/settings — update tracking settings on a container
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
