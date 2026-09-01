import { db } from "../../db";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { containers } from "../../../shared/schema";
import { eq } from "drizzle-orm";
import { refreshContainerEta as refreshJsonCargoEta } from "../jsonCargoTrackingService";
import { normalizeJsonCargoCarrier } from "../../lib/trackingProviders/jsonCargoProvider";
import { resolveProvider } from "../../lib/trackingProviders/providerResolver";
import { logAndConfirmEta, logEtaResolution, resolveEtaFromProvider } from "./eta";
import { trackViaParcelsApp } from "./parcels-app";
import { saveDirectEvents, saveTrackingCheck } from "./persistence";
import { deriveFallbackReason } from "./quotas";
import { isValidContainerNumber } from "./validation-progress";

export async function trackOneContainer(
  containerId: number,
  containerNumber: string,
  destinationCountry?: string
): Promise<{
  success: boolean;
  lastStatus: string | null;
  lastLocation: string | null;
  lastDescription: string | null;
  lastCheckedAt: Date;
  error: string | null;
}> {
  const now = new Date();

  // Fetch the current ETA from the DB so we can preserve it if the provider
  // returns nothing — we never want to blank an existing ETA.
  const [currentRow] = await db
    .select({
      eta: containers.eta,
      trackingLastCheckedAt: containers.trackingLastCheckedAt,
      trackingCarrierHint: containers.trackingCarrierHint,
    })
    .from(containers)
    .where(eq(containers.id, containerId))
    .limit(1);
  let currentEta: string | null = currentRow?.eta ?? null;
  const lastCheckedAt: Date | null = currentRow?.trackingLastCheckedAt ?? null;

  // ── JSONCargo — tried FIRST for Maersk/Hapag-Lloyd/MSC/CMA CGM ──────────────
  // ETA-only, on its own weekly cadence (JSONCARGO_REFRESH_HOURS). Never blocks or
  // replaces the status/location provider chain below — it only opportunistically
  // keeps `eta` fresher for these four carriers using the carrier stored on the
  // container record (not a container-number-prefix guess).
  if (normalizeJsonCargoCarrier(currentRow?.trackingCarrierHint)) {
    try {
      const jc = await refreshJsonCargoEta(containerId);
      if (jc.newEta) currentEta = jc.newEta;
      if (jc.status !== "skipped_recent") {
        logger.info(`[ContainerTracking] ${containerNumber}: jsoncargo → ${jc.status} (${jc.message})`);
      }
    } catch (err: unknown) {
      logger.warn(`[ContainerTracking] ${containerNumber}: jsoncargo pre-check error —`, {
        error: getErrorMessage(err) ?? err,
      });
    }
  }

  // Guard: reject invalid container numbers before any API call
  if (!isValidContainerNumber(containerNumber)) {
    const errMsg = `Invalid container number format: "${containerNumber}" (must be 4 letters + 7 digits)`;
    logger.info(`[ContainerTracking] ${containerNumber}: skipped — ${errMsg}`);

    await saveTrackingCheck(containerId, "skipped", "invalid_container_number", errMsg, null);
    await db
      .update(containers)
      .set({ trackingLastCheckedAt: now, trackingError: errMsg })
      .where(eq(containers.id, containerId));

    return {
      success: false,
      lastStatus: null,
      lastLocation: null,
      lastDescription: null,
      lastCheckedAt: now,
      error: errMsg,
    };
  }

  const { detectedCarrier, tryDirect } = resolveProvider(containerNumber);

  // ── Step 1: attempt each direct provider in order ──────────────────────────
  let lastDirectFallbackReason: string | null = null;

  for (const attempt of tryDirect) {
    const result = await attempt();

    if (result.success) {
      await saveDirectEvents(containerId, result);
      await saveTrackingCheck(containerId, result.provider, "success", null, result.raw);

      const { eta: finalEta, source: etaSrc } = resolveEtaFromProvider(result.eta ?? null, result.events, currentEta);
      logEtaResolution(containerNumber, result.provider, currentEta, result.eta ?? null, finalEta, etaSrc);

      const updateSet: Record<string, unknown> = {
        trackingLastCheckedAt: now,
        trackingLastStatus: result.latestStatus,
        trackingLastEventDate: result.latestEventDate,
        trackingLastDescription: result.latestDescription,
        trackingError: null,
        trackingChangedAt: now,
        trackingProvider: result.provider,
        trackingDetectedCarrier: detectedCarrier,
        trackingFallbackUsed: false,
        trackingFallbackReason: null,
      };
      if (finalEta) {
        updateSet.eta = finalEta;
        updateSet.etaSource = etaSrc;
      }

      await db.update(containers).set(updateSet).where(eq(containers.id, containerId));
      await logAndConfirmEta(
        containerId,
        containerNumber,
        currentEta,
        finalEta,
        etaSrc,
        result.provider,
        !finalEta ? "provider returned no ETA and no events with dates" : undefined
      );
      logger.info(`[ContainerTracking] ${containerNumber} → ${result.provider}: status=${result.latestStatus ?? "?"}`);

      return {
        success: true,
        lastStatus: result.latestStatus,
        lastLocation: result.latestLocation,
        lastDescription: result.latestDescription,
        lastCheckedAt: now,
        error: null,
      };
    }

    const reason = deriveFallbackReason(result);
    const checkStatus = result.blocked ? "blocked" : result.noData ? "no_data" : "error";

    await saveTrackingCheck(containerId, result.provider, checkStatus, result.error ?? reason, null);

    logger.info(`[ContainerTracking] ${containerNumber}: ${result.provider} failed (${reason}) — trying next provider`);

    lastDirectFallbackReason = reason;
  }

  // ── Step 2: all direct providers exhausted — use ParcelsApp fallback ───────
  return await trackViaParcelsApp(
    containerId,
    containerNumber,
    detectedCarrier,
    lastDirectFallbackReason,
    now,
    currentEta,
    lastCheckedAt,
    destinationCountry
  );
}

// ─── Universal fallback — scraper → 17track → ParcelsApp API ──────────────────
