import { db } from "../../db";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { containers, containerTrackingEvents, containerTrackingChecks } from "../../../shared/schema";
import { and, eq, inArray, gte, sql, desc, isNotNull, isNull } from "drizzle-orm";
import {
  trackContainer,
  normaliseEvents,
  deriveLastStatus,
  deriveLastLocation,
  deriveLastEventDate,
  deriveEstimatedDeliveryDate,
  type ParcelsAppShipment,
} from "../../lib/parcelsAppClient";
import type { CarrierTrackResult, TrackingEvent } from "../../lib/trackingProviders/types";

export async function backfillEtaFromEvents(containerId: number): Promise<void> {
  const [row] = await db
    .select({ eta: containers.eta })
    .from(containers)
    .where(and(eq(containers.id, containerId), isNull(containers.eta)));

  if (!row) return; // eta is already set — don't touch it

  const [latest] = await db
    .select({ eventTime: containerTrackingEvents.eventTime })
    .from(containerTrackingEvents)
    .where(and(eq(containerTrackingEvents.containerId, containerId), isNotNull(containerTrackingEvents.eventTime)))
    .orderBy(desc(containerTrackingEvents.eventTime))
    .limit(1);

  if (latest?.eventTime) {
    const eta = new Date(latest.eventTime).toISOString().slice(0, 10);
    await db
      .update(containers)
      .set({ eta, etaSource: "event" } as any)
      .where(eq(containers.id, containerId));
    logger.info(`[ContainerTracking] Backfilled ETA from stored events → ${eta} (container ${containerId})`);
  }
}

// ─── Event persistence ─────────────────────────────────────────────────────────

export async function saveDirectEvents(containerId: number, result: CarrierTrackResult): Promise<void> {
  if (result.events.length === 0) return;

  for (const ev of result.events) {
    try {
      await db
        .insert(containerTrackingEvents)
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
      logger.warn("[ContainerTracking] Direct event save warn:", { error: getErrorMessage(err) });
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
        .insert(containerTrackingEvents)
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
      logger.warn("[ContainerTracking] ParcelsApp event save warn:", { error: getErrorMessage(err) });
    }
  }
}

export async function saveTrackingCheck(
  containerId: number,
  provider: string,
  status: string,
  errorMessage: string | null,
  rawResponse: unknown
): Promise<void> {
  try {
    await db.insert(containerTrackingChecks).values({
      containerId,
      provider,
      status,
      checkedAt: new Date(),
      errorMessage,
      rawResponseJson: rawResponse as any,
    });
  } catch (err: unknown) {
    logger.warn("[ContainerTracking] Check record save warn:", { error: getErrorMessage(err) });
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
