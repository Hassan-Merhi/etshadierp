/**
 * parcelsAppClient.ts — ParcelsApp v3 API client.
 *
 * Two-step async flow:
 *  1. POST /api/v3/shipments/tracking  →  { uuid, done, shipments[], fromCache }
 *  2. GET  /api/v3/shipments/tracking?uuid=&apiKey=  (poll until done)
 *
 * API key must be set in process.env.PARCELSAPP_API_KEY.
 * Never log or expose the key to the frontend.
 */

const BASE_URL =
  process.env.PARCELSAPP_API_BASE_URL ||
  "https://parcelsapp.com/api/v3";

const POLL_INTERVAL_MS = 5_000;
const POLL_MAX_ATTEMPTS = 12; // 60 seconds max

export interface ParcelsAppEvent {
  date: string | null;
  status: string | null;
  location: string | null;
  description: string | null;
}

export interface ParcelsAppShipment {
  trackingId: string;
  done: boolean;
  fromCache?: boolean;
  attributes?: {
    status?: string;
    location?: string;
    description?: string;
    weight?: string;
    origin?: string;
    destination?: string;
    estimatedDeliveryDate?: string;
  };
  states?: Array<{
    date: string;
    status: string;
    location?: string;
    description?: string;
  }>;
  error?: string;
}

export interface ParcelsAppResult {
  done: boolean;
  uuid: string;
  fromCache: boolean;
  shipments: ParcelsAppShipment[];
  rawResponse: unknown;
}

export interface ParcelsAppTrackResult {
  success: boolean;
  shipment: ParcelsAppShipment | null;
  rawResponse: unknown;
  error?: string;
  timedOut?: boolean;
}

function getApiKey(): string | null {
  return process.env.PARCELSAPP_API_KEY || null;
}

/**
 * Initiates a tracking request. Returns UUID + any cached results.
 */
async function initiateTracking(
  trackingId: string,
  destinationCountry = "United States",
): Promise<{ uuid: string; done: boolean; shipments: ParcelsAppShipment[]; fromCache: boolean }> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("PARCELSAPP_API_KEY is not configured");

  const body = {
    shipments: [{ trackingId, destinationCountry }],
    language: "en",
    apiKey,
  };

  const res = await fetch(`${BASE_URL}/shipments/tracking`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`ParcelsApp POST failed: ${res.status} ${txt.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    uuid?: string;
    done?: boolean;
    shipments?: ParcelsAppShipment[];
    fromCache?: boolean;
  };

  if (!data.uuid) throw new Error("ParcelsApp POST: no uuid in response");

  return {
    uuid: data.uuid,
    done: data.done ?? false,
    shipments: data.shipments ?? [],
    fromCache: data.fromCache ?? false,
  };
}

/**
 * Polls for a tracking result by UUID. Returns when done or times out.
 */
async function pollTracking(
  uuid: string,
): Promise<{ done: boolean; shipments: ParcelsAppShipment[] }> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("PARCELSAPP_API_KEY is not configured");

  const url = `${BASE_URL}/shipments/tracking?uuid=${encodeURIComponent(uuid)}&apiKey=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`ParcelsApp GET failed: ${res.status} ${txt.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    done?: boolean;
    shipments?: ParcelsAppShipment[];
  };

  return {
    done: data.done ?? false,
    shipments: data.shipments ?? [],
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Full track-and-poll flow for a single container number.
 * Initiates, then polls up to POLL_MAX_ATTEMPTS×POLL_INTERVAL_MS.
 */
export async function trackContainer(
  containerNumber: string,
  destinationCountry = "United States",
): Promise<ParcelsAppTrackResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      success: false,
      shipment: null,
      rawResponse: null,
      error: "PARCELSAPP_API_KEY is not configured",
    };
  }

  let rawResponse: unknown = null;

  try {
    const initiated = await initiateTracking(containerNumber, destinationCountry);
    rawResponse = initiated;

    if (initiated.done) {
      const shipment = initiated.shipments.find(
        (s) => s.trackingId === containerNumber,
      ) ?? initiated.shipments[0] ?? null;
      return {
        success: true,
        shipment,
        rawResponse: initiated,
        timedOut: false,
      };
    }

    // Poll until done
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS);
      try {
        const polled = await pollTracking(initiated.uuid);
        rawResponse = polled;

        if (polled.done) {
          const shipment = polled.shipments.find(
            (s) => s.trackingId === containerNumber,
          ) ?? polled.shipments[0] ?? null;
          return {
            success: true,
            shipment,
            rawResponse: polled,
            timedOut: false,
          };
        }
      } catch (pollErr: any) {
        console.warn(`[ParcelsApp] Poll attempt ${attempt + 1} error: ${pollErr?.message}`);
      }
    }

    return {
      success: false,
      shipment: null,
      rawResponse,
      error: "Tracking request timed out after polling",
      timedOut: true,
    };
  } catch (err: any) {
    return {
      success: false,
      shipment: null,
      rawResponse,
      error: err?.message ?? "Unknown error",
    };
  }
}

/**
 * Normalises the raw states array from a ParcelsApp shipment into our event shape.
 */
export function normaliseEvents(shipment: ParcelsAppShipment): ParcelsAppEvent[] {
  if (!shipment.states?.length) return [];
  return shipment.states.map((s) => ({
    date: s.date ?? null,
    status: s.status ?? null,
    location: s.location ?? null,
    description: s.description ?? null,
  }));
}

/**
 * Derives a simple last-known status string from the shipment attributes or latest state.
 */
export function deriveLastStatus(shipment: ParcelsAppShipment): string | null {
  return (
    shipment.attributes?.status ??
    shipment.states?.[0]?.status ??
    null
  );
}

/**
 * Derives a simple last-known location string from the shipment attributes or latest state.
 */
export function deriveLastLocation(shipment: ParcelsAppShipment): string | null {
  return (
    shipment.attributes?.location ??
    shipment.states?.[0]?.location ??
    null
  );
}

/**
 * Derives the latest event date from the first state.
 */
export function deriveLastEventDate(shipment: ParcelsAppShipment): Date | null {
  const raw = shipment.states?.[0]?.date;
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Derives the estimated delivery date from shipment attributes.
 * Returns an ISO date string (YYYY-MM-DD) or null if not available.
 */
export function deriveEstimatedDeliveryDate(shipment: ParcelsAppShipment): string | null {
  const raw = shipment.attributes?.estimatedDeliveryDate;
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Tests the API key by calling the account endpoint.
 * Returns { ok, plan, limit, current } or { ok: false, error }.
 */
export async function testConnection(): Promise<{
  ok: boolean;
  plan?: string;
  limit?: number;
  current?: number;
  resetDate?: string;
  error?: string;
}> {
  const apiKey = getApiKey();
  if (!apiKey) return { ok: false, error: "PARCELSAPP_API_KEY is not configured" };

  try {
    const res = await fetch(
      `${BASE_URL}/account?apiKey=${encodeURIComponent(apiKey)}`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as {
      plan?: string;
      limit?: number;
      current?: number;
      resetDate?: string;
    };
    return {
      ok: true,
      plan: data.plan,
      limit: data.limit,
      current: data.current,
      resetDate: data.resetDate,
    };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Unknown error" };
  }
}
