import type { Express } from "express";
import { registerContainerFreightReadRoutes } from "./containerFreightReadRoutes";
import { registerContainerFreightWriteRoutes } from "./containerFreightWriteRoutes";

export function registerContainerFreightRoutes(app: Express) {
  registerContainerFreightReadRoutes(app);
  registerContainerFreightWriteRoutes(app);
}
