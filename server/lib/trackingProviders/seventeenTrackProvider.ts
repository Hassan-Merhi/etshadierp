/**
 * seventeenTrackProvider.ts — 17track API v2.2 client.
 *
 * Requires SEVENTEENTRACK_API_KEY in environment.
 * Free tier: 100 trackings/month.
 * Configured limit: SEVENTEENTRACK_MONTHLY_LIMIT (default 100).
 *
 * Flow per container:
 *   1. POST /track/v2.2/register  — submit tracking number + carrier code
 *   2. Wait ~5 s for 17track to fetch fresh data from the carrier
 *   3. POST /track/v2.2/gettrackinfo — retrieve the result
 *
 * IMPORTANT: Ocean container prefixes (CMAU, CAAU, etc.) cannot be
 * auto-detected by 17track (carrier=0 returns "Carrier cannot be detected").
 * Always pass the explicit carrier code from CARRIER_CODES.
 */

import type { CarrierTrackResult, TrackingEvent } from "./types";

const BASE_URL = "https://api.17track.net/track/v2.2";

export function isConfigured(): boolean {
  return !!process.env.SEVENTEENTRACK_API_KEY;
}

export function getMonthlyLimit(): number {
  return Math.max(1, parseInt(process.env.SEVENTEENTRACK_MONTHLY_LIMIT ?? "100") || 100);
}

// ── Carrier codes (17track cannot auto-detect ocean container prefixes) ────────
export const CARRIER_CODES: Record<string, number> = {
  CMA: 100755, // CMA CGM (incl. ANL, APL, CNC subsidiaries)
};

// ── v2.2 response shapes ──────────────────────────────────────────────────────

interface T17Event {
  time_iso?: string;
  time_utc?: string;
  description?: string;
  location?: string;
  stage?: string | null;
  sub_status?: string;
}

interface T17TrackInfo {
  latest_status?: {
    status?: string;
    sub_status?: string;
  };
  latest_event?: {
    time_iso?: string;
    time_utc?: string;
    description?: string;
    location?: string;
  };
  time_metrics?: {
    estimated_delivery_date?: {
      from?: string | null;
      to?: string | null;
    };
  };
  tracking?: {
    providers?: Array<{
      events?: T17Event[];
    }>;
  };
}

interface T17Accepted {
  number: string;
  carrier?: number;
  track_info?: T17TrackInfo;
}

interface T17Rejected {
  number: string;
  error: { code: number; message: string };
}

interface T17Response {
  code: number;
  data?: {
    accepted?: T17Accepted[];
    rejected?: T17Rejected[];
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function emptyResult(containerNumber: string, extra: Partial<CarrierTrackResult>): CarrierTrackResult {
  return {
    success: false,
    provider: "17track",
    carrier: null,
    containerNumber,
    latestStatus: null,
    latestLocation: null,
    latestEventDate: null,
    latestDescription: null,
    eta: null,
    events: [],
    raw: null,
    ...extra,
  };
}

function apiHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "17token": process.env.SEVENTEENTRACK_API_KEY!,
  };
}

function parseIsoDate(iso?: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function track(containerNumber: string, carrierCode?: number): Promise<CarrierTrackResult> {
  if (!isConfigured()) {
    return emptyResult(containerNumber, {
      notConfigured: true,
      error: "SEVENTEENTRACK_API_KEY not configured",
    });
  }

  try {
    // Step 1: Register the tracking number.
    // Use explicit carrier code when provided — ocean container prefixes cannot
    // be auto-detected by 17track (carrier=0 fails with "Carrier cannot be detected").
    const effectiveCarrier = carrierCode ?? 0;
    const regRes = await fetch(`${BASE_URL}/register`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify([{ number: containerNumber, carrier: effectiveCarrier }]),
      signal: AbortSignal.timeout(15_000),
    });

    if (!regRes.ok) {
      throw new Error(`17track register HTTP ${regRes.status}`);
    }

    const regData = (await regRes.json()) as T17Response;

    // If rejected at register step, bail early
    const regRejected = regData.data?.rejected?.find((r) => r.number === containerNumber);
    if (regRejected) {
      return emptyResult(containerNumber, {
        raw: regData,
        noData: true,
        error: regRejected.error?.message ?? "Rejected at register step",
      });
    }

    // Wait for 17track to query the carrier
    await new Promise((r) => setTimeout(r, 5_000));

    // Step 2: Get tracking info
    const infoRes = await fetch(`${BASE_URL}/gettrackinfo`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify([{ number: containerNumber }]),
      signal: AbortSignal.timeout(15_000),
    });

    if (!infoRes.ok) {
      throw new Error(`17track gettrackinfo HTTP ${infoRes.status}`);
    }

    const data: T17Response = await infoRes.json();

    if (data.code !== 0) {
      throw new Error(`17track API error code ${data.code}`);
    }

    // Rejected → carrier doesn't know this number
    const rejected = data.data?.rejected?.find((r) => r.number === containerNumber);
    if (rejected) {
      return emptyResult(containerNumber, {
        raw: data,
        noData: true,
        error: rejected.error?.message ?? "Rejected by 17track",
      });
    }

    const accepted = data.data?.accepted?.find((a) => a.number === containerNumber);
    const trackInfo = accepted?.track_info;

    if (!accepted || !trackInfo) {
      return emptyResult(containerNumber, {
        raw: data,
        noData: true,
        error: "No tracking data returned by 17track",
      });
    }

    // ── Parse latest status & location from top-level fields ──────────────────
    const latestStatus = trackInfo.latest_status?.status ?? null;
    const latestLocation = trackInfo.latest_event?.location ?? null;
    const latestEventDate = parseIsoDate(trackInfo.latest_event?.time_iso ?? trackInfo.latest_event?.time_utc);
    const latestDescription = trackInfo.latest_event?.description ?? null;

    // ── Parse full events list from tracking.providers[0].events ─────────────
    const rawEvents: T17Event[] = trackInfo.tracking?.providers?.[0]?.events ?? [];
    const events: TrackingEvent[] = rawEvents.map((ev) => ({
      date: parseIsoDate(ev.time_iso ?? ev.time_utc),
      status: ev.sub_status ?? ev.stage ?? null,
      location: ev.location ?? null,
      description: ev.description ?? null,
    }));

    // ── Parse ETA from time_metrics.estimated_delivery_date ──────────────────
    let eta: string | null = null;
    const edFrom = trackInfo.time_metrics?.estimated_delivery_date?.from;
    const edTo = trackInfo.time_metrics?.estimated_delivery_date?.to;
    const edRaw = edTo ?? edFrom;
    if (edRaw) {
      const d = new Date(edRaw);
      if (!isNaN(d.getTime())) eta = d.toISOString().slice(0, 10);
    }

    // If no explicit ETA, fall back to the arrival milestone date
    if (!eta && latestEventDate && latestStatus?.toLowerCase().includes("delivered")) {
      // Container already delivered — use latest event date as ETA
      eta = latestEventDate.toISOString().slice(0, 10);
    }

    return {
      success: true,
      provider: "17track",
      carrier: null,
      containerNumber,
      latestStatus,
      latestLocation,
      latestEventDate,
      latestDescription,
      eta,
      events,
      raw: data,
    };
  } catch (err: any) {
    return emptyResult(containerNumber, {
      error: err?.message ?? "Unknown error",
    });
  }
}
