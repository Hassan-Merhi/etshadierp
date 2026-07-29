import type { Express } from "express";

/**
 * Phase 2 compatibility boundary.
 * All report handlers now live in focused modules registered by reportsRoutes.ts.
 * This no-op remains only until the final legacy-registry removal phase.
 */
export function registerReportsRoutes(_app: Express) {}
