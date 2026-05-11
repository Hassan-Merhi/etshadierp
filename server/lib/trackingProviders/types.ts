/**
 * types.ts — Shared interface for all carrier tracking providers.
 *
 * Every provider normalises its response into this shape so the tracking
 * service can treat them interchangeably and fall back cleanly.
 *
 * Provider ids in use:
 *   "maersk"        — Maersk official OAuth2 API
 *   "maersk_public" — Maersk public webpage (no credentials)
 *   "cma_public"    — CMA CGM public webpage (no credentials)
 *   "parcelsapp"    — ParcelsApp multi-carrier fallback
 */

export interface TrackingEvent {
  date: Date | null;
  status: string | null;
  location: string | null;
  description: string | null;
}

export interface CarrierTrackResult {
  success: boolean;
  /** Canonical provider id */
  provider: string;
  /** Detected/confirmed carrier name */
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
  /** Provider not configured — safe fallback, not a hard error */
  notConfigured?: boolean;
  /** Provider was blocked by bot protection (Akamai, DataDome, Cloudflare) */
  blocked?: boolean;
  /** Provider responded but returned no useful tracking data */
  noData?: boolean;
}
