import { db } from "../../db";
import { logger } from "../../lib/logger";
import { factoryContainers } from "../../../shared/schema";
import { eq } from "drizzle-orm";
import {
  trackContainer,
  deriveLastStatus,
  deriveLastLocation,
  deriveLastEventDate,
  type ParcelsAppShipment,
} from "../../lib/parcelsAppClient";
import { scrapeTracking, isScraperAvailable } from "../../lib/parcelsAppScraper";
import { httpScrapeTracking, isHttpScraperAvailable } from "../../lib/httpTrackingScraper";
import { scrapeMaerskDirect, isMaerskDirectScraperAvailable } from "../../lib/maerskDirectScraper";
import * as maerskPublicProvider from "../../lib/trackingProviders/maerskPublicProvider";
import * as seventeenTrack from "../../lib/trackingProviders/seventeenTrackProvider";
import * as cmaPublicProvider from "../../lib/trackingProviders/cmaPublicProvider";
import * as cmaCgmApiProvider from "../../lib/trackingProviders/cmaCgmApiProvider";
import {
  resolveEtaFromProvider,
  resolveEtaFromShipment,
  saveDirectEvents,
  saveParcelsAppEvents,
  saveTrackingCheck,
} from "./persistence";
import { check17trackQuota, ep, initProgress } from "./progress-quota";
import { trackViaParcelsAppFallback } from "./track-one";

