/**
 * chatbotRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerChatbotStatusRoutes } from "./status";
import { registerChatbotMessageRoutes } from "./messages";
import { registerChatbotAlertRoutes } from "./alerts";
import { registerChatbotTransactionRoutes } from "./transactions";
import { registerChatbotPatchRoutes } from "./patches";
import { registerChatbotGithubSettingsRoutes } from "./github-settings";

export function registerChatbotRoutes(app: Express) {
  registerChatbotStatusRoutes(app);
  registerChatbotMessageRoutes(app);
  registerChatbotAlertRoutes(app);
  registerChatbotTransactionRoutes(app);
  registerChatbotPatchRoutes(app);
  registerChatbotGithubSettingsRoutes(app);
}
