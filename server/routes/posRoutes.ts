import { type Express } from "express";
import { registerAllPosRoutes } from "./pos/index";

export function registerPosRoutes(app: Express): void {
  registerAllPosRoutes(app);
}
