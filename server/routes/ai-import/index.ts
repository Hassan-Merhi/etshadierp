/**
 * aiImportRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerAiImportJobRoutes } from "./jobs";
import { registerAiImportConfirmRoutes } from "./confirm";
import { registerAiImportCorrectionRoutes } from "./corrections";
import { registerAiImportPostRoutes } from "./post";

export function registerAiImportRoutes(app: Express) {
  registerAiImportJobRoutes(app);
  registerAiImportConfirmRoutes(app);
  registerAiImportCorrectionRoutes(app);
  registerAiImportPostRoutes(app);
}
