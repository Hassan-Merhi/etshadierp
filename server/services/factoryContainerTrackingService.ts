/**
 * factoryContainerTrackingService.ts
 *
 * Mirrors containerTrackingService.ts but operates on factory_containers,
 * factory_container_tracking_events, and factory_container_tracking_checks tables.
 * Reuses the same provider chain (http_scraper → direct → parcelsapp_scraper →
 * 17track → parcelsapp API).
 */

import { db } from "../db";
import {
  factoryContainers,
  factoryContainerTrackingEvents,
  factoryContainerTrackingChecks,
} from "../../shared/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import {
  trackContainer,
  normaliseEvents,
  deriveLastStatus,
  deriveLastLocation,
  deriveLastEventDate,
  deriveEstimatedDeliveryDate,
  type ParcelsAppShipment,
} from "../lib/parcelsAppClient";
import { scrapeTracking, isScraperAvailable } from "../lib/parcelsAppScraper";
import { httpScrapeTracking, isHttpScraperAvailable } from "../lib/httpTrackingScraper";
import { scrapeMaerskDirect, isMaerskDirectScraperAvailable } from "../lib/maerskDirectScraper";
import * as maerskPublicProvider from "../lib/trackingProviders/maerskPublicProvider";
import * as seventeenTrack from "../lib/trackingProviders/seventeenTrackProvider";
import * as cmaPublicProvider from "../lib/trackingProviders/cmaPublicProvider";
import * as cmaCgmApiProvider from "../lib/trackingProviders/cmaCgmApiProvider";
import { resolveProvider } from "../lib/trackingProviders/providerResolver";
import type { CarrierTrackResult } from "../lib/trackingProviders/types";

// ── Status helpers ────────────────────────────────────────────────────────────

const INACTIVE_LOWER = ["offloaded", "closed", "completed"] as const;

function isInactiveStatus(status: string): boolean {
  return INACTIVE_LOWER.includes(status.toLowerCase() as any);
}

const activeStatusFilter = sql`LOWER(${factoryContainers.status}) NOT IN ('offloaded','closed','completed')`;

function isValidContainerNumber(containerNumber: string | null | undefined): boolean {
  if (!containerNumber) return false;
  return /^[A-Z]{4}\d{7}$/.test(containerNumber.trim().toUpperCase());
}

// ── Progress tracking ─────────────────────────────────────────────────────────

interface ProgressStep {
  provider: string;
  status: "running" | "success" | "fail" | "skip" | "blocked";
  detail?: string;
  ts: number;
}

const _progressStore = new Map<number, ProgressStep[]>();

export function getFactoryTrackingProgress(containerId: number): ProgressStep[] {
  return _progressStore.get(containerId) ?? [];
}

function initProgress(containerId: number): void {
  _progressStore.set(containerId, []);
  setTimeout(() => _progressStore.delete(containerId), 10 * 60 * 1000);
}

function ep(containerId: number, provider: string, status: ProgressStep["status"], detail?: string): void {
  let steps = _progressStore.get(containerId);
  if (!steps) { steps = []; _progressStore.set(containerId, steps); }
  const existing = steps.find((s) => s.provider === provider);
  if (existing) {
    existing.status = status;
    existing.detail = detail;
    existing.ts = Date.now();
  } else {
    steps.push({ provider, status, detail, ts: Date.now() });
  }
}

// ── Quota helpers (shared with ERP — reads from ERP's checks table for quota) ─

async function checkParcelsAppQuota(): Promise<boolean> {
  const limit = Math.max(1, parseInt(process.env.PARCELSAPP_MONTHLY_LIMIT ?? "500") || 500);
  try {
    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const { containerTrackingChecks } = await import("../../shared/schema");
    const result = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(containerTrackingChecks)
      .where(
        and(
          eq(containerTrackingChecks.provider, "parcelsapp"),
          gte(containerTrackingChecks.checkedAt, startOfMonth),
        ),
      );
    const used = result[0]?.count ?? 0;
    return used < limit;
  } catch {
    return true;
  }
}

async function check17trackQuota(): Promise<boolean> {
  const limit = seventeenTrack.getMonthlyLimit();
  try {
    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const { containerTrackingChecks } = await import("../../shared/schema");
    const result = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(containerTrackingChecks)
      .where(
        and(
          eq(containerTrackingChecks.provider, "17track"),
          gte(containerTrackingChecks.checkedAt, startOfMonth),
        ),
      );
    const used = result[0]?.count ?? 0;
    return used < limit;
  } catch {
    return true;
  }
}

function anyProviderConfigured(): boolean {
  return (
    !!process.env.PARCELSAPP_API_KEY ||
    seventeenTrack.isConfigured() ||
    isScraperAvailable() ||
    isHttpScraperAvailable() ||
    isMaerskDirectScraperAvailable()
  );
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function saveTrackingCheck(
  containerId: number,
  provider: string,
  status: string,
  errorMessage: string | null,
  rawResponse: unknown,
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
  } catch (err: any) {
    console.warn("[FactoryTracking] Check record save warn:", err?.message);
  }
}

