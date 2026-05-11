/**
 * types.ts — Shared interface for all carrier tracking providers.
 *
 * Every provider (Maersk, CMA CGM, ParcelsApp) normalises its response
 * into this shape so the tracking service can treat them interchangeably.
 */

export interface TrackingEvent {
  date: Date | null;
  status: string | null;
  location: string | null;
  description: string | null;
}

export interface CarrierTrackResult {
  success: boolean;
  /** Canonical provider name: "maersk" | "cmacgm" | "parcelsapp" */
  provider: string;
  /** Detected carrier name: "MAERSK" | "CMA" | "MSC" | "AUTO" | null */
  carrier: string | null;
  containerNumber: string;
  latestStatus: string | null;
  latestLocation: string | null;
  latestEventDate: Date | null;
  latestDescription: string | null;
  /** ISO date string YYYY-MM-DD or null */
  eta: string | null;
  events: TrackingEvent[];
  raw: unknown;
  error?: string;
  /** True when the provider is not configured (missing credentials) */
  notConfigured?: boolean;
}
