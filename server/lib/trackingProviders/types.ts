/**
 * types.ts — Shared interface for all carrier tracking providers.
 *
 * Every provider normalises its response into this shape so the tracking
 * service can treat them interchangeably and fall back cleanly.
 */

export interface TrackingEvent {
  date: Date | null;
  status: string | null;
  location: string | null;
  description: string | null;
}

export interface CarrierTrackResult {
  success: boolean;
  /** Canonical provider id: "maersk" | "cmacgm" | "parcelsapp" */
  provider: string;
  /** Detected/confirmed carrier name: "MAERSK" | "CMA" | null */
  carrier: string | null;
  containerNumber: string;
  latestStatus: string | null;
  latestLocation: string | null;
  latestEventDate: Date | null;
  latestDescription: string | null;
  /** ISO date YYYY-MM-DD or null */
  eta: string | null;
  events: TrackingEvent[];
  raw: unknown;
  error?: string;
  /** True when provider has no credentials configured — safe fallback, not a hard error */
  notConfigured?: boolean;
}
