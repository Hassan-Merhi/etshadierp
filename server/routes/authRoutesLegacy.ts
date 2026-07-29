import type { Express } from "express";

/**
 * Phase 3 compatibility boundary.
 *
 * All authentication and access-control endpoints now live in focused modules
 * composed by authRoutes.ts. Keep this no-op registrar temporarily so stacked
 * branches importing the historical symbol continue to compile.
 */
export function registerAuthRoutes(_app: Express) {}
