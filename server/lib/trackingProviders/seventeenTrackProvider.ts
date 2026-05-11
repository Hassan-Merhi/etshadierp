/**
 * seventeenTrackProvider.ts — 17track API v2.2 client.
 *
 * Requires SEVENTEENTRACK_API_KEY in environment.
 * Free tier: 100 trackings/month (each register + gettrackinfo pair = 1 credit).
 * Configured limit: SEVENTEENTRACK_MONTHLY_LIMIT (default 100).
 *
 * Flow per container:
 *   1. POST /track/v2.2/register  — submit the tracking number
 *   2. Wait ~5 s for 17track to fetch fresh data
 *   3. POST /track/v2.2/gettrackinfo — retrieve the result
 */

import type { CarrierTrackResult, TrackingEvent } from "./types";

const BASE_URL = "https://api.17track.net/track/v2.2";

export function isConfigured(): boolean {
  return !!process.env.SEVENTEENTRACK_API_KEY;
}

export function getMonthlyLimit(): number {
  return Math.max(1, parseInt(process.env.SEVENTEENTRACK_MONTHLY_LIMIT ?? "100") || 100);
}

// ── Raw 17track shapes (subset we actually use) ───────────────────────────────

interface T17Event {
  a?: string; // status text
  l?: string; // location
  d?: string; // description
  z?: string; // ISO datetime
}

interface T17Track {
  b?: string;       // latest carrier status
  z?: string;       // current location
  y?: T17Event[];   // event list (newest first)
  w?: string;       // estimated delivery date
}

interface T17Accepted {
  number: string;
  track: T17Track;
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

function emptyResult(
  containerNumber: string,
  extra: Partial<CarrierTrackResult>,
): CarrierTrackResult {
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

// ── Public API ────────────────────────────────────────────────────────────────

export async function track(containerNumber: string): Promise<CarrierTrackResult> {
  if (!isConfigured()) {
    return emptyResult(containerNumber, {
      notConfigured: true,
      error: "SEVENTEENTRACK_API_KEY not configured",
    });
  }

  try {
    // Step 1: Register the tracking number (carrier=0 → auto-detect)
    const regRes = await fetch(`${BASE_URL}/register`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify([{ number: containerNumber, carrier: 0 }]),
      signal: AbortSignal.timeout(15_000),
    });

    if (!regRes.ok) {
      throw new Error(`17track register HTTP ${regRes.status}`);
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
    if (!accepted?.track) {
      return emptyResult(containerNumber, {
        raw: data,
        noData: true,
        error: "No tracking data returned by 17track",
      });
    }

    const t = accepted.track;
    const rawEvents: T17Event[] = t.y ?? [];

    const events: TrackingEvent[] = rawEvents.map((ev) => {
      const d = ev.z ? new Date(ev.z) : null;
      return {
        date: d && !isNaN(d.getTime()) ? d : null,
        status: ev.a ?? null,
        location: ev.l ?? null,
        description: ev.d ?? null,
      };
    });

    const latestEvent = events[0] ?? null;
    const latestStatus      = t.b ?? latestEvent?.status ?? null;
    const latestLocation    = t.z ?? latestEvent?.location ?? null;
    const latestEventDate   = latestEvent?.date ?? null;
    const latestDescription = latestEvent?.description ?? null;

    let eta: string | null = null;
    if (t.w) {
      const d = new Date(t.w);
      if (!isNaN(d.getTime())) eta = d.toISOString().slice(0, 10);
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
