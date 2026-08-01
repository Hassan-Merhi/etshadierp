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
import { scrapeTracking, isScraperAvailable } from "../../lib/parcelsAppScraper";
import { httpScrapeTracking, isHttpScraperAvailable } from "../../lib/httpTrackingScraper";
import { scrapeMaerskDirect, isMaerskDirectScraperAvailable } from "../../lib/maerskDirectScraper";
import * as maerskPublicProvider from "../../lib/trackingProviders/maerskPublicProvider";
import * as seventeenTrack from "../../lib/trackingProviders/seventeenTrackProvider";
import * as cmaPublicProvider from "../../lib/trackingProviders/cmaPublicProvider";
import * as cmaCgmApiProvider from "../../lib/trackingProviders/cmaCgmApiProvider";
import { logAndConfirmEta, logEtaResolution, resolveEtaFromProvider, resolveEtaFromShipment } from "./eta";
import { trackViaParcelsAppApi } from "./parcels-app-api";
import { saveDirectEvents, saveParcelsAppEvents, saveTrackingCheck } from "./persistence";
import { check17trackQuota } from "./quotas";
import { trackOneContainer } from "./track-one";
import { CMA_PREFIXES, ep, initTrackingProgress } from "./validation-progress";

export async function trackViaParcelsApp(
  containerId: number,
  containerNumber: string,
  detectedCarrier: string | null,
  fallbackReason: string | null,
  now: Date,
  currentEta: string | null,
  lastCheckedAt: Date | null,
  destinationCountry?: string
): Promise<{
  success: boolean;
  lastStatus: string | null;
  lastLocation: string | null;
  lastDescription: string | null;
  lastCheckedAt: Date;
  error: string | null;
}> {
  // Reset progress for this tracking run
  initTrackingProgress(containerId);

  // ── Attempt 0: Lightweight HTTP scraper (no browser, no quota) ──────────────
  if (isHttpScraperAvailable()) {
    ep(containerId, "HTTP scraper", "running");
    logger.info(`[ContainerTracking] ${containerNumber}: trying HTTP scraper (no browser)...`);
    const httpResult = await httpScrapeTracking(containerNumber);

    await saveTrackingCheck(
      containerId,
      "http_scraper",
      httpResult.success ? "success" : "error",
      httpResult.error ?? null,
      httpResult.rawResponse ?? null
    );

    if (httpResult.success && httpResult.shipment) {
      const shipment = httpResult.shipment;
      const lastStatus = deriveLastStatus(shipment);
      const lastLocation = deriveLastLocation(shipment);
      const lastEventDate = deriveLastEventDate(shipment);
      const lastDescription = shipment.states?.[0]?.description ?? null;
      const { eta: finalEta, source: etaSrc } = resolveEtaFromShipment(shipment, currentEta);
      logEtaResolution(containerNumber, "http_scraper", currentEta, finalEta, finalEta, etaSrc);

      await saveParcelsAppEvents(containerId, shipment);

      const updateSet: Record<string, unknown> = {
        trackingLastCheckedAt: now,
        trackingLastStatus: lastStatus,
        trackingLastEventDate: lastEventDate,
        trackingLastDescription: lastDescription,
        trackingError: null,
        trackingChangedAt: now,
        trackingProvider: "http_scraper",
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
        "http_scraper",
        !finalEta ? "no explicit ETA field found — existing ETA preserved" : undefined
      );

      ep(containerId, "HTTP scraper", "success", lastStatus ?? "got data");
      logger.info(`[ContainerTracking] ${containerNumber} → http_scraper: status=${lastStatus ?? "?"}`);
      if (finalEta || currentEta) {
        // ETA is known (new from provider or already in DB) — full success, stop here
        return { success: true, lastStatus, lastLocation, lastDescription, lastCheckedAt: now, error: null };
      }
      // Status/events saved but no ETA anywhere — fall through to next provider to try to get one
      logger.info(
        `[ContainerTracking] ${containerNumber}: http_scraper got status/events but no ETA — continuing to fallback provider for ETA`
      );
    } else {
      ep(containerId, "HTTP scraper", "skip", httpResult.error ?? "no data");
      logger.info(
        `[ContainerTracking] ${containerNumber}: HTTP scraper got no data (${httpResult.error}) — trying next provider...`
      );
    }
  }

  // ── Attempt 1: Maersk direct Puppeteer scraper (intercepts Maersk's own API) ──
  // Only for Maersk-family containers (MAERSK, Hamburg Süd, etc.)
  // CAJU is a CMA-owned prefix but is operated by Maersk (MAEU) on some services.
  // Maersk.com tracks CAJU containers when operator=MAEU, so include it here so
  // maersk_direct and maersk_public are attempted before falling back to CMA/ParcelsApp.
  const MAERSK_PREFIXES = /^(MAEU|MSKU|MRKU|MRSU|HASU|HJSC|HJCU|SUDU|SAFM|CAJU)/i;

  // 6-hour ETA cache: if we already have a good ETA and checked < 6 h ago, skip both
  // Maersk providers entirely. The scheduler already enforces intervals, but this
  // in-process guard prevents redundant calls when trackOneContainer is invoked directly.
  const SIX_HOURS_MS = 6 * 60 * 60 * 1_000;
  if (
    MAERSK_PREFIXES.test(containerNumber) &&
    currentEta &&
    lastCheckedAt &&
    now.getTime() - lastCheckedAt.getTime() < SIX_HOURS_MS
  ) {
    logger.info(
      `[ContainerTracking] ${containerNumber}: Maersk ETA cached (${currentEta}) checked ${Math.round((now.getTime() - lastCheckedAt.getTime()) / 60000)}min ago — skipping providers`
    );
    return {
      success: true,
      lastStatus: null,
      lastLocation: null,
      lastDescription: null,
      lastCheckedAt: lastCheckedAt,
      error: null,
    };
  }

  if (isMaerskDirectScraperAvailable() && MAERSK_PREFIXES.test(containerNumber)) {
    ep(containerId, "Maersk Puppeteer", "running");
    logger.info(`[ContainerTracking] ${containerNumber}: trying Maersk scraper...`);
    const mdResult = await scrapeMaerskDirect(containerNumber);

    await saveTrackingCheck(
      containerId,
      "maersk_scraper",
      mdResult.success ? "success" : mdResult.blocked ? "blocked" : "error",
      mdResult.error ?? null,
      mdResult.raw ?? null
    );

    if (mdResult.success && (mdResult.latestStatus || mdResult.eta)) {
      const updateSet: Record<string, unknown> = {
        trackingLastCheckedAt: now,
        trackingLastStatus: mdResult.latestStatus,
        trackingLastEventDate: mdResult.latestEventDate,
        trackingLastDescription: mdResult.latestDescription,
        trackingError: null,
        trackingChangedAt: now,
        trackingProvider: "maersk_scraper",
        trackingDetectedCarrier: detectedCarrier,
        trackingFallbackUsed: !!fallbackReason,
        trackingFallbackReason: fallbackReason,
      };

      // Hoist finalEta so the early-return guard below can see it regardless of events branch
      let finalEta: string | null = null;
      let etaSrc: string | null;

      // Save events
      if (mdResult.events?.length) {
        ({ eta: finalEta, source: etaSrc } = resolveEtaFromProvider(mdResult.eta ?? null, mdResult.events, currentEta));
        logEtaResolution(containerNumber, "maersk_scraper", currentEta, mdResult.eta ?? null, finalEta, etaSrc);
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
          finalEta ?? null,
          etaSrc ?? null,
          "maersk_scraper",
          !finalEta ? "no ETA from maersk_scraper" : undefined
        );

        // Persist tracking events
        const fakeShipment: ParcelsAppShipment = {
          trackingId: containerNumber,
          done: true,
          attributes: {
            ...(mdResult.latestStatus ? { status: mdResult.latestStatus } : {}),
            ...(mdResult.latestLocation ? { location: mdResult.latestLocation } : {}),
            ...(finalEta ? { estimatedArrival: finalEta } : {}),
          },
          states: mdResult.events.map((e) => ({
            date: e.date?.toISOString().slice(0, 10) ?? "",
            status: e.status ?? "",
            location: e.location ?? "",
            description: e.description ?? "",
          })),
        };
        await saveParcelsAppEvents(containerId, fakeShipment);
      } else {
        if (mdResult.eta && !currentEta) {
          finalEta = mdResult.eta;
          updateSet.eta = mdResult.eta;
          updateSet.etaSource = "api";
        }
        await db
          .update(containers)
          .set(updateSet as any)
          .where(eq(containers.id, containerId));
      }

      ep(containerId, "Maersk Puppeteer", "success", mdResult.latestStatus ?? "got data");
      logger.info(`[ContainerTracking] ${containerNumber} → maersk_scraper: status=${mdResult.latestStatus ?? "?"}`);
      if (finalEta || currentEta) {
        // ETA is known (new from provider or already in DB) — full success, stop here
        return {
          success: true,
          lastStatus: mdResult.latestStatus,
          lastLocation: mdResult.latestLocation,
          lastDescription: mdResult.latestDescription,
          lastCheckedAt: now,
          error: null,
        };
      }
      // Status/events saved but no ETA anywhere — continue to Maersk public / ParcelsApp for ETA
      logger.info(
        `[ContainerTracking] ${containerNumber}: maersk_scraper got status/events but no ETA — continuing to Maersk public for ETA`
      );
    } else {
      ep(containerId, "Maersk Puppeteer", "fail", mdResult.error ?? "no data");
      logger.info(
        `[ContainerTracking] ${containerNumber}: maersk_scraper got no data (${mdResult.error}) — trying Maersk public HTTP...`
      );
    }
  } else if (MAERSK_PREFIXES.test(containerNumber) && !isMaerskDirectScraperAvailable()) {
    ep(containerId, "Maersk Puppeteer", "skip", "Chrome not available in this environment");
  }

  // ── Attempt 2: Maersk public HTTP (no browser, no API key, always available) ──
  // Runs when maersk_direct is unavailable (no Puppeteer) or returned no data.
  // Hits Maersk's undocumented public JSON API after loading a session cookie.
  // Blocked by Akamai roughly half the time — falls through gracefully.
  if (MAERSK_PREFIXES.test(containerNumber)) {
    ep(containerId, "Maersk public HTTP", "running");
    logger.info(`[ContainerTracking] ${containerNumber}: trying Maersk public HTTP provider...`);
    const mpResult = await maerskPublicProvider.track(containerNumber);

    const mpStatus = mpResult.success
      ? "success"
      : mpResult.blocked
        ? "blocked"
        : mpResult.error === "rate_limited"
          ? "skipped"
          : "error";

    await saveTrackingCheck(containerId, "maersk_public", mpStatus, mpResult.error ?? null, mpResult.raw ?? null);

    if (mpResult.success && (mpResult.latestStatus || mpResult.events.length > 0)) {
      await saveDirectEvents(containerId, mpResult);
      const { eta: finalEta, source: etaSrc } = resolveEtaFromProvider(
        mpResult.eta ?? null,
        mpResult.events,
        currentEta
      );
      logEtaResolution(containerNumber, "maersk_public", currentEta, mpResult.eta ?? null, finalEta, etaSrc);

      const updateSet: Record<string, unknown> = {
        trackingLastCheckedAt: now,
        trackingLastStatus: mpResult.latestStatus,
        trackingLastEventDate: mpResult.latestEventDate,
        trackingLastDescription: mpResult.latestDescription,
        trackingError: null,
        trackingChangedAt: now,
        trackingProvider: "maersk_public",
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
        finalEta ?? null,
        etaSrc ?? null,
        "maersk_public",
        !finalEta ? "no ETA from maersk_public" : undefined
      );

      ep(containerId, "Maersk public HTTP", "success", mpResult.latestStatus ?? "got data");
      logger.info(`[ContainerTracking] ${containerNumber} → maersk_public: status=${mpResult.latestStatus ?? "?"}`);
      if (finalEta || currentEta) {
        // ETA is known (new from provider or already in DB) — full success, stop here
        return {
          success: true,
          lastStatus: mpResult.latestStatus,
          lastLocation: mpResult.latestLocation,
          lastDescription: mpResult.latestDescription,
          lastCheckedAt: now,
          error: null,
        };
      }
      // Status/events saved but no ETA anywhere — continue to ParcelsApp to try to get one
      logger.info(
        `[ContainerTracking] ${containerNumber}: maersk_public got status/events but no ETA — continuing to ParcelsApp for ETA`
      );
    } else if (mpResult.error === "rate_limited") {
      ep(containerId, "Maersk public HTTP", "skip", "rate-limited — 6 h cooldown");
    } else {
      ep(containerId, "Maersk public HTTP", "fail", mpResult.error ?? "no data");
      logger.info(`[ContainerTracking] ${containerNumber}: maersk_public got no data (${mpResult.error})`);
    }
  }

  // Maersk guard: NEVER fall through to ParcelsApp/generic scrapers for Maersk containers.
  // ParcelsApp has stale/unreliable data for Maersk and risks clobbering correct ETAs.
  // Both dedicated Maersk providers have been tried above — stop here and preserve state.
  if (MAERSK_PREFIXES.test(containerNumber)) {
    logger.info(
      `[ContainerTracking] ${containerNumber}: Maersk chain exhausted — preserving ETA=${currentEta ?? "none"}`
    );
    await db
      .update(containers)
      .set({ trackingLastCheckedAt: now } as any)
      .where(eq(containers.id, containerId));
    return {
      success: false,
      lastStatus: null,
      lastLocation: null,
      lastDescription: null,
      lastCheckedAt: now,
      error: "maersk_providers_unavailable",
    };
  }

  // ── CMA CGM API — leasing / unknown-carrier containers ───────────────────────
  // Leasing containers (TCNU, TIIU, UETU, ECNU…) may be shipped by CMA CGM.
  // The official DCSA API looks up by equipmentReference (container number) and
  // returns events regardless of the container prefix — if the box is on a CMA
  // vessel we get full tracking; a 404/no_data is returned quickly for non-CMA
  // cargo so the overhead is negligible.
  // CMA-prefix containers have their own dedicated chain below — skip them here.
  if (!CMA_PREFIXES.test(containerNumber) && cmaCgmApiProvider.isConfigured()) {
    ep(containerId, "CMA CGM API", "running", "checking if container is on a CMA ship");
    logger.info(`[ContainerTracking] ${containerNumber}: trying CMA CGM API (leasing/unknown carrier)...`);
    const cmaFallResult = await cmaCgmApiProvider.track(containerNumber);
    await saveTrackingCheck(
      containerId,
      "cma_cgm_api",
      cmaFallResult.success ? "success" : cmaFallResult.noData ? "no_data" : "error",
      cmaFallResult.error ?? null,
      cmaFallResult.raw ?? null
    );
    if (cmaFallResult.success && (cmaFallResult.latestStatus || cmaFallResult.events.length > 0)) {
      await saveDirectEvents(containerId, cmaFallResult);
      const { eta: finalEta, source: etaSrc } = resolveEtaFromProvider(
        cmaFallResult.eta ?? null,
        cmaFallResult.events,
        currentEta
      );
      logEtaResolution(containerNumber, "cma_cgm_api", currentEta, cmaFallResult.eta ?? null, finalEta, etaSrc);
      const updateSet: Record<string, unknown> = {
        trackingLastCheckedAt: now,
        trackingLastStatus: cmaFallResult.latestStatus,
        trackingLastEventDate: cmaFallResult.latestEventDate,
        trackingLastDescription: cmaFallResult.latestDescription,
        trackingError: null,
        trackingChangedAt: now,
        trackingProvider: "cma_cgm_api",
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
        "cma_cgm_api",
        !finalEta ? "CMA API: no ETA returned" : undefined
      );
      ep(containerId, "CMA CGM API", "success", cmaFallResult.latestStatus ?? "got data");
      logger.info(
        `[ContainerTracking] ${containerNumber} → cma_cgm_api (leasing): status=${cmaFallResult.latestStatus ?? "?"}`
      );
      return {
        success: true,
        lastStatus: cmaFallResult.latestStatus,
        lastLocation: cmaFallResult.latestLocation,
        lastDescription: cmaFallResult.latestDescription,
        lastCheckedAt: now,
        error: null,
      };
    }
    ep(containerId, "CMA CGM API", cmaFallResult.noData ? "skip" : "fail", cmaFallResult.error ?? "not on CMA ship");
    logger.info(
      `[ContainerTracking] ${containerNumber}: CMA API — not on CMA ship (${cmaFallResult.error ?? "no data"}) — proceeding`
    );
  }

  // ── CMA provider chain ────────────────────────────────────────────────────────
  // Priority order:
  //   1. CMA CGM Official DCSA API (api key, most accurate ETA)
  //   2. CMA CGM public JSON endpoint (free, no key, often blocked by DataDome)
  //   3. 17track
  //   4. ParcelsApp API
  if (CMA_PREFIXES.test(containerNumber)) {
    logger.info(`[ContainerTracking] ${containerNumber}: CMA detected — trying CMA CGM official API...`);

    // ── Step 1: CMA CGM Official DCSA Track & Trace API ──────────────────────
    if (cmaCgmApiProvider.isConfigured()) {
      const apiResult = await cmaCgmApiProvider.track(containerNumber);
      await saveTrackingCheck(
        containerId,
        "cma_cgm_api",
        apiResult.success ? "success" : apiResult.noData ? "no_data" : "error",
        apiResult.error ?? null,
        apiResult.raw ?? null
      );

      if (apiResult.success && (apiResult.latestStatus || apiResult.events.length > 0)) {
        await saveDirectEvents(containerId, apiResult);
        const { eta: finalEta, source: etaSrc } = resolveEtaFromProvider(
          apiResult.eta ?? null,
          apiResult.events,
          currentEta
        );
        logEtaResolution(containerNumber, "cma_cgm_api", currentEta, apiResult.eta ?? null, finalEta, etaSrc);
        const updateSet: Record<string, unknown> = {
          trackingLastCheckedAt: now,
          trackingLastStatus: apiResult.latestStatus,
          trackingLastEventDate: apiResult.latestEventDate,
          trackingLastDescription: apiResult.latestDescription,
          trackingError: null,
          trackingChangedAt: now,
          trackingProvider: "cma_cgm_api",
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
          "cma_cgm_api",
          !finalEta ? "no ETA from CMA CGM official API" : undefined
        );
        logger.info(
          `[ContainerTracking] ${containerNumber} → cma_cgm_api: status=${apiResult.latestStatus ?? "?"} eta=${finalEta ?? "none"}`
        );
        return {
          success: true,
          lastStatus: apiResult.latestStatus,
          lastLocation: apiResult.latestLocation,
          lastDescription: apiResult.latestDescription,
          lastCheckedAt: now,
          error: null,
        };
      }

      logger.info(
        `[ContainerTracking] ${containerNumber}: CMA official API returned no data (${apiResult.error}) — trying public endpoint...`
      );
    }

    if (cmaPublicProvider.isEnabled()) {
      const cmaResult = await cmaPublicProvider.track(containerNumber);
      await saveTrackingCheck(
        containerId,
        "cma_public",
        cmaResult.success ? "success" : cmaResult.blocked ? "blocked" : "error",
        cmaResult.error ?? null,
        cmaResult.raw ?? null
      );

      if (cmaResult.success && (cmaResult.latestStatus || cmaResult.events.length > 0)) {
        await saveDirectEvents(containerId, cmaResult);
        const { eta: finalEta, source: etaSrc } = resolveEtaFromProvider(
          cmaResult.eta ?? null,
          cmaResult.events,
          currentEta
        );
        logEtaResolution(containerNumber, "cma_public", currentEta, cmaResult.eta ?? null, finalEta, etaSrc);
        const updateSet: Record<string, unknown> = {
          trackingLastCheckedAt: now,
          trackingLastStatus: cmaResult.latestStatus,
          trackingLastEventDate: cmaResult.latestEventDate,
          trackingLastDescription: cmaResult.latestDescription,
          trackingError: null,
          trackingChangedAt: now,
          trackingProvider: "cma_public",
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
          "cma_public",
          !finalEta ? "no ETA from CMA public endpoint" : undefined
        );
        logger.info(`[ContainerTracking] ${containerNumber} → cma_public: status=${cmaResult.latestStatus ?? "?"}`);
        return {
          success: true,
          lastStatus: cmaResult.latestStatus,
          lastLocation: cmaResult.latestLocation,
          lastDescription: cmaResult.latestDescription,
          lastCheckedAt: now,
          error: null,
        };
      }

      logger.info(
        `[ContainerTracking] ${containerNumber}: CMA public endpoint failed (${cmaResult.error}) — trying 17track...`
      );
    }

    // 17track handles CMA well — try it before burning ParcelsApp quota
    if (seventeenTrack.isConfigured()) {
      const quotaOk17 = await check17trackQuota();
      if (quotaOk17) {
        logger.info(`[ContainerTracking] ${containerNumber}: trying 17track for CMA (carrier=100755)...`);
        const result17 = await seventeenTrack.track(containerNumber, seventeenTrack.CARRIER_CODES.CMA);
        await saveTrackingCheck(
          containerId,
          "17track",
          result17.success ? "success" : result17.noData ? "no_data" : "error",
          result17.error ?? null,
          result17.raw
        );
        if (result17.success) {
          await saveDirectEvents(containerId, result17);
          const { eta: finalEta, source: etaSrc } = resolveEtaFromProvider(
            result17.eta ?? null,
            result17.events,
            currentEta
          );
          logEtaResolution(containerNumber, "17track", currentEta, result17.eta ?? null, finalEta, etaSrc);
          const updateSet: Record<string, unknown> = {
            trackingLastCheckedAt: now,
            trackingLastStatus: result17.latestStatus,
            trackingLastEventDate: result17.latestEventDate,
            trackingLastDescription: result17.latestDescription,
            trackingError: null,
            trackingChangedAt: now,
            trackingProvider: "17track",
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
            "17track",
            !finalEta ? "17track returned no ETA" : undefined
          );
          logger.info(`[ContainerTracking] ${containerNumber} → 17track (CMA): status=${result17.latestStatus ?? "?"}`);
          return {
            success: true,
            lastStatus: result17.latestStatus,
            lastLocation: result17.latestLocation,
            lastDescription: result17.latestDescription,
            lastCheckedAt: now,
            error: null,
          };
        }
        logger.info(
          `[ContainerTracking] ${containerNumber}: 17track failed for CMA (${result17.error}) — trying ParcelsApp scraper...`
        );
      }
    }

    // ParcelsApp website (scraped via Puppeteer) has no CMA CGM data — skip it.
    // Go straight to the ParcelsApp v3 API which may have broader carrier coverage.
    return await trackViaParcelsAppApi(
      containerId,
      containerNumber,
      null,
      fallbackReason,
      now,
      currentEta,
      destinationCountry
    );
  }

  // ── Attempt 2: Puppeteer stealth scraper (ParcelsApp, no API key, no quota cost) ──
  if (isScraperAvailable()) {
    ep(containerId, "Puppeteer scraper", "running");
    logger.info(`[ContainerTracking] ${containerNumber}: trying ParcelsApp web scraper...`);
    const scraped = await scrapeTracking(containerNumber);

    await saveTrackingCheck(
      containerId,
      "parcelsapp_scraper",
      scraped.success ? "success" : scraped.blocked ? "blocked" : "error",
      scraped.error ?? null,
      scraped.rawResponse ?? null
    );

    if (scraped.success && scraped.shipment) {
      const shipment = scraped.shipment;
      const lastStatus = deriveLastStatus(shipment);
      const lastLocation = deriveLastLocation(shipment);
      const lastEventDate = deriveLastEventDate(shipment);
      const lastDescription = shipment.states?.[0]?.description ?? null;
      const { eta: finalEta, source: etaSrc } = resolveEtaFromShipment(shipment, currentEta);

      await saveParcelsAppEvents(containerId, shipment);

      const updateSet: Record<string, unknown> = {
        trackingLastCheckedAt: now,
        trackingLastStatus: lastStatus,
        trackingLastEventDate: lastEventDate,
        trackingLastDescription: lastDescription,
        trackingError: null,
        trackingChangedAt: now,
        trackingProvider: "parcelsapp_scraper",
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
        "parcelsapp_scraper",
        !finalEta ? "no ETA derived from shipment states" : undefined
      );

      ep(containerId, "Puppeteer scraper", "success", lastStatus ?? "got data");
      logger.info(`[ContainerTracking] ${containerNumber} → parcelsapp_scraper: status=${lastStatus ?? "?"}`);
      return { success: true, lastStatus, lastLocation, lastDescription, lastCheckedAt: now, error: null };
    }

    ep(containerId, "Puppeteer scraper", scraped.blocked ? "blocked" : "fail", scraped.error ?? "no data");
    if (scraped.blocked) {
      logger.warn(`[ContainerTracking] ${containerNumber}: scraper blocked by reCaptcha — trying 17track...`);
    } else {
      logger.warn(`[ContainerTracking] ${containerNumber}: scraper failed (${scraped.error}) — trying 17track...`);
    }
  }

  // ── Attempt 2: 17track API ────────────────────────────────────────────────────
  if (seventeenTrack.isConfigured()) {
    const quotaOk17 = await check17trackQuota();
    if (!quotaOk17) {
      ep(containerId, "17track API", "skip", "quota exhausted this month");
      logger.warn(`[ContainerTracking] ${containerNumber}: 17track quota exhausted — skipping`);
    } else {
      ep(containerId, "17track API", "running");
      logger.info(`[ContainerTracking] ${containerNumber}: trying 17track...`);
      const result17 = await seventeenTrack.track(containerNumber);

      await saveTrackingCheck(
        containerId,
        "17track",
        result17.success ? "success" : result17.noData ? "no_data" : "error",
        result17.error ?? null,
        result17.raw
      );

      if (result17.success) {
        await saveDirectEvents(containerId, result17);

        const { eta: finalEta, source: etaSrc } = resolveEtaFromProvider(
          result17.eta ?? null,
          result17.events,
          currentEta
        );
        logEtaResolution(containerNumber, "17track", currentEta, result17.eta ?? null, finalEta, etaSrc);

        const updateSet: Record<string, unknown> = {
          trackingLastCheckedAt: now,
          trackingLastStatus: result17.latestStatus,
          trackingLastEventDate: result17.latestEventDate,
          trackingLastDescription: result17.latestDescription,
          trackingError: null,
          trackingChangedAt: now,
          trackingProvider: "17track",
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
          "17track",
          !finalEta ? "17track returned no ETA and no events with dates" : undefined
        );

        ep(containerId, "17track API", "success", result17.latestStatus ?? "got data");
        logger.info(`[ContainerTracking] ${containerNumber} → 17track: status=${result17.latestStatus ?? "?"}`);
        return {
          success: true,
          lastStatus: result17.latestStatus,
          lastLocation: result17.latestLocation,
          lastDescription: result17.latestDescription,
          lastCheckedAt: now,
          error: null,
        };
      }

      ep(containerId, "17track API", "fail", result17.error ?? "no data");
      logger.warn(
        `[ContainerTracking] ${containerNumber}: 17track failed (${result17.error}) — trying ParcelsApp API...`
      );
    }
  }

  // ── Final: ParcelsApp API ─────────────────────────────────────────────────────
  return await trackViaParcelsAppApi(
    containerId,
    containerNumber,
    detectedCarrier,
    fallbackReason,
    now,
    currentEta,
    destinationCountry
  );
}

// ─── ParcelsApp API — shared final step for all carriers ──────────────────────
