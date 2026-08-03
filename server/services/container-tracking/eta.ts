import { db } from "../../db";
import { logger } from "../../lib/logger";
import { containers } from "../../../shared/schema";
import { eq } from "drizzle-orm";
import { deriveEstimatedDeliveryDate, type ParcelsAppShipment } from "../../lib/parcelsAppClient";
import type { TrackingEvent } from "../../lib/trackingProviders/types";

export function resolveEtaFromProvider(
  providerEta: string | null,
  _events: TrackingEvent[] | undefined,
  currentEta: string | null
): { eta: string | null; source: "api" | "manual" | null } {
  if (providerEta) return { eta: providerEta, source: "api" };
  if (currentEta) return { eta: currentEta, source: "manual" };
  return { eta: null, source: null };
}

/** Log ETA resolution so field updates are visible in server output.
 *  Does NOT log raw API payloads or secrets. */
export function logEtaResolution(
  containerNumber: string,
  provider: string,
  currentEta: string | null,
  providerEta: string | null,
  finalEta: string | null,
  source: string | null
): void {
  const changed = finalEta !== null && finalEta !== currentEta;
  logger.info(
    `[ETA] ${containerNumber} provider=${provider}` +
      ` old=${currentEta ?? "—"} providerEta=${providerEta ?? "—"}` +
      ` final=${finalEta ?? "—"} src=${source ?? "—"}` +
      (changed ? " [UPDATED]" : "")
  );
}

/**
 * Resolve the best ETA from a ParcelsApp/scraper shipment result.
 * Uses deriveEstimatedDeliveryDate (which already falls back to state dates),
 * then falls back to the existing DB value. NEVER blanks an existing ETA.
 */
export function resolveEtaFromShipment(
  shipment: ParcelsAppShipment,
  currentEta: string | null
): { eta: string | null; source: "api" | "manual" | null } {
  const derived = deriveEstimatedDeliveryDate(shipment);
  if (derived) return { eta: derived, source: "api" };
  if (currentEta) return { eta: currentEta, source: "manual" };
  return { eta: null, source: null };
}

/**
 * Log the ETA decision and confirm the persisted value from the DB.
 * Called after every db.update() that may change the ETA column.
 */
export async function logAndConfirmEta(
  containerId: number,
  containerNumber: string,
  oldEta: string | null,
  newEta: string | null,
  source: string | null,
  provider: string,
  noUpdateReason?: string
): Promise<void> {
  if (noUpdateReason) {
    logger.info(
      `[ContainerTracking ETA] container=${containerNumber} NO UPDATE — ${noUpdateReason} ` +
        `(existing=${oldEta ?? "null"}) provider=${provider}`
    );
    return;
  }
  logger.info(
    `[ContainerTracking ETA] container=${containerNumber} oldEta=${oldEta ?? "null"} ` +
      `→ newEta=${newEta ?? "null"} source=${source ?? "none"} provider=${provider}`
  );
  const [saved] = await db
    .select({ eta: containers.eta })
    .from(containers)
    .where(eq(containers.id, containerId))
    .limit(1);
  logger.info(`[ContainerTracking ETA] DB-confirmed: container=${containerNumber} eta=${saved?.eta ?? "null"}`);
}

// ─── Internal tracking implementation ─────────────────────────────────────────
