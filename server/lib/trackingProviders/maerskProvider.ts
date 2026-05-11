/**
 * maerskProvider.ts — Maersk Line direct tracking via the free Maersk Developer API.
 *
 * Registration (free, no credit card):
 *   https://developer.maersk.com  →  sign up  →  create an app  →  subscribe to "Track & Trace"
 *
 * Required environment variables:
 *   MAERSK_CONSUMER_KEY     — Consumer Key from the developer portal
 *   MAERSK_CONSUMER_SECRET  — Consumer Secret from the developer portal
 *
 * If these are not set this provider returns { notConfigured: true } and the
 * tracking service falls back to ParcelsApp automatically.
 */

import type { CarrierTrackResult, TrackingEvent } from "./types";

const BASE = "https://api.maersk.com";
const TOKEN_URL = `${BASE}/oauth2/access_token`;

// In-memory OAuth2 token cache — tokens last 3600 s; we refresh 60 s early.
let _cachedToken: { value: string; expiresAt: number } | null = null;

export function isConfigured(): boolean {
  return !!(process.env.MAERSK_CONSUMER_KEY && process.env.MAERSK_CONSUMER_SECRET);
}

async function getAccessToken(): Promise<string> {
  if (_cachedToken && Date.now() < _cachedToken.expiresAt - 60_000) {
    return _cachedToken.value;
  }

  const key = process.env.MAERSK_CONSUMER_KEY!;
  const secret = process.env.MAERSK_CONSUMER_SECRET!;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Consumer-Key": key,
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: key,
      client_secret: secret,
    }).toString(),
    signal: AbortSignal.timeout(12_000),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Maersk OAuth failed ${res.status}: ${txt.slice(0, 200)}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in?: number };
  _cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return data.access_token;
}

/** Parse Maersk's DCSA-style event array into our normalized shape. */
function parseEvents(raw: unknown): TrackingEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e: any) => {
      const rawDate = e.eventDateTime ?? e.eventDate ?? e.date ?? null;
      let date: Date | null = null;
      if (rawDate) {
        const d = new Date(rawDate);
        if (!isNaN(d.getTime())) date = d;
      }
      const location =
        e.location?.locationName ??
        e.location?.UNLocationCode ??
        e.portName ??
        e.locationName ??
        null;
      const status =
        e.transportEventTypeCode ??
        e.eventCode ??
        e.status ??
        null;
      const description =
        e.description ??
        e.eventDescription ??
        null;
      return { date, status, location, description } as TrackingEvent;
    })
    .filter((e) => e.date || e.status);
}

/** Extract ETA from various places Maersk might put it. */
function parseEta(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, any>;

  const raw =
    d.eta ??
    d.estimatedArrival ??
    d.estimatedTimeOfArrival ??
    d.estimatedDelivery ??
    (Array.isArray(d.transportPlan) ? d.transportPlan?.[d.transportPlan.length - 1]?.plannedArrival : undefined) ??
    null;

  if (!raw) return null;
  const parsed = new Date(raw);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/** Track a container via the Maersk Track & Trace API. */
export async function track(containerNumber: string): Promise<CarrierTrackResult> {
  if (!isConfigured()) {
    return {
      success: false,
      provider: "maersk",
      carrier: "MAERSK",
      containerNumber,
      latestStatus: null,
      latestLocation: null,
      latestEventDate: null,
      latestDescription: null,
      eta: null,
      events: [],
      raw: null,
      notConfigured: true,
      error: "MAERSK_CONSUMER_KEY / MAERSK_CONSUMER_SECRET not configured",
    };
  }

  try {
    const token = await getAccessToken();
    const key = process.env.MAERSK_CONSUMER_KEY!;

    const url = `${BASE}/track/${encodeURIComponent(containerNumber)}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Consumer-Key": key,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Maersk track HTTP ${res.status}: ${txt.slice(0, 200)}`);
    }

    const raw = await res.json();

    // Response may be an array or object; normalise to a single tracking entry.
    const entry: any = Array.isArray(raw) ? raw[0] : raw;
    if (!entry) throw new Error("Maersk returned empty response");

    // Events may be directly on the entry or nested under containers[0].events
    const rawEvents: unknown =
      entry.events ??
      entry.containers?.[0]?.events ??
      entry.ContainerStatus?.[0]?.events ??
      [];

    const events = parseEvents(rawEvents);
    const latest = events[0] ?? null;

    // Status may be at top level or derived from latest event
    const latestStatus =
      entry.latestStatus ??
      entry.status ??
      entry.containers?.[0]?.status ??
      entry.ContainerStatus?.[0]?.Status ??
      latest?.status ??
      null;

    const latestLocation =
      entry.location?.locationName ??
      latest?.location ??
      null;

    const latestDescription =
      latest?.description ?? null;

    const latestEventDate = latest?.date ?? null;

    const eta = parseEta(entry) ?? parseEta(entry.containers?.[0]);

    return {
      success: true,
      provider: "maersk",
      carrier: "MAERSK",
      containerNumber,
      latestStatus,
      latestLocation,
      latestEventDate,
      latestDescription,
      eta,
      events,
      raw,
    };
  } catch (err: any) {
    // Invalidate cached token on auth errors so next attempt re-fetches
    if (err?.message?.includes("401") || err?.message?.includes("403")) {
      _cachedToken = null;
    }
    return {
      success: false,
      provider: "maersk",
      carrier: "MAERSK",
      containerNumber,
      latestStatus: null,
      latestLocation: null,
      latestEventDate: null,
      latestDescription: null,
      eta: null,
      events: [],
      raw: null,
      error: err?.message ?? "Unknown Maersk error",
    };
  }
}
