export const BACKEND_LAYER_RULES = {
  compositionRoot: "Own route registration order and server wiring only.",
  routes: "Own middleware, HTTP parsing, status codes, and response serialization.",
  services: "Own reusable validation, orchestration, and domain processing.",
  storage: "Own database and in-memory persistence access.",
  requestInfrastructure: "Own shared authenticated/session context and safe error translation.",
} as const;

export type BackendLayer = keyof typeof BACKEND_LAYER_RULES;

export interface DeferredBackendBoundary {
  area: string;
  reason: string;
}

export const DEFERRED_BACKEND_BOUNDARIES: readonly DeferredBackendBoundary[] = [
  {
    area: "server/routes.ts composition root",
    reason: "Large inline legacy helpers and registration-order dependencies require route-by-route runtime verification.",
  },
  {
    area: "accounting, inventory, voucher, and factory monolithic routes",
    reason: "Transaction ordering and historical calculation behavior must be reconciled before extraction.",
  },
  {
    area: "global async error middleware migration",
    reason: "Existing routes intentionally return different error messages and status shapes that must be preserved individually.",
  },
] as const;
