/**
 * cmaPublicProvider.ts — CMA CGM public tracking (no credentials required).
 *
 * Enabled only when:
 *   PUBLIC_CARRIER_TRACKING_ENABLED=true
 *   CMA_PUBLIC_TRACKING_ENABLED=true
 *
 * Attempts CMA CGM's undocumented public JSON endpoint. If blocked by
 * DataDome (403/captcha), returns success=false immediately and the service
 * falls back to ParcelsApp. Never retries. Never crashes the server.
 *
 * Rate-limited: max 1 attempt per container per 60 minutes (in-process).
 */

import type { CarrierTrackResult, TrackingEvent } from "./types";

const PUBLIC_BASE = "https://www.cma-cgm.com/ebusiness/tracking/json";
const TIMEOUT_MS = 10_000;
const RATE_LIMIT_MS = 60 * 60 * 1_000;

const _lastAttempt = new Map<string, number>();

export function isEnabled(): boolean {
  if (process.env.PUBLIC_CARRIER_TRACKING_ENABLED?.toLowerCase() !== "true") return false;
  return process.env.CMA_PUBLIC_TRACKING_ENABLED?.toLowerCase() === "true";
}

function isRateLimited(containerNumber: string): boolean {
  const last = _lastAttempt.get(containerNumber);
  return !!last && Date.now() - last < RATE_LIMIT_MS;
}

const emptyBase = (containerNumber: string): CarrierTrackResult => ({
  success: false,
  provider: "cma_public",
  carrier: "CMA",
  containerNumber,
  latestStatus: null,
  latestLocation: null,
  latestEventDate: null,
  latestDescription: null,
  eta: null,
  events: [],
  raw: null,
});

export async function track(containerNumber: string): Promise<CarrierTrackResult> {
  const base = emptyBase(containerNumber);

  if (!isEnabled()) {
    return { ...base, notConfigured: true, error: "cma_public_not_enabled" };
  }

  if (isRateLimited(containerNumber)) {
    console.log(`[CMAPublic] ${containerNumber}: rate-limited — skipping`);
    return { ...base, error: "rate_limited" };
  }

  _lastAttempt.set(containerNumber, Date.now());

  try {
    const url = `${PUBLIC_BASE}/${encodeURIComponent(containerNumber)}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json, text/javascript, */*",
        "User-Agent": "Mozilla/5.0 (compatible; container-tracking/1.0)",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow",
    });

    if (res.status === 403 || res.status === 401 || res.status === 429) {
      console.log(`[CMAPublic] ${containerNumber}: blocked (HTTP ${res.status})`);
      return { ...base, blocked: true, error: `blocked_http_${res.status}` };
    }

    if (!res.ok) {
      console.log(`[CMAPublic] ${containerNumber}: HTTP ${res.status}`);
      return { ...base, error: `http_${res.status}` };
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json") && !contentType.includes("text/javascript")) {
      const text = (await res.text()).slice(0, 300);
      const isChallenge = /captcha|datadome|challenge|cloudflare|bot/i.test(text);
      console.log(`[CMAPublic] ${containerNumber}: non-JSON response${isChallenge ? " (bot challenge)" : ""}`);
      return { ...base, blocked: isChallenge, error: isChallenge ? "captcha_challenge" : "non_json_response" };
    }

    const data = await res.json();
    return parseResponse(containerNumber, data, base);
  } catch (err: any) {
    const isTimeout = err?.name === "TimeoutError" || err?.name === "AbortError";
    console.log(`[CMAPublic] ${containerNumber}: ${isTimeout ? "timeout" : (err?.message ?? "error")}`);
    return { ...base, error: isTimeout ? "timeout" : (err?.message ?? "unknown_error") };
  }
}

function parseDate(raw: unknown): Date | null {
  if (!raw || typeof raw !== "string") return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function parseResponse(
  containerNumber: string,
  data: unknown,
  base: CarrierTrackResult,
): CarrierTrackResult {
  if (!data || typeof data !== "object") {
    return { ...base, noData: true, error: "empty_response" };
  }

  const d = data as Record<string, any>;

  // CMA response shapes vary — be defensive
  const shipment: any =
    d.shipment ??
    d.tracking ??
    (Array.isArray(d.shipments) ? d.shipments[0] : null) ??
    (Array.isArray(d) ? d[0] : null) ??
    d;

  const rawEvents: unknown[] =
    shipment?.events ??
    shipment?.milestones ??
    shipment?.containerEvents ??
    d.events ??
    [];

  const events: TrackingEvent[] = (Array.isArray(rawEvents) ? rawEvents : [])
    .map((e: any): TrackingEvent => ({
      date: parseDate(e.eventDateTime ?? e.actualDate ?? e.timestamp ?? e.date ?? null),
      status: e.typeCode ?? e.eventCode ?? e.activityCode ?? e.status ?? null,
      location:
        e.location?.portName ??
        e.locationName ??
        e.portName ??
        (typeof e.location === "string" ? e.location : null),
      description: e.description ?? e.eventCode ?? e.typeCode ?? null,
    }))
    .filter((e) => e.date !== null || e.status !== null)
    .sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return b.date.getTime() - a.date.getTime();
    });

  const latest = events[0] ?? null;

  const etaRaw =
    shipment?.estimatedTimeOfArrival ??
    shipment?.eta ??
    shipment?.predictedETA ??
    shipment?.estimatedArrivalDate ??
    d.eta ??
    null;
  const etaDate = parseDate(etaRaw);
  const eta = etaDate ? etaDate.toISOString().slice(0, 10) : null;

  if (!latest && !eta) {
    console.log(`[CMAPublic] ${containerNumber}: response parseable but no useful data`);
    return { ...base, noData: true, error: "no_useful_data", raw: data };
  }

  console.log(
    `[CMAPublic] ${containerNumber}: success — status=${latest?.status ?? "?"} events=${events.length}`,
  );

  return {
    ...base,
    success: true,
    latestStatus: latest?.status ?? shipment?.statusCode ?? shipment?.status ?? null,
    latestLocation: latest?.location ?? null,
    latestEventDate: latest?.date ?? null,
    latestDescription: latest?.description ?? null,
    eta,
    events,
    raw: data,
  };
}