async function saveDirectEvents(containerId: number, result: CarrierTrackResult): Promise<void> {
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
    } catch (err: any) {
      console.warn("[FactoryTracking] Direct event save warn:", err?.message);
    }
  }
}

async function saveParcelsAppEvents(containerId: number, shipment: ParcelsAppShipment): Promise<void> {
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
    } catch (err: any) {
      console.warn("[FactoryTracking] ParcelsApp event save warn:", err?.message);
    }
  }
}

async function setSchedulerMeta(
  containerId: number,
  skipReason: string | null,
  nextCheckAt: Date | null | undefined,
): Promise<void> {
  try {
    const patch: Record<string, unknown> = { trackingLastSkipReason: skipReason };
    if (nextCheckAt !== undefined) patch.trackingNextCheckAt = nextCheckAt;
    await db.update(factoryContainers).set(patch as any).where(eq(factoryContainers.id, containerId));
  } catch (err: any) {
    console.warn("[FactoryTracking] setSchedulerMeta warn:", err?.message);
  }
}

// ── ETA helpers ───────────────────────────────────────────────────────────────

function resolveEtaFromProvider(
  providerEta: string | null,
  _events: any[] | undefined,
  currentEta: string | null,
): { eta: string | null; source: "api" | "manual" | null } {
  if (providerEta) return { eta: providerEta, source: "api" };
  if (currentEta) return { eta: currentEta, source: "manual" };
  return { eta: null, source: null };
}

function resolveEtaFromShipment(
  shipment: ParcelsAppShipment,
  currentEta: string | null,
): { eta: string | null; source: "api" | "manual" | null } {
  const derived = deriveEstimatedDeliveryDate(shipment);
  if (derived) return { eta: derived, source: "api" };
  if (currentEta) return { eta: currentEta, source: "manual" };
  return { eta: null, source: null };
}

// ── Core tracking implementation ──────────────────────────────────────────────

async function trackOneContainer(
  containerId: number,
  containerNumber: string,
  destinationCountry: string = "Congo",
  manualCarrierHint: string | null = null,
): Promise<{
  success: boolean;
  lastStatus: string | null;
  lastLocation: string | null;
  lastDescription: string | null;
  lastCheckedAt: Date;
  error: string | null;
}> {
  const now = new Date();

  const [currentRow] = await db
    .select({ arrivalDate: factoryContainers.arrivalDate, trackingLastCheckedAt: factoryContainers.trackingLastCheckedAt })
    .from(factoryContainers)
    .where(eq(factoryContainers.id, containerId))
    .limit(1);
  const currentEta: string | null = currentRow?.arrivalDate ?? null;

  if (!isValidContainerNumber(containerNumber)) {
    const errMsg = `Invalid container number format: "${containerNumber}" (must be 4 letters + 7 digits)`;
    console.log(`[FactoryTracking] ${containerNumber}: skipped — ${errMsg}`);
    await saveTrackingCheck(containerId, "skipped", "invalid_container_number", errMsg, null);
    await db
      .update(factoryContainers)
      .set({ trackingLastCheckedAt: now, trackingError: errMsg } as any)
      .where(eq(factoryContainers.id, containerId));
    return { success: false, lastStatus: null, lastLocation: null, lastDescription: null, lastCheckedAt: now, error: errMsg };
  }

  const { detectedCarrier, tryDirect } = resolveProvider(containerNumber);
  let lastDirectFallbackReason: string | null = null;

  for (const attempt of tryDirect) {
    const result = await attempt();

    if (result.success) {
      await saveDirectEvents(containerId, result);
      await saveTrackingCheck(containerId, result.provider, "success", null, result.raw);

      const { eta: finalEta } = resolveEtaFromProvider(result.eta ?? null, result.events, currentEta);

      const updateSet: Record<string, unknown> = {
        trackingLastCheckedAt: now,
        trackingLastStatus: result.latestStatus,
        trackingLastEventDate: result.latestEventDate,
        trackingLastDescription: result.latestDescription,
        trackingError: null,
        trackingChangedAt: now,
        trackingProvider: result.provider,
        trackingDetectedCarrier: detectedCarrier,
      };
      if (finalEta) updateSet.arrivalDate = finalEta;

      await db.update(factoryContainers).set(updateSet as any).where(eq(factoryContainers.id, containerId));
      console.log(`[FactoryTracking] ${containerNumber} → ${result.provider}: status=${result.latestStatus ?? "?"}`);

      return {
        success: true,
        lastStatus: result.latestStatus,
        lastLocation: result.latestLocation,
        lastDescription: result.latestDescription,
        lastCheckedAt: now,
        error: null,
      };
    }

    const checkStatus = result.blocked ? "blocked" : result.noData ? "no_data" : "error";
    await saveTrackingCheck(containerId, result.provider, checkStatus, result.error ?? null, null);
    console.log(`[FactoryTracking] ${containerNumber}: ${result.provider} failed — trying next provider`);
    lastDirectFallbackReason = result.provider + "_failed";
  }

  return await trackViaParcelsApp(containerId, containerNumber, detectedCarrier, lastDirectFallbackReason, now, currentEta, destinationCountry, manualCarrierHint);
}