export async function trackViaParcelsApp(
  containerId: number,
  containerNumber: string,
  detectedCarrier: string | null,
  fallbackReason: string | null,
  now: Date,
  currentEta: string | null,
  destinationCountry: string = "Congo",
  manualCarrierHint: string | null = null
): Promise<{
  success: boolean;
  lastStatus: string | null;
  lastLocation: string | null;
  lastDescription: string | null;
  lastCheckedAt: Date;
  error: string | null;
}> {
  initProgress(containerId);

  // ── CMA prefix — defined early so the HTTP scraper block can skip CMA ───────
  const CMA_PREFIXES = /^(CMAU|CMDU|APZU|CGMU|APMU|APHU|CXDU|CAAU|CAJU|CAIU)/i;

  // ── HTTP scraper ──────────────────────────────────────────────────────────
  // CMA containers bypass this step — DataDome blocks page scraping for CMA CGM.
  // The dedicated CMA chain below (official DCSA API → public endpoint → 17track)
  // is the correct path for all CMA prefixes.
  if (detectedCarrier === "CMA") {
    ep(containerId, "HTTP scraper", "skip", "CMA uses dedicated provider chain");
  } else if (isHttpScraperAvailable()) {
    ep(containerId, "HTTP scraper", "running");
    const scraped = await httpScrapeTracking(containerNumber);

    if (scraped.success && scraped.shipment) {
      const shipment = scraped.shipment;
      const lastStatus = deriveLastStatus(shipment);
      const lastLocation = deriveLastLocation(shipment);
      const lastEventDate = deriveLastEventDate(shipment);
      const lastDescription = shipment.states?.[0]?.description ?? null;
      const { eta: finalEta } = resolveEtaFromShipment(shipment, currentEta);
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
      };
      if (finalEta) updateSet.arrivalDate = finalEta;
      await db.update(factoryContainers).set(updateSet).where(eq(factoryContainers.id, containerId));
      ep(containerId, "HTTP scraper", "success", lastStatus ?? "got data");
      logger.info(`[FactoryTracking] ${containerNumber} → http_scraper: status=${lastStatus ?? "?"}`);
      return { success: true, lastStatus, lastLocation, lastDescription, lastCheckedAt: now, error: null };
    }
    ep(containerId, "HTTP scraper", "fail", scraped.error ?? "no data");
  }

  // ── Maersk provider chain ─────────────────────────────────────────────────
  // Note: CAJU is a CMA CGM prefix — excluded from this regex intentionally.
  const MAERSK_PREFIXES = /^(MAEU|MSKU|MRKU|MRSU|HASU|HJSC|HJCU|SUDU|SAFM)/i;
  if (MAERSK_PREFIXES.test(containerNumber)) {
    // Maersk direct scraper (Puppeteer intercept)
    if (isMaerskDirectScraperAvailable()) {
      ep(containerId, "Maersk Puppeteer", "running");
      const mdResult = await scrapeMaerskDirect(containerNumber);
      await saveTrackingCheck(
        containerId,
        "maersk_scraper",
        mdResult.success ? "success" : mdResult.blocked ? "blocked" : "error",
        mdResult.error ?? null,
        mdResult.raw ?? null
      );

      if (mdResult.success && (mdResult.latestStatus || mdResult.eta)) {
        const { eta: finalEta } = resolveEtaFromProvider(mdResult.eta ?? null, mdResult.events, currentEta);
        const updateSet: Record<string, unknown> = {
          trackingLastCheckedAt: now,
          trackingLastStatus: mdResult.latestStatus,
          trackingLastEventDate: mdResult.latestEventDate,
          trackingLastDescription: mdResult.latestDescription,
          trackingError: null,
          trackingChangedAt: now,
          trackingProvider: "maersk_scraper",
          trackingDetectedCarrier: detectedCarrier,
        };
        if (finalEta) updateSet.arrivalDate = finalEta;
        await db.update(factoryContainers).set(updateSet).where(eq(factoryContainers.id, containerId));
        if (mdResult.events?.length) {
          const fakeShipment: ParcelsAppShipment = {
            trackingId: containerNumber,
            done: true,
            attributes: {
              ...(mdResult.latestStatus ? { status: mdResult.latestStatus } : {}),
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
        }
        ep(containerId, "Maersk Puppeteer", "success", mdResult.latestStatus ?? "got data");
        logger.info(`[FactoryTracking] ${containerNumber} → maersk_scraper: status=${mdResult.latestStatus ?? "?"}`);
        return {
          success: true,
          lastStatus: mdResult.latestStatus,
          lastLocation: mdResult.latestLocation,
          lastDescription: mdResult.latestDescription,
          lastCheckedAt: now,
          error: null,
        };
      }
      ep(containerId, "Maersk Puppeteer", "fail", mdResult.error ?? "no data");
    } else {
      ep(containerId, "Maersk Puppeteer", "skip", "not available");
    }

    // Maersk public HTTP (no credentials, always available)
    ep(containerId, "Maersk public HTTP", "running");
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
      const { eta: finalEta } = resolveEtaFromProvider(mpResult.eta ?? null, mpResult.events, currentEta);
      const updateSet: Record<string, unknown> = {
        trackingLastCheckedAt: now,
        trackingLastStatus: mpResult.latestStatus,
        trackingLastEventDate: mpResult.latestEventDate,
        trackingLastDescription: mpResult.latestDescription,
        trackingError: null,
        trackingChangedAt: now,
        trackingProvider: "maersk_public",
        trackingDetectedCarrier: detectedCarrier,
      };
      if (finalEta) updateSet.arrivalDate = finalEta;
      await db.update(factoryContainers).set(updateSet).where(eq(factoryContainers.id, containerId));
      ep(containerId, "Maersk public HTTP", "success", mpResult.latestStatus ?? "got data");
      logger.info(`[FactoryTracking] ${containerNumber} → maersk_public: status=${mpResult.latestStatus ?? "?"}`);
      return {
        success: true,
        lastStatus: mpResult.latestStatus,
        lastLocation: mpResult.latestLocation,
        lastDescription: mpResult.latestDescription,
        lastCheckedAt: now,
        error: null,
      };
    } else if (mpResult.error === "rate_limited") {
      ep(containerId, "Maersk public HTTP", "skip", "rate-limited");
    } else {
      ep(containerId, "Maersk public HTTP", "fail", mpResult.error ?? "no data");
    }

    logger.info(`[FactoryTracking] ${containerNumber}: Maersk chain exhausted — falling through to ParcelsApp`);
  }

  // ── CMA CGM provider chain ─────────────────────────────────────────────────
  // CMA_PREFIXES already defined above (before the HTTP scraper block).
  if (CMA_PREFIXES.test(containerNumber)) {
    logger.info(`[FactoryTracking] ${containerNumber}: CMA detected — trying carrier-specific providers...`);

    // Step 1: CMA CGM Official DCSA API (needs API key)
    if (cmaCgmApiProvider.isConfigured()) {
      ep(containerId, "CMA CGM API", "running");
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
        const { eta: finalEta } = resolveEtaFromProvider(apiResult.eta ?? null, apiResult.events, currentEta);
        const updateSet: Record<string, unknown> = {
          trackingLastCheckedAt: now,
          trackingLastStatus: apiResult.latestStatus,
          trackingLastEventDate: apiResult.latestEventDate,
          trackingLastDescription: apiResult.latestDescription,
          trackingError: null,
          trackingChangedAt: now,
          trackingProvider: "cma_cgm_api",
          trackingDetectedCarrier: detectedCarrier,
        };
        if (finalEta) updateSet.arrivalDate = finalEta;
        await db.update(factoryContainers).set(updateSet).where(eq(factoryContainers.id, containerId));
        ep(containerId, "CMA CGM API", "success", apiResult.latestStatus ?? "got data");
        logger.info(`[FactoryTracking] ${containerNumber} → cma_cgm_api: status=${apiResult.latestStatus ?? "?"}`);
        return {
          success: true,
          lastStatus: apiResult.latestStatus,
          lastLocation: apiResult.latestLocation,
          lastDescription: apiResult.latestDescription,
          lastCheckedAt: now,
          error: null,
        };
      }
      ep(containerId, "CMA CGM API", apiResult.noData ? "skip" : "fail", apiResult.error ?? "no data");
      logger.info(`[FactoryTracking] ${containerNumber}: CMA official API returned no data — trying public...`);
    } else {
      ep(containerId, "CMA CGM API", "skip", "CMA_CGM_API_KEY not configured");
    }

    // Step 2: CMA CGM public endpoint (no key, sometimes blocked by DataDome)
    if (cmaPublicProvider.isEnabled()) {
      ep(containerId, "CMA public HTTP", "running");
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
        const { eta: finalEta } = resolveEtaFromProvider(cmaResult.eta ?? null, cmaResult.events, currentEta);
        const updateSet: Record<string, unknown> = {
          trackingLastCheckedAt: now,
          trackingLastStatus: cmaResult.latestStatus,
          trackingLastEventDate: cmaResult.latestEventDate,
          trackingLastDescription: cmaResult.latestDescription,
          trackingError: null,
          trackingChangedAt: now,
          trackingProvider: "cma_public",
          trackingDetectedCarrier: detectedCarrier,
        };
        if (finalEta) updateSet.arrivalDate = finalEta;
        await db.update(factoryContainers).set(updateSet).where(eq(factoryContainers.id, containerId));
        ep(containerId, "CMA public HTTP", "success", cmaResult.latestStatus ?? "got data");
        logger.info(`[FactoryTracking] ${containerNumber} → cma_public: status=${cmaResult.latestStatus ?? "?"}`);
        return {
          success: true,
          lastStatus: cmaResult.latestStatus,
          lastLocation: cmaResult.latestLocation,
          lastDescription: cmaResult.latestDescription,
          lastCheckedAt: now,
          error: null,
        };
      }
      ep(containerId, "CMA public HTTP", cmaResult.blocked ? "blocked" : "fail", cmaResult.error ?? "no data");
      logger.info(`[FactoryTracking] ${containerNumber}: CMA public failed — trying 17track...`);
    } else {
      ep(containerId, "CMA public HTTP", "skip", "not enabled");
    }

    // Step 3: 17track with CMA carrier code (skip generic 17track block below)
    if (seventeenTrack.isConfigured()) {
      const quotaOk17 = await check17trackQuota();
      if (quotaOk17) {
        ep(containerId, "17track API (CMA)", "running");
        const result17 = await seventeenTrack.track(containerNumber, seventeenTrack.CARRIER_CODES?.CMA);
        await saveTrackingCheck(
          containerId,
          "17track",
          result17.success ? "success" : result17.noData ? "no_data" : "error",
          result17.error ?? null,
          result17.raw
        );
        if (result17.success) {
          await saveDirectEvents(containerId, result17);
          const { eta: finalEta } = resolveEtaFromProvider(result17.eta ?? null, result17.events, currentEta);
          const updateSet: Record<string, unknown> = {
            trackingLastCheckedAt: now,
            trackingLastStatus: result17.latestStatus,
            trackingLastEventDate: result17.latestEventDate,
            trackingLastDescription: result17.latestDescription,
            trackingError: null,
            trackingChangedAt: now,
            trackingProvider: "17track",
            trackingDetectedCarrier: detectedCarrier,
          };
          if (finalEta) updateSet.arrivalDate = finalEta;
          await db.update(factoryContainers).set(updateSet).where(eq(factoryContainers.id, containerId));
          ep(containerId, "17track API (CMA)", "success", result17.latestStatus ?? "got data");
          logger.info(`[FactoryTracking] ${containerNumber} → 17track (CMA): status=${result17.latestStatus ?? "?"}`);
          return {
            success: true,
            lastStatus: result17.latestStatus,
            lastLocation: result17.latestLocation,
            lastDescription: result17.latestDescription,
            lastCheckedAt: now,
            error: null,
          };
        }
        ep(containerId, "17track API (CMA)", "fail", result17.error ?? "no data");
      }
    }

    // Fall through to ParcelsApp for CMA (skip generic Puppeteer / 17track blocks)
    return await trackViaParcelsAppFallback(
      containerId,
      containerNumber,
      detectedCarrier,
      fallbackReason,
      now,
      currentEta,
      destinationCountry,
      manualCarrierHint
    );
  }

  // ── CMA CGM API — leasing / unknown-carrier containers ───────────────────────
  // Leasing containers (TCNU, TIIU, UETU, ECNU…) may be shipped by CMA CGM.
  // The DCSA API looks up by equipmentReference regardless of container prefix;
  // if the box is on a CMA vessel we get full tracking — a 404/no_data comes
  // back quickly for non-CMA cargo so the overhead is negligible.
  // Maersk and CMA-prefix containers are already handled above.
  // Note: CAJU is a CMA CGM prefix — excluded from Maersk regex intentionally.
  const MAERSK_PREFIXES_FC = /^(MAEU|MSKU|MRKU|MRSU|HASU|HJSC|HJCU|SUDU|SAFM)/i;
  if (
    !CMA_PREFIXES.test(containerNumber) &&
    !MAERSK_PREFIXES_FC.test(containerNumber) &&
    cmaCgmApiProvider.isConfigured()
  ) {
    ep(containerId, "CMA CGM API", "running", "checking if container is on a CMA ship");
    logger.info(`[FactoryTracking] ${containerNumber}: trying CMA CGM API (leasing/unknown carrier)...`);
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
      const { eta: finalEta } = resolveEtaFromProvider(cmaFallResult.eta ?? null, cmaFallResult.events, currentEta);
      const updateSet: Record<string, unknown> = {
        trackingLastCheckedAt: now,
        trackingLastStatus: cmaFallResult.latestStatus,
        trackingLastEventDate: cmaFallResult.latestEventDate,
        trackingLastDescription: cmaFallResult.latestDescription,
        trackingError: null,
        trackingChangedAt: now,
        trackingProvider: "cma_cgm_api",
        trackingDetectedCarrier: detectedCarrier,
      };
      if (finalEta) updateSet.arrivalDate = finalEta;
      await db.update(factoryContainers).set(updateSet).where(eq(factoryContainers.id, containerId));
      ep(containerId, "CMA CGM API", "success", cmaFallResult.latestStatus ?? "got data");
      logger.info(
        `[FactoryTracking] ${containerNumber} → cma_cgm_api (leasing): status=${cmaFallResult.latestStatus ?? "?"}`
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
      `[FactoryTracking] ${containerNumber}: CMA API — not on CMA ship (${cmaFallResult.error ?? "no data"}) — proceeding`
    );
  }

  // ── Puppeteer scraper ─────────────────────────────────────────────────────
  if (isScraperAvailable()) {
    ep(containerId, "Puppeteer scraper", "running");
    const scraped = await scrapeTracking(containerNumber);

    if (scraped.success && scraped.shipment) {
      const shipment = scraped.shipment;
      const lastStatus = deriveLastStatus(shipment);
      const lastLocation = deriveLastLocation(shipment);
      const lastEventDate = deriveLastEventDate(shipment);
      const lastDescription = shipment.states?.[0]?.description ?? null;
      const { eta: finalEta } = resolveEtaFromShipment(shipment, currentEta);
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
      };
      if (finalEta) updateSet.arrivalDate = finalEta;
      await db.update(factoryContainers).set(updateSet).where(eq(factoryContainers.id, containerId));
      ep(containerId, "Puppeteer scraper", "success", lastStatus ?? "got data");
      logger.info(`[FactoryTracking] ${containerNumber} → parcelsapp_scraper: status=${lastStatus ?? "?"}`);
      return { success: true, lastStatus, lastLocation, lastDescription, lastCheckedAt: now, error: null };
    }
    ep(containerId, "Puppeteer scraper", scraped.blocked ? "blocked" : "fail", scraped.error ?? "no data");
  }

  // ── 17track API ───────────────────────────────────────────────────────────
  if (seventeenTrack.isConfigured()) {
    const quotaOk17 = await check17trackQuota();
    if (quotaOk17) {
      ep(containerId, "17track API", "running");
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
        const { eta: finalEta } = resolveEtaFromProvider(result17.eta ?? null, result17.events, currentEta);
        const updateSet: Record<string, unknown> = {
          trackingLastCheckedAt: now,
          trackingLastStatus: result17.latestStatus,
          trackingLastEventDate: result17.latestEventDate,
          trackingLastDescription: result17.latestDescription,
          trackingError: null,
          trackingChangedAt: now,
          trackingProvider: "17track",
          trackingDetectedCarrier: detectedCarrier,
        };
        if (finalEta) updateSet.arrivalDate = finalEta;
        await db.update(factoryContainers).set(updateSet).where(eq(factoryContainers.id, containerId));
        ep(containerId, "17track API", "success", result17.latestStatus ?? "got data");
        logger.info(`[FactoryTracking] ${containerNumber} → 17track: status=${result17.latestStatus ?? "?"}`);
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
    } else {
      ep(containerId, "17track API", "skip", "quota exhausted");
    }
  }

  // ── ParcelsApp API ────────────────────────────────────────────────────────
  if (!process.env.PARCELSAPP_API_KEY) {
    const noProviderError = "No tracking provider configured";
    await db
      .update(factoryContainers)
      .set({ trackingLastCheckedAt: now, trackingError: noProviderError })
      .where(eq(factoryContainers.id, containerId));
    return {
      success: false,
      lastStatus: null,
      lastLocation: null,
      lastDescription: null,
      lastCheckedAt: now,
      error: noProviderError,
    };
  }

  ep(containerId, "ParcelsApp API", "running");
  const effectiveHintMain =
    manualCarrierHint || (detectedCarrier && detectedCarrier !== "OTHER" ? detectedCarrier : null);
  logger.info(
    `[FactoryTracking] ${containerNumber} ParcelsApp: dest=${destinationCountry} hint=${effectiveHintMain ?? "none"} manualHint=${manualCarrierHint ?? "none"} detected=${detectedCarrier ?? "none"}`
  );
  let result = await trackContainer(containerNumber, destinationCountry, effectiveHintMain ?? undefined);

  await saveTrackingCheck(
    containerId,
    "parcelsapp",
    result.success ? "success" : result.timedOut ? "timeout" : "error",
    result.error ?? null,
    result.rawResponse
  );

  if (result.timedOut && effectiveHintMain) {
    logger.info(
      `[FactoryTracking] ${containerNumber} ParcelsApp timed out with hint="${effectiveHintMain}" — retrying without hint`
    );
    ep(containerId, "ParcelsApp API (retry no hint)", "running");
    const retryResult = await trackContainer(containerNumber, destinationCountry, undefined);
    await saveTrackingCheck(
      containerId,
      "parcelsapp_retry_no_hint",
      retryResult.success ? "success" : retryResult.timedOut ? "timeout" : "error",
      retryResult.error ?? null,
      retryResult.rawResponse
    );
    if (retryResult.success && retryResult.shipment) {
      result = { ...retryResult, rawResponse: retryResult.rawResponse };
      ep(containerId, "ParcelsApp API (retry no hint)", "success", "got data");
    } else {
      ep(containerId, "ParcelsApp API (retry no hint)", "fail", retryResult.error ?? "no data");
    }
  }

  if (!result.success || !result.shipment) {
    ep(containerId, "ParcelsApp API", "fail", result.error ?? "no data");
    const errMsg = result.timedOut
      ? `Carrier timed out (dest=${destinationCountry})`
      : (result.error ?? "Tracking failed");
    await db
      .update(factoryContainers)
      .set({ trackingLastCheckedAt: now, trackingError: errMsg, trackingProvider: "parcelsapp" })
      .where(eq(factoryContainers.id, containerId));
    return {
      success: false,
      lastStatus: null,
      lastLocation: null,
      lastDescription: null,
      lastCheckedAt: now,
      error: errMsg,
    };
  }

  const shipment = result.shipment;
  const lastStatus = deriveLastStatus(shipment);
  const lastLocation = deriveLastLocation(shipment);
  const lastEventDate = deriveLastEventDate(shipment);
  const lastDescription = shipment.states?.[0]?.description ?? null;
  const { eta: finalEta } = resolveEtaFromShipment(shipment, currentEta);
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
  if (finalEta) updateSet.arrivalDate = finalEta;
  await db.update(factoryContainers).set(updateSet).where(eq(factoryContainers.id, containerId));

  ep(containerId, "ParcelsApp API", "success", lastStatus ?? "got data");
  logger.info(`[FactoryTracking] ${containerNumber} → parcelsapp: status=${lastStatus ?? "?"}`);
  return { success: true, lastStatus, lastLocation, lastDescription, lastCheckedAt: now, error: null };
}

// ── In-flight tracking cap ────────────────────────────────────────────────────
// Prevents "Track All" from launching unlimited concurrent background jobs
// which, combined with Chrome's memory footprint, OOMs a 2 GB host.
