import type { Express } from "express";

export type RouteRegistrar = (app: Express) => void | Promise<void>;

export interface RouteModuleDefinition {
  readonly name: string;
  readonly register: RouteRegistrar;
}

export async function registerRouteModules(
  app: Express,
  modules: readonly RouteModuleDefinition[],
): Promise<void> {
  for (const module of modules) {
    await module.register(app);
  }
}
