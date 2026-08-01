import { db } from "../../db";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import {
  factoryContainers,
  factoryContainerTrackingEvents,
  factoryContainerTrackingChecks,
} from "../../../shared/schema";
import { eq } from "drizzle-orm";
import { normaliseEvents, deriveEstimatedDeliveryDate, type ParcelsAppShipment } from "../../lib/parcelsAppClient";
import type { CarrierTrackResult } from "../../lib/trackingProviders/types";

export async function saveTrackingCheck(
  containerId: number,
  provider: string,
  status: string,
  errorMessage: string | null,
  rawResponse: unknown
): Promise<void> {
  try {
    await db.insert(factoryContainerTrackingChecks).values({
      containerId,
      provider,
      status,
      checkedAt: new Date(),
      errorMessage,
      rawResponseJson: rawResponse as any,
    });
  } catch (err: unknown) {
    logger.warn("[FactoryTracking] Check record save warn", { error: getErrorMessage(err) });
  }
}

export async function saveDirectEvents(containerId: number, result: CarrierTrackResult): Promise<void> {
  if (result.events.length === 0) return;
  for (const ev of result.events) {
    try {
      await db
        .insert(factoryContainerTrackingEvents)
        .values({
          containerId,
          provider: result.provider,
          eventTime: ev.date,
          eventStatus: ev.status,
          eventLocation: ev.location,
          eventDescription: ev.description,
          rawEventJson: { provider: result.provider, ...ev } as any,
        })
        .onConflictDoNothing();
    } catch (err: unknown) {
      logger.warn("[FactoryTracking] Direct event save warn", { error: getErrorMessage(err) });
    }
  }
}

export async function saveParcelsAppEvents(containerId: number, shipment: ParcelsAppShipment): Promise<void> {
  const events = normaliseEvents(shipment);
  if (events.length === 0) return;
  for (const ev of events) {
    let eventTime: Date | null = null;
    if (ev.date) {
      const d = new Date(ev.date);
      if (!isNaN(d.getTime())) eventTime = d;
    }
    try {
      await db
        .insert(factoryContainerTrackingEvents)
        .values({
          containerId,
          provider: "parcelsapp",
          eventTime,
          eventStatus: ev.status,
          eventLocation: ev.location,
          eventDescription: ev.description,
          rawEventJson: ev as any,
        })
        .onConflictDoNothing();
    } catch (err: unknown) {
      logger.warn("[FactoryTracking] ParcelsApp event save warn", { error: getErrorMessage(err) });
    }
  }
}

export async function setSchedulerMeta(
  containerId: number,
  skipReason: string | null,
  nextCheckAt: Date | null | undefined
): Promise<void> {
  try {
    const patch: Record<string, unknown> = { trackingLastSkipReason: skipReason };
    if (nextCheckAt !== undefined) patch.trackingNextCheckAt = nextCheckAt;
    await db
      .update(factoryContainers)
      .set(patch as any)
      .where(eq(factoryContainers.id, containerId));
  } catch (err: unknown) {
    logger.warn("[FactoryTracking] setSchedulerMeta warn", { error: getErrorMessage(err) });
  }
}

// ── ETA helpers ───────────────────────────────────────────────────────────────

export function resolveEtaFromProvider(
  providerEta: string | null,
  _events: any[] | undefined,
  currentEta: string | null
): { eta: string | null; source: "api" | "manual" | null } {
  if (providerEta) return { eta: providerEta, source: "api" };
  if (currentEta) return { eta: currentEta, source: "manual" };
  return { eta: null, source: null };
}

export function resolveEtaFromShipment(
  shipment: ParcelsAppShipment,
  currentEta: string | null
): { eta: string | null; source: "api" | "manual" | null } {
  const derived = deriveEstimatedDeliveryDate(shipment);
  if (derived) return { eta: derived, source: "api" };
  if (currentEta) return { eta: currentEta, source: "manual" };
  return { eta: null, source: null };
}

// ── Core tracking implementation ──────────────────────────────────────────────
