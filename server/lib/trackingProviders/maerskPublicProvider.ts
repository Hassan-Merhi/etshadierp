/**
 * maerskPublicProvider.ts — Maersk public tracking (no credentials required).
 *
 * Enabled only when:
 *   PUBLIC_CARRIER_TRACKING_ENABLED=true
 *   MAERSK_PUBLIC_TRACKING_ENABLED=true
 *
 * Attempts Maersk's undocumented public JSON endpoint. If blocked by Akamai
 * (403/captcha), returns success=false immediately and the service falls back
 * to ParcelsApp. Never retries. Never crashes the server.
 *
 * Rate-limited: max 1 attempt per container per 60 minutes (in-process).
 */

import type { CarrierTrackResult, TrackingEvent } from "./types";

const PUBLIC_BASE = "https://www.maersk.com/api/tracking";
const TIMEOUT_MS = 10_000;
const RATE_LIMIT_MS = 60 * 60 * 1_000;

const _lastAttempt = new Map<string, number>();

export function isEnabled(): boolean {
  if (process.env.PUBLIC_CARRIER_TRACKING_ENABLED?.toLowerCase() !== "true") return false;
  return process.env.MAERSK_PUBLIC_TRACKING_ENABLED?.toLowerCase() === "true";
}

function isRateLimited(containerNumber: string): boolean {
  const last = _lastAttempt.get(containerNumber);
  return !!last && Date.now() - last < RATE_LIMIT_MS;
}

const emptyBase = (containerNumber: string): CarrierTrackResult => ({
  success: false,
  provider: "maersk_public",
  carrier: "MAERSK",
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
    return { ...base, notConfigured: true, error: "maersk_public_not_enabled" };
  }

  if (isRateLimited(containerNumber)) {
    console.log(`[MaerskPublic] ${containerNumber}: rate-limited — skipping`);
    return { ...base, error: "rate_limited" };
  }

  _lastAttempt.set(containerNumber, Date.now());

  try {
    const url = `${PUBLIC_BASE}/${encodeURIComponent(containerNumber)}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; container-tracking/1.0)",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow",
    });

    if (res.status === 403 || res.status === 401 || res.status === 429) {
      console.log(`[MaerskPublic] ${containerNumber}: blocked (HTTP ${res.status})`);
      return { ...base, blocked: true, error: `blocked_http_${res.status}` };
    }

    if (!res.ok) {
      console.log(`[MaerskPublic] ${containerNumber}: HTTP ${res.status}`);
      return { ...base, error: `http_${res.status}` };
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      const text = (await res.text()).slice(0, 300);
      const isChallenge = /captcha|datadome|challenge|cloudflare|bot/i.test(text);
      console.log(`[MaerskPublic] ${containerNumber}: non-JSON response${isChallenge ? " (bot challenge)" : ""}`);
      return { ...base, blocked: isChallenge, error: isChallenge ? "captcha_challenge" : "non_json_response" };
    }

    const data = await res.json();
    return parseResponse(containerNumber, data, base);
  } catch (err: any) {
    const isTimeout = err?.name === "TimeoutError" || err?.name === "AbortError";
    console.log(`[MaerskPublic] ${containerNumber}: ${isTimeout ? "timeout" : (err?.message ?? "error")}`);
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

  // Maersk may wrap in various shapes
  const entry: any =
    (Array.isArray(d) ? d[0] : null) ??
    d.containers?.[0] ??
    d.shipment ??
    d.trackingData ??
    d;

  if (!entry) return { ...base, noData: true, error: "no_entry" };

  const rawEvents: unknown[] =
    entry.events ??
    entry.containers?.[0]?.events ??
    entry.milestones ??
    d.events ??
    [];

  const events: TrackingEvent[] = (Array.isArray(rawEvents) ? rawEvents : [])
    .map((e: any): TrackingEvent => ({
      date: parseDate(e.eventDateTime ?? e.eventDate ?? e.timestamp ?? e.date ?? null),
      status: e.transportEventTypeCode ?? e.activityName ?? e.eventCode ?? e.status ?? null,
      location:
        e.location?.portName ??
        e.location?.locationName ??
        e.portName ??
        e.locationName ??
        (typeof e.location === "string" ? e.location : null),
      description: e.description ?? e.eventDescription ?? e.activityName ?? null,
    }))
    .filter((e) => e.date !== null || e.status !== null)
    .sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return b.date.getTime() - a.date.getTime();
    });

  const latest = events[0] ?? null;

  const etaRaw =
    entry.eta ??
    entry.estimatedTimeOfArrival ??
    entry.estimatedArrival ??
    entry.plannedArrivalDate ??
    d.eta ??
    null;
  const etaDate = parseDate(etaRaw);
  const eta = etaDate ? etaDate.toISOString().slice(0, 10) : null;

  if (!latest && !eta) {
    console.log(`[MaerskPublic] ${containerNumber}: response parseable but no useful data`);
    return { ...base, noData: true, error: "no_useful_data", raw: data };
  }

  console.log(
    `[MaerskPublic] ${containerNumber}: success — status=${latest?.status ?? "?"} events=${events.length}`,
  );

  return {
    ...base,
    success: true,
    latestStatus: latest?.status ?? entry.status ?? entry.latestStatus ?? null,
    latestLocation: latest?.location ?? null,
    latestEventDate: latest?.date ?? null,
    latestDescription: latest?.description ?? null,
    eta,
    events,
    raw: data,
  };
}