// ParcelsApp-only fallback — used by CMA chain after exhausting carrier-specific providers.
async function trackViaParcelsAppFallback(
  containerId: number,
  containerNumber: string,
  detectedCarrier: string | null,
  fallbackReason: string | null,
  now: Date,
  currentEta: string | null,
  destinationCountry: string = "Congo",
  manualCarrierHint: string | null = null,
): Promise<{
  success: boolean;
  lastStatus: string | null;
  lastLocation: string | null;
  lastDescription: string | null;
  lastCheckedAt: Date;
  error: string | null;
}> {
  if (!process.env.PARCELSAPP_API_KEY) {
    const noProviderError = "No tracking provider configured";
    await db.update(factoryContainers).set({ trackingLastCheckedAt: now, trackingError: noProviderError } as any).where(eq(factoryContainers.id, containerId));
    return { success: false, lastStatus: null, lastLocation: null, lastDescription: null, lastCheckedAt: now, error: noProviderError };
  }
  ep(containerId, "ParcelsApp API", "running");
  const effectiveHint = manualCarrierHint || (detectedCarrier && detectedCarrier !== "OTHER" ? detectedCarrier : null);
  console.log(`[FactoryTracking] ${containerNumber} ParcelsApp fallback: dest=${destinationCountry} hint=${effectiveHint ?? "none"} manualHint=${manualCarrierHint ?? "none"} detected=${detectedCarrier ?? "none"}`);
  let result = await trackContainer(containerNumber, destinationCountry, effectiveHint ?? undefined);
  await saveTrackingCheck(containerId, "parcelsapp", result.success ? "success" : result.timedOut ? "timeout" : "error", result.error ?? null, result.rawResponse);
  if (result.timedOut && effectiveHint) {
    console.log(`[FactoryTracking] ${containerNumber} ParcelsApp fallback timed out with hint="${effectiveHint}" — retrying without hint`);
    ep(containerId, "ParcelsApp API (retry no hint)", "running");
    const retryResult = await trackContainer(containerNumber, destinationCountry, undefined);
    await saveTrackingCheck(containerId, "parcelsapp_retry_no_hint", retryResult.success ? "success" : retryResult.timedOut ? "timeout" : "error", retryResult.error ?? null, retryResult.rawResponse);
    if (retryResult.success && retryResult.shipment) {
      result = { ...retryResult, rawResponse: retryResult.rawResponse };
      ep(containerId, "ParcelsApp API (retry no hint)", "success", retryResult.shipment ? "got data" : "no data");
    } else {
      ep(containerId, "ParcelsApp API (retry no hint)", "fail", retryResult.error ?? "no data");
    }
  }
  if (!result.success || !result.shipment) {
    ep(containerId, "ParcelsApp API", "fail", result.error ?? "no data");
    const errMsg = result.timedOut ? `Carrier timed out (dest=${destinationCountry})` : (result.error ?? "Tracking failed");
    await db.update(factoryContainers).set({ trackingLastCheckedAt: now, trackingError: errMsg, trackingProvider: "parcelsapp" } as any).where(eq(factoryContainers.id, containerId));
    return { success: false, lastStatus: null, lastLocation: null, lastDescription: null, lastCheckedAt: now, error: errMsg };
  }
  const shipment = result.shipment;
  const lastStatus = deriveLastStatus(shipment);
  const lastLocation = deriveLastLocation(shipment);
  const lastEventDate = deriveLastEventDate(shipment);
  const lastDescription = shipment.states?.[0]?.description ?? null;
  const { eta: finalEta } = resolveEtaFromShipment(shipment, currentEta);
  await saveParcelsAppEvents(containerId, shipment);
  const updateSet: Record<string, unknown> = {
    trackingLastCheckedAt: now, trackingLastStatus: lastStatus,
    trackingLastEventDate: lastEventDate, trackingLastDescription: lastDescription,
    trackingError: null, trackingChangedAt: now, trackingProvider: "parcelsapp",
    trackingDetectedCarrier: detectedCarrier, trackingFallbackUsed: !!fallbackReason, trackingFallbackReason: fallbackReason,
  };
  if (finalEta) updateSet.arrivalDate = finalEta;
  await db.update(factoryContainers).set(updateSet as any).where(eq(factoryContainers.id, containerId));
  ep(containerId, "ParcelsApp API", "success", lastStatus ?? "got data");
  console.log(`[FactoryTracking] ${containerNumber} → parcelsapp (CMA fallback): status=${lastStatus ?? "?"}`);
  return { success: true, lastStatus, lastLocation, lastDescription, lastCheckedAt: now, error: null };
}

