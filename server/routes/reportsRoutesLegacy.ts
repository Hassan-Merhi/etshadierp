import type { Express } from "express";

/**
 * Phase 2 compatibility boundary.
 *
 * All report handlers have moved into focused route modules registered by
 * reportsRoutes.ts. This registrar intentionally remains as a no-op until the
 * final legacy-registry removal phase, so imports stay stable for stacked work.
 */
export function registerReportsRoutes(_app: Express) {}
