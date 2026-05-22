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
  _destinationCountry?: string,
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

  return await trackViaParcelsApp(containerId, containerNumber, detectedCarrier, lastDirectFallbackReason, now, currentEta);
}

async function trackViaParcelsApp(
  containerId: number,
  containerNumber: string,
  detectedCarrier: string | null,
  fallbackReason: string | null,
  now: Date,
  currentEta: string | null,
): Promise<{
  success: boolean;
  lastStatus: string | null;
  lastLocation: string | null;
  lastDescription: string | null;
  lastCheckedAt: Date;
  error: string | null;
}> {
  initProgress(containerId);

  // ── HTTP scraper ──────────────────────────────────────────────────────────
  if (isHttpScraperAvailable()) {
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

  const quotaOk = await checkParcelsAppQuota();
  if (!quotaOk) {
    const quotaError = "ParcelsApp API quota used — all providers exhausted";
    await saveTrackingCheck(containerId, "skipped", "skipped_quota", quotaError, null);
    await db
      .update(factoryContainers)
      .set({ trackingLastCheckedAt: now, trackingError: quotaError } as any)
      .where(eq(factoryContainers.id, containerId));
    return { success: false, lastStatus: null, lastLocation: null, lastDescription: null, lastCheckedAt: now, error: quotaError };
  }

  ep(containerId, "ParcelsApp API", "running");
  const hintCarrier = detectedCarrier && detectedCarrier !== "OTHER" ? detectedCarrier : undefined;
  const result = await trackContainer(containerNumber, "United States", hintCarrier);

  await saveTrackingCheck(
    containerId, "parcelsapp",
    result.success ? "success" : result.timedOut ? "timeout" : "error",
    result.error ?? null, result.rawResponse,
  );

  if (!result.success || !result.shipment) {
    ep(containerId, "ParcelsApp API", "fail", result.error ?? "no data");
    await db
      .update(factoryContainers)
      .set({ trackingLastCheckedAt: now, trackingError: result.error ?? "Tracking failed", trackingProvider: "parcelsapp" } as any)
      .where(eq(factoryContainers.id, containerId));
    return { success: false, lastStatus: null, lastLocation: null, lastDescription: null, lastCheckedAt: now, error: result.error ?? "Tracking failed" };
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

  const result = await trackOneContainer(row.id, row.containerNumber);
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
      await trackOneContainer(row.id, row.containerNumber);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (err: any) {
      console.error(`[FactoryTracking] Error tracking ${row.containerNumber}:`, err?.message);
    }
  }

  console.log("[FactoryTracking] Auto-tracking run complete.");
}

export async function updateFactoryContainerTrackingSettings(
  containerId: number,
  settings: { trackingEnabled?: boolean; trackingAutoUpdate?: boolean },
): Promise<void> {
  await db
    .update(factoryContainers)
    .set(settings as any)
    .where(eq(factoryContainers.id, containerId));
}
