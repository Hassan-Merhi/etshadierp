/**
 * cmaCgmApiProvider.ts — CMA CGM Official DCSA Track & Trace v2.2.0 API
 *
 * Uses CMA CGM's official API portal (api-portal.cma-cgm.com).
 * Endpoint: GET https://apis.cma-cgm.net/operation/trackandtrace/v1/events
 * Auth: keyId header (API key from portal subscription)
 *
 * Requires env var: CMA_CGM_API_KEY
 *
 * Returns full voyage events including planned vessel arrival (ETA) at POD.
 */

import type { CarrierTrackResult, TrackingEvent } from "./types";

const BASE_URL = "https://apis.cma-cgm.net/operation/trackandtrace/v1/events";
const TIMEOUT_MS = 15_000;
const AUTH_FAILURE_COOLDOWN_MS = 15 * 60 * 1000;

let authFailureCooldownUntil = 0;
let lastAuthFailureStatus: 401 | 403 | null = null;

export function isConfigured(): boolean {
  return !!process.env.CMA_CGM_API_KEY;
}

const emptyBase = (containerNumber: string): CarrierTrackResult => ({
  success: false,
  provider: "cma_cgm_api",
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

function parseDate(raw: unknown): Date | null {
  if (!raw || typeof raw !== "string") return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

/** DCSA event shape from CMA CGM API */
interface DcsaEvent {
  eventType: "TRANSPORT" | "EQUIPMENT" | "SHIPMENT";
  eventID: string;
  eventCreatedDateTime: string;
  eventClassifierCode: "ACT" | "PLN" | "EST";
  eventDateTime: string;
  transportEventTypeCode?: "ARRI" | "DEPA";
  equipmentEventTypeCode?: string;
  carrierSpecificData?: {
    internalEventLabel?: string;
    shipmentLocationType?: string; // "POD", "POL", "PTS"
  };
  transportCall?: {
    location?: {
      locationName?: string;
      UNLocationCode?: string;
    };
    vessel?: {
      vesselName?: string;
    };
    exportVoyageNumber?: string;
    importVoyageNumber?: string;
  };
  equipmentReference?: string;
  references?: Array<{ referenceType: string; referenceValue: string }>;
}

export async function track(containerNumber: string): Promise<CarrierTrackResult> {
  const base = emptyBase(containerNumber);
  const apiKey = process.env.CMA_CGM_API_KEY;

  if (!apiKey) {
    return { ...base, notConfigured: true, error: "CMA_CGM_API_KEY not set" };
  }

  if (Date.now() < authFailureCooldownUntil) {
    const status = lastAuthFailureStatus ?? 403;
    console.warn(
      `[CmaCgmApi] ${containerNumber}: skipped during auth cooldown after HTTP ${status}`
    );
    return { ...base, blocked: true, error: `auth_${status}_cooldown` };
  }

  try {
    const url = `${BASE_URL}?equipmentReference=${encodeURIComponent(containerNumber)}`;
    console.log(`[CmaCgmApi] ${containerNumber}: calling official DCSA API...`);

    const res = await fetch(url, {
      headers: {
        keyId: apiKey,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.status === 401 || res.status === 403) {
      lastAuthFailureStatus = res.status;
      authFailureCooldownUntil = Date.now() + AUTH_FAILURE_COOLDOWN_MS;
      console.warn(
        `[CmaCgmApi] ${containerNumber}: authentication rejected (HTTP ${res.status}); pausing CMA API calls for 15 minutes`
      );
      return { ...base, blocked: true, error: `auth_${res.status}` };
    }

    if (res.status === 404) {
      console.log(`[CmaCgmApi] ${containerNumber}: not found (HTTP 404)`);
      return { ...base, noData: true, error: "not_found" };
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.log(`[CmaCgmApi] ${containerNumber}: HTTP ${res.status} — ${body.slice(0, 200)}`);
      return { ...base, error: `http_${res.status}` };
    }

    authFailureCooldownUntil = 0;
    lastAuthFailureStatus = null;

    const rawEvents: DcsaEvent[] = await res.json();

    if (!Array.isArray(rawEvents) || rawEvents.length === 0) {
      console.log(`[CmaCgmApi] ${containerNumber}: empty response`);
      return { ...base, noData: true, error: "no_events" };
    }

    return parseEvents(containerNumber, rawEvents, base);
  } catch (err: any) {
    const isTimeout = err?.name === "TimeoutError" || err?.name === "AbortError";
    console.log(`[CmaCgmApi] ${containerNumber}: ${isTimeout ? "timeout" : (err?.message ?? "error")}`);
    return { ...base, error: isTimeout ? "timeout" : (err?.message ?? "unknown_error") };
  }
}

function parseEvents(containerNumber: string, rawEvents: DcsaEvent[], base: CarrierTrackResult): CarrierTrackResult {
  // Extract ETA: PLN ARRI event at POD (shipmentLocationType === "POD")
  let eta: string | null = null;
  for (const ev of rawEvents) {
    if (
      ev.eventType === "TRANSPORT" &&
      ev.eventClassifierCode === "PLN" &&
      ev.transportEventTypeCode === "ARRI" &&
      ev.carrierSpecificData?.shipmentLocationType === "POD" &&
      ev.eventDateTime
    ) {
      const d = parseDate(ev.eventDateTime);
      if (d) {
        eta = d.toISOString().slice(0, 10);
        console.log(
          `[CmaCgmApi] ${containerNumber}: ETA from POD arrival = ${eta} (${ev.transportCall?.location?.locationName ?? "?"})`
        );
        break;
      }
    }
  }

  // Build normalised event list
  const events: TrackingEvent[] = rawEvents
    .map(
      (ev): TrackingEvent => ({
        date: parseDate(ev.eventDateTime),
        status:
          ev.carrierSpecificData?.internalEventLabel ??
          ev.transportEventTypeCode ??
          ev.equipmentEventTypeCode ??
          ev.eventType,
        location: ev.transportCall?.location?.locationName ?? ev.transportCall?.location?.UNLocationCode ?? null,
        description: ev.carrierSpecificData?.internalEventLabel ?? null,
      })
    )
    .filter((e) => e.date !== null)
    .sort((a, b) => b.date!.getTime() - a.date!.getTime());

  // Latest ACTUAL (ACT) event = most recent confirmed movement
  const latestAct = rawEvents
    .filter((ev) => ev.eventClassifierCode === "ACT" && ev.eventDateTime)
    .sort((a, b) => new Date(b.eventDateTime).getTime() - new Date(a.eventDateTime).getTime())[0];

  const latestStatus =
    latestAct?.carrierSpecificData?.internalEventLabel ??
    latestAct?.transportEventTypeCode ??
    latestAct?.equipmentEventTypeCode ??
    events[0]?.status ??
    null;

  const latestLocation = latestAct?.transportCall?.location?.locationName ?? events[0]?.location ?? null;

  const latestEventDate = latestAct ? parseDate(latestAct.eventDateTime) : (events[0]?.date ?? null);

  const vesselName = latestAct?.transportCall?.vessel?.vesselName ?? null;
  const voyage = latestAct?.transportCall?.exportVoyageNumber ?? latestAct?.transportCall?.importVoyageNumber ?? null;

  const latestDescription =
    [latestStatus, vesselName, voyage ? `voyage ${voyage}` : null].filter(Boolean).join(", ") || null;

  console.log(
    `[CmaCgmApi] ${containerNumber}: success — status="${latestStatus}" eta=${eta ?? "none"} events=${rawEvents.length}`
  );

  return {
    ...base,
    success: true,
    latestStatus,
    latestLocation,
    latestEventDate,
    latestDescription,
    eta,
    events,
    raw: rawEvents,
  };
}
