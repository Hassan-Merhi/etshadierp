/**
 * maerskPublicProvider.ts — Maersk public tracking (no credentials required).
 *
 * Always enabled — no env vars needed. Free HTTP-only (no browser / Puppeteer).
 *
 * Attempts Maersk's undocumented public JSON endpoint. If blocked by Akamai
 * (403/captcha), returns success=false immediately and the service falls back
 * to ParcelsApp. Never retries. Never crashes the server.
 *
 * Rate-limited: max 20 minutes per container (in-process).
 */

import type { CarrierTrackResult, TrackingEvent } from "./types";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const PUBLIC_BASE     = "https://www.maersk.com/api/tracking";
const PUBLIC_PAGE     = "https://www.maersk.com/tracking";
const TIMEOUT_MS      = 12_000;
const RATE_LIMIT_MS   = 20 * 60 * 1_000;   // 20 min (was 60 min)

const _lastAttempt = new Map<string, number>();

export function isEnabled(): boolean {
  return true;
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

  // ── Step 1: load tracking page to obtain session cookies ──────────────────
  // Akamai/DataDome requires a real session. We GET the public tracking page
  // first (cheap, HTML only) so the server sees a session cookie chain before
  // we call the JSON API.
  let sessionCookies = "";
  try {
    const pageRes = await fetch(`${PUBLIC_PAGE}/${encodeURIComponent(containerNumber)}`, {
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.9",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Upgrade-Insecure-Requests": "1",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow",
    });
    // Discard the body immediately — we only need the Set-Cookie headers.
    // Not consuming the body would hold the TCP connection open and leak memory.
    await pageRes.body?.cancel().catch(() => {});
    // Collect all Set-Cookie values as a single Cookie header string
    const raw = pageRes.headers.get("set-cookie") ?? "";
    sessionCookies = raw
      .split(/,(?=[^;]+?=)/)     // split multiple cookies (not expires commas)
      .map((c) => c.split(";")[0].trim())
      .filter(Boolean)
      .join("; ");
    console.log(`[MaerskPublic] ${containerNumber}: prefetch done — ${sessionCookies ? "cookies acquired" : "no cookies"}`);
  } catch {
    // Non-fatal — we still try the API without cookies
  }

  // ── Step 2: call the JSON API with the session cookies ────────────────────
  try {
    const url = `${PUBLIC_BASE}/${encodeURIComponent(containerNumber)}`;
    const res = await fetch(url, {
      headers: {
        "Accept": "application/json, */*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": BROWSER_UA,
        "Referer": `${PUBLIC_PAGE}/${encodeURIComponent(containerNumber)}`,
        "Origin": "https://www.maersk.com",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "Cache-Control": "no-cache",
        ...(sessionCookies ? { "Cookie": sessionCookies } : {}),
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

/**
 * Recursively search any JSON object for keys that explicitly mean ETA/estimated
 * arrival.  Used as a supplemental pass after the primary field-path extraction,
 * in case Maersk restructures their API response shape.
 * Returns the first valid YYYY-MM-DD string found, or null.
 */
const DEEP_ETA_KEY_RE =
  /^(eta|estimatedArrival|estimatedTimeOfArrival|plannedArrival|plannedArrivalDate|scheduledArrival|predictiveEstimatedArrival|latestEstimatedArrival|arrivalDate|vesselArrival|portArrival|destinationEstimatedArrival)$/i;

function deepScanForEta(obj: unknown, depth = 0): { path: string; value: string } | null {
  if (depth > 12 || !obj || typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const r = deepScanForEta(item, depth + 1);
      if (r) return r;
    }
    return null;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (DEEP_ETA_KEY_RE.test(k) && typeof v === "string" && v.trim()) {
      const d = new Date(v);
      if (!isNaN(d.getTime())) return { path: k, value: d.toISOString().slice(0, 10) };
    }
    if (v && typeof v === "object") {
      const r = deepScanForEta(v, depth + 1);
      if (r) return r;
    }
  }
  return null;
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

  // For portCalls, the destination is the last entry or the one flagged isDestination.
  // portCalls[0] is the ORIGIN — never use index 0 for ETA.
  const portCalls: any[] = Array.isArray(entry.portCalls) ? entry.portCalls : [];
  const destPortCall =
    portCalls.find((p: any) => p.isDestination === true || p.isDestination === "true") ??
    (portCalls.length > 0 ? portCalls[portCalls.length - 1] : null);

  // Destination port call fields have highest priority — they represent the
  // actual arrival ETA at the final destination, not a transit movement.
  const etaRaw =
    destPortCall?.eta ??
    destPortCall?.estimatedArrival ??
    destPortCall?.estimatedTimeOfArrival ??
    entry.portOfDischarge?.eta ??
    entry.portOfDischarge?.estimatedArrival ??
    entry.portOfDischarge?.estimatedTimeOfArrival ??
    entry.eta ??
    entry.estimatedTimeOfArrival ??
    entry.estimatedArrival ??
    entry.plannedArrivalDate ??
    entry.predictedETA ??
    entry.latestEstimatedArrival ??
    entry.scheduledArrival ??
    entry.legs?.[entry.legs?.length - 1]?.eta ??
    entry.legs?.[entry.legs?.length - 1]?.estimatedArrival ??
    entry.containers?.[0]?.eta ??
    d.eta ??
    d.estimatedTimeOfArrival ??
    null;
  const etaDate = parseDate(etaRaw);
  let eta = etaDate ? etaDate.toISOString().slice(0, 10) : null;

  // ── Supplemental: recursive deep-scan for any ETA key we may have missed ────
  // Runs only when the primary field-path chain found nothing, so it never
  // overrides an already-extracted ETA.
  let deepEtaPath: string | null = null;
  if (!eta) {
    const deepResult = deepScanForEta(data);
    if (deepResult) {
      eta = deepResult.value;
      deepEtaPath = deepResult.path;
      console.log(
        `[MaerskPublic] ${containerNumber}: ETA from deep-scan path=${deepResult.path} val=${deepResult.value}`,
      );
    }
  }

  if (!latest && !eta) {
    console.log(`[MaerskPublic] ${containerNumber}: response parseable but no useful data`);
    return { ...base, noData: true, error: "no_useful_data", raw: data };
  }

  console.log(
    `[MaerskPublic] ${containerNumber}: success — status=${latest?.status ?? "?"} events=${events.length}` +
    ` eta=${eta ?? "none"}${deepEtaPath ? ` (deep-scan path=${deepEtaPath})` : ""}`,
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