async function trackViaParcelsApp(
  containerId: number,
  containerNumber: string,
  detectedCarrier: string | null,
  fallbackReason: string | null,
  now: Date,
  currentEta: string | null,
  destinationCountry: string = "Congo",
  manualCarrierHint: string | null = null,
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
        trackingLastCheckedAt: now, trackingLastStatus: lastStatus,
        trackingLastEventDate: lastEventDate, trackingLastDescription: lastDescription,
        trackingError: null, trackingChangedAt: now, trackingProvider: "http_scraper",
        trackingDetectedCarrier: detectedCarrier,
      };
      if (finalEta) updateSet.arrivalDate = finalEta;
      await db.update(factoryContainers).set(updateSet as any).where(eq(factoryContainers.id, containerId));
      ep(containerId, "HTTP scraper", "success", lastStatus ?? "got data");
      console.log(`[FactoryTracking] ${containerNumber} → http_scraper: status=${lastStatus ?? "?"}`);
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
      await saveTrackingCheck(containerId, "maersk_scraper",
        mdResult.success ? "success" : mdResult.blocked ? "blocked" : "error",
        mdResult.error ?? null, mdResult.raw ?? null);

      if (mdResult.success && (mdResult.latestStatus || mdResult.eta)) {
        const { eta: finalEta } = resolveEtaFromProvider(mdResult.eta ?? null, mdResult.events, currentEta);
        const updateSet: Record<string, unknown> = {
          trackingLastCheckedAt: now, trackingLastStatus: mdResult.latestStatus,
          trackingLastEventDate: mdResult.latestEventDate, trackingLastDescription: mdResult.latestDescription,
          trackingError: null, trackingChangedAt: now, trackingProvider: "maersk_scraper",
          trackingDetectedCarrier: detectedCarrier,
        };
        if (finalEta) updateSet.arrivalDate = finalEta;
        await db.update(factoryContainers).set(updateSet as any).where(eq(factoryContainers.id, containerId));
        if (mdResult.events?.length) {
          const fakeShipment: ParcelsAppShipment = {
            trackingId: containerNumber, done: true,
            attributes: { ...(mdResult.latestStatus ? { status: mdResult.latestStatus } : {}), ...(finalEta ? { estimatedArrival: finalEta } : {}) },
            states: mdResult.events.map((e) => ({ date: e.date?.toISOString().slice(0, 10) ?? "", status: e.status ?? "", location: e.location ?? "", description: e.description ?? "" })),
          };
          await saveParcelsAppEvents(containerId, fakeShipment);
        }
        ep(containerId, "Maersk Puppeteer", "success", mdResult.latestStatus ?? "got data");
        console.log(`[FactoryTracking] ${containerNumber} → maersk_scraper: status=${mdResult.latestStatus ?? "?"}`);
        return { success: true, lastStatus: mdResult.latestStatus, lastLocation: mdResult.latestLocation, lastDescription: mdResult.latestDescription, lastCheckedAt: now, error: null };
      }
      ep(containerId, "Maersk Puppeteer", "fail", mdResult.error ?? "no data");
    } else {
      ep(containerId, "Maersk Puppeteer", "skip", "not available");
    }

    // Maersk public HTTP (no credentials, always available)
    ep(containerId, "Maersk public HTTP", "running");
    const mpResult = await maerskPublicProvider.track(containerNumber);
    const mpStatus = mpResult.success ? "success" : mpResult.blocked ? "blocked" : mpResult.error === "rate_limited" ? "skipped" : "error";
    await saveTrackingCheck(containerId, "maersk_public", mpStatus, mpResult.error ?? null, mpResult.raw ?? null);

    if (mpResult.success && (mpResult.latestStatus || mpResult.events.length > 0)) {
      await saveDirectEvents(containerId, mpResult);
      const { eta: finalEta } = resolveEtaFromProvider(mpResult.eta ?? null, mpResult.events, currentEta);
      const updateSet: Record<string, unknown> = {
        trackingLastCheckedAt: now, trackingLastStatus: mpResult.latestStatus,
        trackingLastEventDate: mpResult.latestEventDate, trackingLastDescription: mpResult.latestDescription,
        trackingError: null, trackingChangedAt: now, trackingProvider: "maersk_public",
        trackingDetectedCarrier: detectedCarrier,
      };
      if (finalEta) updateSet.arrivalDate = finalEta;
      await db.update(factoryContainers).set(updateSet as any).where(eq(factoryContainers.id, containerId));
      ep(containerId, "Maersk public HTTP", "success", mpResult.latestStatus ?? "got data");
      console.log(`[FactoryTracking] ${containerNumber} → maersk_public: status=${mpResult.latestStatus ?? "?"}`);
      return { success: true, lastStatus: mpResult.latestStatus, lastLocation: mpResult.latestLocation, lastDescription: mpResult.latestDescription, lastCheckedAt: now, error: null };
    } else if (mpResult.error === "rate_limited") {
      ep(containerId, "Maersk public HTTP", "skip", "rate-limited");
    } else {
      ep(containerId, "Maersk public HTTP", "fail", mpResult.error ?? "no data");
    }

    console.log(`[FactoryTracking] ${containerNumber}: Maersk chain exhausted — falling through to ParcelsApp`);
  }

  // ── CMA CGM provider chain ─────────────────────────────────────────────────
  // CMA_PREFIXES already defined above (before the HTTP scraper block).
  if (CMA_PREFIXES.test(containerNumber)) {
    console.log(`[FactoryTracking] ${containerNumber}: CMA detected — trying carrier-specific providers...`);

    // Step 1: CMA CGM Official DCSA API (needs API key)
    if (cmaCgmApiProvider.isConfigured()) {
      ep(containerId, "CMA CGM API", "running");
      const apiResult = await cmaCgmApiProvider.track(containerNumber);
      await saveTrackingCheck(containerId, "cma_cgm_api",
        apiResult.success ? "success" : apiResult.noData ? "no_data" : "error",
        apiResult.error ?? null, apiResult.raw ?? null);

      if (apiResult.success && (apiResult.latestStatus || apiResult.events.length > 0)) {
        await saveDirectEvents(containerId, apiResult);
        const { eta: finalEta } = resolveEtaFromProvider(apiResult.eta ?? null, apiResult.events, currentEta);
        const updateSet: Record<string, unknown> = {
          trackingLastCheckedAt: now, trackingLastStatus: apiResult.latestStatus,
          trackingLastEventDate: apiResult.latestEventDate, trackingLastDescription: apiResult.latestDescription,
          trackingError: null, trackingChangedAt: now, trackingProvider: "cma_cgm_api",
          trackingDetectedCarrier: detectedCarrier,
        };
        if (finalEta) updateSet.arrivalDate = finalEta;
        await db.update(factoryContainers).set(updateSet as any).where(eq(factoryContainers.id, containerId));
        ep(containerId, "CMA CGM API", "success", apiResult.latestStatus ?? "got data");
        console.log(`[FactoryTracking] ${containerNumber} → cma_cgm_api: status=${apiResult.latestStatus ?? "?"}`);
        return { success: true, lastStatus: apiResult.latestStatus, lastLocation: apiResult.latestLocation, lastDescription: apiResult.latestDescription, lastCheckedAt: now, error: null };
      }
      ep(containerId, "CMA CGM API", apiResult.noData ? "skip" : "fail", apiResult.error ?? "no data");
      console.log(`[FactoryTracking] ${containerNumber}: CMA official API returned no data — trying public...`);
    } else {
      ep(containerId, "CMA CGM API", "skip", "CMA_CGM_API_KEY not configured");
    }

    // Step 2: CMA CGM public endpoint (no key, sometimes blocked by DataDome)
    if (cmaPublicProvider.isEnabled()) {
      ep(containerId, "CMA public HTTP", "running");
      const cmaResult = await cmaPublicProvider.track(containerNumber);
      await saveTrackingCheck(containerId, "cma_public",
        cmaResult.success ? "success" : cmaResult.blocked ? "blocked" : "error",
        cmaResult.error ?? null, cmaResult.raw ?? null);

      if (cmaResult.success && (cmaResult.latestStatus || cmaResult.events.length > 0)) {
        await saveDirectEvents(containerId, cmaResult);
        const { eta: finalEta } = resolveEtaFromProvider(cmaResult.eta ?? null, cmaResult.events, currentEta);
        const updateSet: Record<string, unknown> = {
          trackingLastCheckedAt: now, trackingLastStatus: cmaResult.latestStatus,
          trackingLastEventDate: cmaResult.latestEventDate, trackingLastDescription: cmaResult.latestDescription,
          trackingError: null, trackingChangedAt: now, trackingProvider: "cma_public",
          trackingDetectedCarrier: detectedCarrier,
        };
        if (finalEta) updateSet.arrivalDate = finalEta;
        await db.update(factoryContainers).set(updateSet as any).where(eq(factoryContainers.id, containerId));
        ep(containerId, "CMA public HTTP", "success", cmaResult.latestStatus ?? "got data");
        console.log(`[FactoryTracking] ${containerNumber} → cma_public: status=${cmaResult.latestStatus ?? "?"}`);
        return { success: true, lastStatus: cmaResult.latestStatus, lastLocation: cmaResult.latestLocation, lastDescription: cmaResult.latestDescription, lastCheckedAt: now, error: null };
      }
      ep(containerId, "CMA public HTTP", cmaResult.blocked ? "blocked" : "fail", cmaResult.error ?? "no data");
      console.log(`[FactoryTracking] ${containerNumber}: CMA public failed — trying 17track...`);
    } else {
      ep(containerId, "CMA public HTTP", "skip", "not enabled");
    }

    // Step 3: 17track with CMA carrier code (skip generic 17track block below)
    if (seventeenTrack.isConfigured()) {
      const quotaOk17 = await check17trackQuota();
      if (quotaOk17) {
        ep(containerId, "17track API (CMA)", "running");
        const result17 = await seventeenTrack.track(containerNumber, seventeenTrack.CARRIER_CODES?.CMA);
        await saveTrackingCheck(containerId, "17track",
          result17.success ? "success" : result17.noData ? "no_data" : "error",
          result17.error ?? null, result17.raw);
        if (result17.success) {
          await saveDirectEvents(containerId, result17);
          const { eta: finalEta } = resolveEtaFromProvider(result17.eta ?? null, result17.events, currentEta);
          const updateSet: Record<string, unknown> = {
            trackingLastCheckedAt: now, trackingLastStatus: result17.latestStatus,
            trackingLastEventDate: result17.latestEventDate, trackingLastDescription: result17.latestDescription,
            trackingError: null, trackingChangedAt: now, trackingProvider: "17track",
            trackingDetectedCarrier: detectedCarrier,
          };
          if (finalEta) updateSet.arrivalDate = finalEta;
          await db.update(factoryContainers).set(updateSet as any).where(eq(factoryContainers.id, containerId));
          ep(containerId, "17track API (CMA)", "success", result17.latestStatus ?? "got data");
          console.log(`[FactoryTracking] ${containerNumber} → 17track (CMA): status=${result17.latestStatus ?? "?"}`);
          return { success: true, lastStatus: result17.latestStatus, lastLocation: result17.latestLocation, lastDescription: result17.latestDescription, lastCheckedAt: now, error: null };
        }
        ep(containerId, "17track API (CMA)", "fail", result17.error ?? "no data");
      }
    }

    // Fall through to ParcelsApp for CMA (skip generic Puppeteer / 17track blocks)
    return await trackViaParcelsAppFallback(containerId, containerNumber, detectedCarrier, fallbackReason, now, currentEta, destinationCountry, manualCarrierHint);
  }

  // ── CMA CGM API — leasing / unknown-carrier containers ───────────────────────
  // Leasing containers (TCNU, TIIU, UETU, ECNU…) may be shipped by CMA CGM.
  // The DCSA API looks up by equipmentReference regardless of container prefix;
  // if the box is on a CMA vessel we get full tracking — a 404/no_data comes
  // back quickly for non-CMA cargo so the overhead is negligible.
  // Maersk and CMA-prefix containers are already handled above.
  // Note: CAJU is a CMA CGM prefix — excluded from Maersk regex intentionally.
  const MAERSK_PREFIXES_FC = /^(MAEU|MSKU|MRKU|MRSU|HASU|HJSC|HJCU|SUDU|SAFM)/i;
  if (!CMA_PREFIXES.test(containerNumber) && !MAERSK_PREFIXES_FC.test(containerNumber) && cmaCgmApiProvider.isConfigured()) {
    ep(containerId, "CMA CGM API", "running", "checking if container is on a CMA ship");
    console.log(`[FactoryTracking] ${containerNumber}: trying CMA CGM API (leasing/unknown carrier)...`);
    const cmaFallResult = await cmaCgmApiProvider.track(containerNumber);
    await saveTrackingCheck(containerId, "cma_cgm_api",
      cmaFallResult.success ? "success" : cmaFallResult.noData ? "no_data" : "error",
      cmaFallResult.error ?? null, cmaFallResult.raw ?? null);
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
      await db.update(factoryContainers).set(updateSet as any).where(eq(factoryContainers.id, containerId));
      ep(containerId, "CMA CGM API", "success", cmaFallResult.latestStatus ?? "got data");
      console.log(`[FactoryTracking] ${containerNumber} → cma_cgm_api (leasing): status=${cmaFallResult.latestStatus ?? "?"}`);
      return { success: true, lastStatus: cmaFallResult.latestStatus, lastLocation: cmaFallResult.latestLocation, lastDescription: cmaFallResult.latestDescription, lastCheckedAt: now, error: null };
    }
    ep(containerId, "CMA CGM API", cmaFallResult.noData ? "skip" : "fail", cmaFallResult.error ?? "not on CMA ship");
    console.log(`[FactoryTracking] ${containerNumber}: CMA API — not on CMA ship (${cmaFallResult.error ?? "no data"}) — proceeding`);
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
        trackingLastCheckedAt: now, trackingLastStatus: lastStatus,
        trackingLastEventDate: lastEventDate, trackingLastDescription: lastDescription,
        trackingError: null, trackingChangedAt: now, trackingProvider: "parcelsapp_scraper",
        trackingDetectedCarrier: detectedCarrier,
      };
      if (finalEta) updateSet.arrivalDate = finalEta;
      await db.update(factoryContainers).set(updateSet as any).where(eq(factoryContainers.id, containerId));
      ep(containerId, "Puppeteer scraper", "success", lastStatus ?? "got data");
      console.log(`[FactoryTracking] ${containerNumber} → parcelsapp_scraper: status=${lastStatus ?? "?"}`);
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
        containerId, "17track",
        result17.success ? "success" : result17.noData ? "no_data" : "error",
        result17.error ?? null, result17.raw,
      );

      if (result17.success) {
        await saveDirectEvents(containerId, result17);
        const { eta: finalEta } = resolveEtaFromProvider(result17.eta ?? null, result17.events, currentEta);
        const updateSet: Record<string, unknown> = {
          trackingLastCheckedAt: now, trackingLastStatus: result17.latestStatus,
          trackingLastEventDate: result17.latestEventDate, trackingLastDescription: result17.latestDescription,
          trackingError: null, trackingChangedAt: now, trackingProvider: "17track",
          trackingDetectedCarrier: detectedCarrier,
        };
        if (finalEta) updateSet.arrivalDate = finalEta;
        await db.update(factoryContainers).set(updateSet as any).where(eq(factoryContainers.id, containerId));
        ep(containerId, "17track API", "success", result17.latestStatus ?? "got data");
        console.log(`[FactoryTracking] ${containerNumber} → 17track: status=${result17.latestStatus ?? "?"}`);
        return {
          success: true, lastStatus: result17.latestStatus,
          lastLocation: result17.latestLocation, lastDescription: result17.latestDescription,
          lastCheckedAt: now, error: null,
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
      .set({ trackingLastCheckedAt: now, trackingError: noProviderError } as any)
      .where(eq(factoryContainers.id, containerId));
    return { success: false, lastStatus: null, lastLocation: null, lastDescription: null, lastCheckedAt: now, error: noProviderError };
  }

  ep(containerId, "ParcelsApp API", "running");
  const effectiveHintMain = manualCarrierHint || (detectedCarrier && detectedCarrier !== "OTHER" ? detectedCarrier : null);
  console.log(`[FactoryTracking] ${containerNumber} ParcelsApp: dest=${destinationCountry} hint=${effectiveHintMain ?? "none"} manualHint=${manualCarrierHint ?? "none"} detected=${detectedCarrier ?? "none"}`);
  let result = await trackContainer(containerNumber, destinationCountry, effectiveHintMain ?? undefined);

  await saveTrackingCheck(
    containerId, "parcelsapp",
    result.success ? "success" : result.timedOut ? "timeout" : "error",
    result.error ?? null, result.rawResponse,
  );

  if (result.timedOut && effectiveHintMain) {
    console.log(`[FactoryTracking] ${containerNumber} ParcelsApp timed out with hint="${effectiveHintMain}" — retrying without hint`);
    ep(containerId, "ParcelsApp API (retry no hint)", "running");
    const retryResult = await trackContainer(containerNumber, destinationCountry, undefined);
    await saveTrackingCheck(containerId, "parcelsapp_retry_no_hint", retryResult.success ? "success" : retryResult.timedOut ? "timeout" : "error", retryResult.error ?? null, retryResult.rawResponse);
    if (retryResult.success && retryResult.shipment) {
      result = { ...retryResult, rawResponse: retryResult.rawResponse };
      ep(containerId, "ParcelsApp API (retry no hint)", "success", "got data");
    } else {
      ep(containerId, "ParcelsApp API (retry no hint)", "fail", retryResult.error ?? "no data");
    }
  }

  if (!result.success || !result.shipment) {
    ep(containerId, "ParcelsApp API", "fail", result.error ?? "no data");
    const errMsg = result.timedOut ? `Carrier timed out (dest=${destinationCountry})` : (result.error ?? "Tracking failed");
    await db
      .update(factoryContainers)
      .set({ trackingLastCheckedAt: now, trackingError: errMsg, trackingProvider: "parcelsapp" } as any)
      .where(eq(factoryContainers.id, containerId));
    return { success: false, lastStatus: null, lastLocation: null, lastDescription: null, lastCheckedAt: now, error: errMsg };
  }

  const shipment = result.shipment;
  const lastStatus = deriveLastStatus(shipment);
  const lastLocation = deriveLastLocation(shipment);
  const lastEventDate = deriveLastEventDate(shipment);
  const lastDescription = shipment.states?.[0]?.description ?? null;
  const { eta: finalEta } = resolveEtaFromShipment(shipment, currentEta);
  await saveParcelsAppEvents(containerId, shipment);

  const updateSet: Record<string, unknown> = {
    trackingLastCheckedAt: now, trackingLastStatus: lastStatus,
    trackingLastEventDate: lastEventDate, trackingLastDescription: lastDescription,
    trackingError: null, trackingChangedAt: now, trackingProvider: "parcelsapp",
    trackingDetectedCarrier: detectedCarrier,
    trackingFallbackUsed: !!fallbackReason, trackingFallbackReason: fallbackReason,
  };
  if (finalEta) updateSet.arrivalDate = finalEta;
  await db.update(factoryContainers).set(updateSet as any).where(eq(factoryContainers.id, containerId));

  ep(containerId, "ParcelsApp API", "success", lastStatus ?? "got data");
  console.log(`[FactoryTracking] ${containerNumber} → parcelsapp: status=${lastStatus ?? "?"}`);
  return { success: true, lastStatus, lastLocation, lastDescription, lastCheckedAt: now, error: null };
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface FactoryTrackNowResult {
  success: boolean;
  containerNumber: string;
  provider: string | null;
  lastStatus: string | null;
  lastLocation: string | null;
  lastDescription: string | null;
  lastCheckedAt: Date;
  oldEta: string | null;
  newEta: string | null;
  etaChanged: boolean;
  attempts: Array<{ provider: string; status: string; error: string | null }>;
  error: string | null;
}

export async function trackOneFactoryContainerById(containerId: number): Promise<FactoryTrackNowResult> {
  const [row] = await db
    .select({
      id: factoryContainers.id,
      containerNumber: factoryContainers.containerNumber,
      status: factoryContainers.status,
      arrivalDate: factoryContainers.arrivalDate,
      destination: factoryContainers.destination,
      trackingCarrierHint: factoryContainers.trackingCarrierHint,
    })
    .from(factoryContainers)
    .where(eq(factoryContainers.id, containerId))
    .limit(1);

  if (!row) throw new Error("Container not found");

  if (isInactiveStatus(row.status)) {
    throw new Error("Tracking is disabled for offloaded/closed/completed containers.");
  }

  const oldEta = row.arrivalDate ?? null;
  const trackStartedAt = new Date();
  const destinationCountry = row.destination || "Congo";
  const manualCarrierHint = row.trackingCarrierHint ?? null;
  console.log(`[FactoryTracking] trackOneFactoryContainerById: container=${row.containerNumber} dest="${destinationCountry}" manualHint=${manualCarrierHint ?? "none"}`);

  const result = await trackOneContainer(row.id, row.containerNumber, destinationCountry, manualCarrierHint);
  await setSchedulerMeta(row.id, null, new Date(Date.now() + 24 * 60 * 60 * 1000));

  const [postRow] = await db
    .select({ arrivalDate: factoryContainers.arrivalDate, trackingProvider: factoryContainers.trackingProvider })
    .from(factoryContainers)
    .where(eq(factoryContainers.id, containerId))
    .limit(1);

  const newEta = postRow?.arrivalDate ?? null;
  const finalProvider = postRow?.trackingProvider ?? null;

  const attemptRows = await db
    .select({
      provider: factoryContainerTrackingChecks.provider,
      status: factoryContainerTrackingChecks.status,
      error: factoryContainerTrackingChecks.errorMessage,
    })
    .from(factoryContainerTrackingChecks)
    .where(
      and(
        eq(factoryContainerTrackingChecks.containerId, containerId),
        gte(factoryContainerTrackingChecks.checkedAt, trackStartedAt),
      ),
    )
    .orderBy(factoryContainerTrackingChecks.checkedAt);

  return {
    success: result.success,
    containerNumber: row.containerNumber,
    provider: finalProvider,
    lastStatus: result.lastStatus,
    lastLocation: result.lastLocation,
    lastDescription: result.lastDescription,
    lastCheckedAt: result.lastCheckedAt,
    oldEta,
    newEta,
    etaChanged: newEta !== oldEta,
    attempts: attemptRows,
    error: result.error,
  };
}

export async function trackDueFactoryContainers(): Promise<void> {
  console.log("[FactoryTracking] Starting auto-tracking run...");

  if (!anyProviderConfigured()) {
    console.log("[FactoryTracking] No tracking providers configured — skipping.");
    return;
  }

  let rows: Array<{
    id: number;
    containerNumber: string;
    status: string;
    trackingAutoUpdate: boolean;
    trackingLastCheckedAt: Date | null;
    trackingNextCheckAt: Date | null;
    destination: string | null;
    trackingCarrierHint: string | null;
  }>;

  try {
    rows = await db
      .select({
        id: factoryContainers.id,
        containerNumber: factoryContainers.containerNumber,
        status: factoryContainers.status,
        trackingAutoUpdate: factoryContainers.trackingAutoUpdate,
        trackingLastCheckedAt: factoryContainers.trackingLastCheckedAt,
        trackingNextCheckAt: factoryContainers.trackingNextCheckAt,
        destination: factoryContainers.destination,
        trackingCarrierHint: factoryContainers.trackingCarrierHint,
      })
      .from(factoryContainers)
      .where(
        and(
          eq(factoryContainers.trackingEnabled, true),
          activeStatusFilter,
        ),
      );
  } catch (err: any) {
    console.error("[FactoryTracking] Failed to fetch containers:", err?.message);
    return;
  }

  if (rows.length === 0) {
    console.log("[FactoryTracking] No active tracking-enabled factory containers.");
    return;
  }

  const now = Date.now();
  const MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

  const eligible = rows.filter((r) => {
    if (!r.trackingAutoUpdate) return false;
    if (!isValidContainerNumber(r.containerNumber)) return false;
    if (r.trackingNextCheckAt && r.trackingNextCheckAt.getTime() > now) return false;
    if (r.trackingLastCheckedAt && (now - r.trackingLastCheckedAt.getTime()) < MIN_INTERVAL_MS) return false;
    return true;
  });

  console.log(`[FactoryTracking] ${eligible.length} of ${rows.length} factory containers eligible for auto-tracking.`);

  for (const row of eligible) {
    try {
      const destCountry = row.destination || "Congo";
      const carrierHint = row.trackingCarrierHint ?? null;
      await trackOneContainer(row.id, row.containerNumber, destCountry, carrierHint);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (err: any) {
      console.error(`[FactoryTracking] Error tracking ${row.containerNumber}:`, err?.message);
    }
  }

  console.log("[FactoryTracking] Auto-tracking run complete.");
}

export async function updateFactoryContainerTrackingSettings(
  containerId: number,
  settings: { trackingEnabled?: boolean; trackingAutoUpdate?: boolean; trackingCarrierHint?: string | null },
): Promise<void> {
  await db
    .update(factoryContainers)
    .set(settings as any)
    .where(eq(factoryContainers.id, containerId));
}
