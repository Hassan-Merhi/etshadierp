import { db } from "../../db";
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
import { logAndConfirmEta, logEtaResolution, resolveEtaFromShipment } from "./eta";
import { backfillEtaFromEvents, saveParcelsAppEvents, saveTrackingCheck } from "./persistence";
import { checkParcelsAppQuota, getParcelsAppUsageStats } from "./quotas";
import { ep } from "./validation-progress";

export async function trackViaParcelsAppApi(
  containerId: number,
  containerNumber: string,
  detectedCarrier: string | null,
  fallbackReason: string | null,
  now: Date,
  currentEta: string | null,
  destinationCountry?: string | null
): Promise<{
  success: boolean;
  lastStatus: string | null;
  lastLocation: string | null;
  lastDescription: string | null;
  lastCheckedAt: Date;
  error: string | null;
}> {
  if (!process.env.PARCELSAPP_API_KEY) {
    ep(containerId, "ParcelsApp API", "skip", "API key not configured");
    logger.info(
      `[ContainerTracking] ${containerNumber}: ParcelsApp API skipped — PARCELSAPP_API_KEY is not configured`
    );
    const noProviderError =
      "No tracking provider configured (scraper unavailable, 17track not set, ParcelsApp key missing)";
    await db
      .update(containers)
      .set({
        trackingLastCheckedAt: now,
        trackingError: noProviderError,
        trackingDetectedCarrier: detectedCarrier,
        trackingFallbackUsed: !!fallbackReason,
        trackingFallbackReason: fallbackReason,
      } as any)
      .where(eq(containers.id, containerId));
    return {
      success: false,
      lastStatus: null,
      lastLocation: null,
      lastDescription: null,
      lastCheckedAt: now,
      error: noProviderError,
    };
  }

  const quotaOk = await checkParcelsAppQuota();
  if (!quotaOk) {
    const { used, limit } = await getParcelsAppUsageStats();
    const quotaError = `ParcelsApp API quota used (${used}/${limit}) — all providers exhausted`;
    ep(containerId, "ParcelsApp API", "skip", "quota exhausted this month");
    logger.warn(`[ContainerTracking] ${containerNumber}: ${quotaError}`);
    await saveTrackingCheck(containerId, "skipped", "skipped_quota", quotaError, null);
    await db
      .update(containers)
      .set({
        trackingLastCheckedAt: now,
        trackingError: quotaError,
        trackingDetectedCarrier: detectedCarrier,
        trackingFallbackUsed: !!fallbackReason,
        trackingFallbackReason: fallbackReason ?? "parcelsapp_quota_exhausted",
      } as any)
      .where(eq(containers.id, containerId));
    return {
      success: false,
      lastStatus: null,
      lastLocation: null,
      lastDescription: null,
      lastCheckedAt: now,
      error: quotaError,
    };
  }

  const hintCarrier = detectedCarrier && detectedCarrier !== "OTHER" ? detectedCarrier : undefined;
  const effectiveDestination = destinationCountry || "United States";
  ep(containerId, "ParcelsApp API", "running");
  logger.info(
    `[ContainerTracking] ${containerNumber}: ParcelsApp API attempt carrier=${hintCarrier ?? "auto"} destination="${effectiveDestination}"`
  );

  const result = await trackContainer(containerNumber, effectiveDestination, hintCarrier);

  await saveTrackingCheck(
    containerId,
    "parcelsapp",
    result.success ? "success" : result.timedOut ? "timeout" : "error",
    result.error ?? null,
    result.rawResponse
  );

  if (!result.success || !result.shipment) {
    ep(containerId, "ParcelsApp API", "fail", result.error ?? "no data");
    await db
      .update(containers)
      .set({
        trackingLastCheckedAt: now,
        trackingError: result.error ?? "Tracking failed",
        trackingProvider: "parcelsapp",
        trackingDetectedCarrier: detectedCarrier,
        trackingFallbackUsed: !!fallbackReason,
        trackingFallbackReason: fallbackReason,
      } as any)
      .where(eq(containers.id, containerId));
    // backfillEtaFromEvents removed — event dates must not be used as ETA
    return {
      success: false,
      lastStatus: null,
      lastLocation: null,
      lastDescription: null,
      lastCheckedAt: now,
      error: result.error ?? "Tracking failed",
    };
  }

  const shipment = result.shipment;
  const lastStatus = deriveLastStatus(shipment);
  const lastLocation = deriveLastLocation(shipment);
  const lastEventDate = deriveLastEventDate(shipment);
  const lastDescription = shipment.states?.[0]?.description ?? null;
  const { eta: finalEta, source: etaSrc } = resolveEtaFromShipment(shipment, currentEta);
  logEtaResolution(containerNumber, "parcelsapp", currentEta, finalEta, finalEta, etaSrc);

  logger.info(`[ContainerTracking] ${containerNumber} raw attributes`, { attributes: shipment.attributes ?? {} });
  await saveParcelsAppEvents(containerId, shipment);

  const updateSet: Record<string, unknown> = {
    trackingLastCheckedAt: now,
    trackingLastStatus: lastStatus,
    trackingLastEventDate: lastEventDate,
    trackingLastDescription: lastDescription,
    trackingError: null,
    trackingChangedAt: now,
    trackingProvider: "parcelsapp",
    trackingDetectedCarrier: detectedCarrier,
    trackingFallbackUsed: !!fallbackReason,
    trackingFallbackReason: fallbackReason,
  };
  if (finalEta) {
    updateSet.eta = finalEta;
    updateSet.etaSource = etaSrc;
  }
  await db
    .update(containers)
    .set(updateSet as any)
    .where(eq(containers.id, containerId));
  await logAndConfirmEta(
    containerId,
    containerNumber,
    currentEta,
    finalEta,
    etaSrc,
    "parcelsapp",
    !finalEta ? "no explicit ETA field found — existing ETA preserved" : undefined
  );

  ep(containerId, "ParcelsApp API", "success", lastStatus ?? "got data");
  logger.info(`[ContainerTracking] ${containerNumber} → parcelsapp: status=${lastStatus ?? "?"}`);
  return { success: true, lastStatus, lastLocation, lastDescription, lastCheckedAt: now, error: null };
}

// ─── ETA backfill from stored events ──────────────────────────────────────────

/**
 * If the container's ETA column is still NULL after a tracking run (e.g. all
 * providers failed or returned no explicit ETA), fill it in from the most
 * recent event we have stored in containerTrackingEvents.  Never overwrites
 * an ETA that already exists.
 */
