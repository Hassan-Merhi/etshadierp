import type { QueryClient } from "@tanstack/react-query";
import { queryPathname } from "./frontendDataArchitecture";

type JsonRecord = Record<string, any>;
type ReferenceMutationKind = "list" | "object";

interface ReferenceMutationRule {
  path: RegExp;
  queryPath: string;
  kind: ReferenceMutationKind;
  payloadKeys: readonly string[];
}

const REFERENCE_MUTATION_RULES: readonly ReferenceMutationRule[] = [
  {
    path: /^\/api\/locations(?:\/\d+)?\/?$/,
    queryPath: "/api/locations",
    kind: "list",
    payloadKeys: ["location", "item", "data"],
  },
  {
    path: /^\/api\/suppliers(?:\/\d+)?\/?$/,
    queryPath: "/api/suppliers",
    kind: "list",
    payloadKeys: ["supplier", "item", "data"],
  },
  {
    path: /^\/api\/customers(?:\/\d+)?\/?$/,
    queryPath: "/api/customers",
    kind: "list",
    payloadKeys: ["customer", "item", "data"],
  },
  {
    path: /^\/api\/employees(?:\/\d+)?\/?$/,
    queryPath: "/api/employees",
    kind: "list",
    payloadKeys: ["employee", "item", "data"],
  },
  {
    path: /^\/api\/stock-groups(?:\/\d+)?\/?$/,
    queryPath: "/api/stock-groups",
    kind: "list",
    payloadKeys: ["stockGroup", "group", "item", "data"],
  },
  {
    path: /^\/api\/stock-categories(?:\/\d+)?\/?$/,
    queryPath: "/api/stock-categories",
    kind: "list",
    payloadKeys: ["category", "item", "data"],
  },
  {
    path: /^\/api\/stock-grades(?:\/\d+)?\/?$/,
    queryPath: "/api/stock-grades",
    kind: "list",
    payloadKeys: ["grade", "item", "data"],
  },
  {
    path: /^\/api\/factory\/workers(?:\/\d+(?:\/reactivate)?)?\/?$/,
    queryPath: "/api/factory/workers",
    kind: "list",
    payloadKeys: ["worker", "item", "data"],
  },
  {
    path: /^\/api\/factory\/bale-products(?:\/\d+)?\/?$/,
    queryPath: "/api/factory/bale-products",
    kind: "list",
    payloadKeys: ["product", "item", "data"],
  },
  {
    path: /^\/api\/factory\/worker-categories(?:\/\d+)?\/?$/,
    queryPath: "/api/factory/worker-categories",
    kind: "list",
    payloadKeys: ["category", "item", "data"],
  },
  {
    path: /^\/api\/company-settings\/?$/,
    queryPath: "/api/company-settings",
    kind: "object",
    payloadKeys: ["settings", "data"],
  },
  {
    path: /^\/api\/factory\/settings\/?$/,
    queryPath: "/api/factory/settings",
    kind: "object",
    payloadKeys: ["settings", "data"],
  },
  {
    path: /^\/api\/user\/preferences\/?$/,
    queryPath: "/api/user/preferences",
    kind: "object",
    payloadKeys: ["preferences", "data"],
  },
];

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function entityId(value: unknown): string | number | null {
  if (!isRecord(value)) return null;
  const id = value.id ?? value.workerId ?? value.locationId ?? value.supplierId ?? value.customerId ?? value.employeeId;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

function pathEntityId(pathname: string): string | number | null {
  const segment = pathname
    .split("/")
    .reverse()
    .find((part) => /^\d+$/.test(part));
  return segment ? Number(segment) : null;
}

function extractPayload(payload: unknown, rule: ReferenceMutationRule): unknown {
  if (!isRecord(payload)) return payload;
  for (const key of rule.payloadKeys) {
    const candidate = payload[key];
    if (candidate !== undefined) return candidate;
  }
  return payload;
}

function sortReferenceRows(rows: unknown[]): unknown[] {
  const copy = [...rows];
  const label = (value: unknown) => {
    if (!isRecord(value)) return "";
    return String(value.fullName ?? value.legalName ?? value.name ?? value.displayName ?? value.code ?? "");
  };
  copy.sort((left, right) => label(left).localeCompare(label(right), undefined, { numeric: true }));
  return copy;
}

export interface ReferenceListMutation {
  method: string;
  entity: unknown;
  id: string | number | null;
}

export function updateReferenceListPayload(existing: unknown, mutation: ReferenceListMutation): unknown {
  const updateRows = (rows: unknown[]): unknown[] => {
    const targetId = mutation.id ?? entityId(mutation.entity);
    if (mutation.method === "DELETE") {
      if (targetId === null) return rows;
      return rows.filter((row) => entityId(row) !== targetId);
    }

    if (!isRecord(mutation.entity)) return rows;
    const incomingId = entityId(mutation.entity);
    if (incomingId === null) return rows;
    const index = rows.findIndex((row) => entityId(row) === incomingId);
    if (index >= 0) {
      const next = [...rows];
      const current = next[index];
      next[index] = isRecord(current) ? { ...current, ...mutation.entity } : mutation.entity;
      return next;
    }
    return sortReferenceRows([...rows, mutation.entity]);
  };

  if (Array.isArray(existing)) return updateRows(existing);
  if (!isRecord(existing)) return existing;

  for (const key of ["data", "items", "rows", "results"] as const) {
    if (!Array.isArray(existing[key])) continue;
    const before = existing[key] as unknown[];
    const after = updateRows(before);
    const delta = after.length - before.length;
    return {
      ...existing,
      [key]: after,
      ...(typeof existing.total === "number" && delta !== 0 ? { total: Math.max(0, existing.total + delta) } : {}),
    };
  }
  return existing;
}

function matchesReferenceQuery(queryPath: string, queryKey: readonly unknown[]): boolean {
  return queryPathname(queryKey) === queryPath;
}

export async function applyReferenceMutationResponse(options: {
  client: QueryClient;
  method: string;
  pathname: string;
  response: Response;
}): Promise<boolean> {
  const method = options.method.toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method) || !options.response.ok) return false;

  const pathname = options.pathname.split("?", 1)[0].replace(/\/+$/, "") || "/";
  const rule = REFERENCE_MUTATION_RULES.find((candidate) => candidate.path.test(pathname));
  if (!rule) return false;

  const rawPayload =
    options.response.status === 204
      ? null
      : await options.response
          .clone()
          .json()
          .catch(() => null);
  const payload = extractPayload(rawPayload, rule);

  if (rule.kind === "object") {
    if (!isRecord(payload)) return false;
    options.client.setQueriesData(
      { predicate: (query) => matchesReferenceQuery(rule.queryPath, query.queryKey) },
      (existing) => (isRecord(existing) ? { ...existing, ...payload } : payload)
    );
    return true;
  }

  const mutation: ReferenceListMutation = {
    method,
    entity: payload,
    id: entityId(payload) ?? pathEntityId(pathname),
  };
  options.client.setQueriesData(
    { predicate: (query) => matchesReferenceQuery(rule.queryPath, query.queryKey) },
    (existing) => updateReferenceListPayload(existing, mutation)
  );

  return true;
}
