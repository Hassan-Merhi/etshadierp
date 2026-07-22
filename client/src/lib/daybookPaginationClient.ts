import { queryClient } from "./queryClient";

const ENDPOINT = "/api/factory/daybook";
const ROUTES = new Set(["/factory/daybook", "/properties/daybook"]);
const DEFAULT_LIMIT = 9999;   // load everything in one request — no pagination UI
const MAX_ACTION_LIMIT = 9999;
const ALLOWED_LIMITS = [9999];

export interface PaginatedDaybookEntry {
  id: number;
  companyId: number;
  txDate: string;
  txType: string;
  referenceId: number | null;
  referenceTable: string | null;
  description: string;
  metaJson: string | null;
  currencyCode: string;
  amountCurrency: string;
  fxRateToUsd: string;
  amountUsd: string;
  optional?: boolean;
  createdAt: string;
  createdBy: number | null;
  voucherNumber?: string;
  effectiveDate?: string | null;
}

interface DaybookPage {
  items: PaginatedDaybookEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

interface PaginationMeta {
  key: string;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

declare global {
  interface Window {
    __erpDaybookPaginationInstalled?: boolean;
  }
}

function actionUrl(baseParams: URLSearchParams, page: number): string {
  const params = new URLSearchParams(baseParams);
  params.set("fullAction", "1");
  params.set("pagination", "1");
  params.set("page", String(page));
  params.set("limit", String(MAX_ACTION_LIMIT));
  return `${ENDPOINT}?${params.toString()}`;
}

/** Loads the complete server-filtered daybook only for explicit export actions. */
export async function fetchAllDaybookEntries(baseParams: URLSearchParams): Promise<PaginatedDaybookEntry[]> {
  const firstResponse = await fetch(actionUrl(baseParams, 1), { credentials: "include" });
  if (!firstResponse.ok) {
    const body = await firstResponse.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to load complete daybook data");
  }

  const first = (await firstResponse.json()) as DaybookPage;
  const entries = Array.isArray(first.items) ? [...first.items] : [];
  const totalPages = Math.max(1, Number(first.totalPages || 1));

  for (let page = 2; page <= totalPages; page += 1) {
    const response = await fetch(actionUrl(baseParams, page), { credentials: "include" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.message || `Failed to load daybook page ${page}`);
    }
    const data = (await response.json()) as DaybookPage;
    if (Array.isArray(data.items)) entries.push(...data.items);
  }

  return entries;
}

if (typeof window !== "undefined" && !window.__erpDaybookPaginationInstalled) {
  window.__erpDaybookPaginationInstalled = true;

  const previousFetch = window.fetch.bind(window);
  let activeMeta: PaginationMeta | null = null;
  let activeBaseKey = "";
  let selectedPage = 1;
  let selectedLimit = DEFAULT_LIMIT;
  let wasOnRoute = ROUTES.has(window.location.pathname);
  let controlsRoot: HTMLDivElement | null = null;

  function resolveUrl(input: RequestInfo | URL): URL | null {
    try {
      if (typeof input === "string") return new URL(input, window.location.origin);
      if (input instanceof URL) return new URL(input.toString());
      if (input instanceof Request) return new URL(input.url, window.location.origin);
    } catch {
      return null;
    }
    return null;
  }

  function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
    return String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  }

  function replaceInputUrl(input: RequestInfo | URL, url: URL): RequestInfo | URL {
    if (input instanceof Request) return new Request(url.toString(), input);
    if (input instanceof URL) return url;
    if (url.origin === window.location.origin) return `${url.pathname}${url.search}${url.hash}`;
    return url.toString();
  }

  function baseKey(url: URL): string {
    const params = new URLSearchParams(url.searchParams);
    for (const key of ["pagination", "page", "limit", "pageSize", "offset", "fullAction"]) params.delete(key);
    params.sort();
    return `${url.pathname}?${params.toString()}`;
  }

  function hasDeepLink(): boolean {
    const params = new URLSearchParams(window.location.search);
    return params.has("entryId") || params.has("voucherId");
  }

  function shouldPaginate(input: RequestInfo | URL, init?: RequestInit): { url: URL; key: string } | null {
    if (methodOf(input, init) !== "GET" || !ROUTES.has(window.location.pathname)) return null;
    const url = resolveUrl(input);
    if (!url || url.pathname !== ENDPOINT || url.searchParams.get("fullAction") === "1") return null;
    if (hasDeepLink()) return null;
    return { url, key: baseKey(url) };
  }

  function refetchDaybook(): void {
    queryClient.invalidateQueries({
      predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === ENDPOINT,
      refetchType: "active",
    });
  }

  function requestPage(page: number, limit = selectedLimit): void {
    if (!activeMeta) return;
    selectedPage = Math.max(1, Math.min(page, Math.max(activeMeta.totalPages, 1)));
    selectedLimit = limit;
    renderControls();
    refetchDaybook();
  }

  function button(label: string, testId: string, onClick: () => void): HTMLButtonElement {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.dataset.testid = testId;
    Object.assign(element.style, {
      border: "1px solid hsl(var(--border))",
      borderRadius: "6px",
      padding: "6px 10px",
      background: "hsl(var(--background))",
      color: "hsl(var(--foreground))",
      fontSize: "12px",
      fontWeight: "600",
      cursor: "pointer",
    });
    element.addEventListener("click", onClick);
    return element;
  }

  function ensureControls(): HTMLDivElement {
    if (controlsRoot?.isConnected) return controlsRoot;
    controlsRoot = document.createElement("div");
    controlsRoot.id = "erp-factory-daybook-pagination";
    controlsRoot.dataset.testid = "factory-daybook-pagination";
    controlsRoot.setAttribute("role", "navigation");
    controlsRoot.setAttribute("aria-label", "Factory Daybook pages");
    Object.assign(controlsRoot.style, {
      position: "fixed",
      left: "50%",
      bottom: "18px",
      transform: "translateX(-50%)",
      zIndex: "1000",
      display: "none",
      alignItems: "center",
      gap: "8px",
      padding: "8px 10px",
      border: "1px solid hsl(var(--border))",
      borderRadius: "10px",
      background: "hsl(var(--background))",
      color: "hsl(var(--foreground))",
      boxShadow: "0 8px 28px rgba(0, 0, 0, 0.18)",
      maxWidth: "calc(100vw - 24px)",
      flexWrap: "wrap",
      justifyContent: "center",
    });
    document.body.appendChild(controlsRoot);
    return controlsRoot;
  }

  function renderControls(): void {
    const root = ensureControls();
    // Pagination UI is intentionally hidden — all data loads in a single request.
    // Typed as boolean (not the literal `false`) so the disabled controls below
    // stay reachable for type-checking until pagination is re-enabled.
    const PAGINATION_UI_ENABLED = false as boolean;
    if (!PAGINATION_UI_ENABLED) {
      root.style.display = "none";
      return;
    }
    if (!activeMeta || !ROUTES.has(window.location.pathname) || hasDeepLink()) {
      root.style.display = "none";
      return;
    }

    root.replaceChildren();
    root.style.display = "flex";

    const previous = button("Previous", "factory-daybook-page-previous", () => requestPage(selectedPage - 1));
    previous.disabled = selectedPage <= 1;
    previous.style.opacity = previous.disabled ? "0.45" : "1";
    previous.style.cursor = previous.disabled ? "not-allowed" : "pointer";

    const from = activeMeta.total === 0 ? 0 : (selectedPage - 1) * selectedLimit + 1;
    const to = Math.min(selectedPage * selectedLimit, activeMeta.total);
    const label = document.createElement("span");
    label.dataset.testid = "factory-daybook-page-label";
    label.textContent = `${from}-${to} of ${activeMeta.total} transactions · Page ${selectedPage} of ${Math.max(activeMeta.totalPages, 1)} · table groups and totals are this page`;
    label.style.fontSize = "12px";
    label.style.whiteSpace = "nowrap";

    const next = button("Next", "factory-daybook-page-next", () => requestPage(selectedPage + 1));
    next.disabled = selectedPage >= Math.max(activeMeta.totalPages, 1);
    next.style.opacity = next.disabled ? "0.45" : "1";
    next.style.cursor = next.disabled ? "not-allowed" : "pointer";

    const sizeLabel = document.createElement("label");
    sizeLabel.style.display = "flex";
    sizeLabel.style.alignItems = "center";
    sizeLabel.style.gap = "5px";
    sizeLabel.style.fontSize = "12px";

    const select = document.createElement("select");
    select.dataset.testid = "factory-daybook-page-size";
    select.setAttribute("aria-label", "Transactions per page");
    Object.assign(select.style, {
      border: "1px solid hsl(var(--border))",
      borderRadius: "6px",
      padding: "5px 7px",
      background: "hsl(var(--background))",
      color: "hsl(var(--foreground))",
    });
    for (const limit of ALLOWED_LIMITS) {
      const option = document.createElement("option");
      option.value = String(limit);
      option.textContent = String(limit);
      option.selected = limit === selectedLimit;
      select.appendChild(option);
    }
    select.addEventListener("change", () => requestPage(1, Number(select.value) || DEFAULT_LIMIT));
    sizeLabel.append("Rows", select);

    root.append(previous, label, next, sizeLabel);
  }

  function handleRouteState(): void {
    const onRoute = ROUTES.has(window.location.pathname);
    if (!onRoute && wasOnRoute) {
      activeMeta = null;
      activeBaseKey = "";
      selectedPage = 1;
      selectedLimit = DEFAULT_LIMIT;
    }
    wasOnRoute = onRoute;
    renderControls();
  }

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const match = shouldPaginate(input, init);
    if (!match) return previousFetch(input, init);

    if (match.key !== activeBaseKey) {
      activeBaseKey = match.key;
      selectedPage = 1;
      selectedLimit = DEFAULT_LIMIT;
    }

    match.url.searchParams.set("pagination", "1");
    match.url.searchParams.set("page", String(selectedPage));
    match.url.searchParams.set("limit", String(selectedLimit));

    const response = await previousFetch(replaceInputUrl(input, match.url), init);
    if (!response.ok) return response;

    try {
      const payload = (await response.clone().json()) as DaybookPage;
      if (!payload || !Array.isArray(payload.items)) return response;

      const total = Number(payload.total || 0);
      const totalPages = Number(payload.totalPages || 0);
      const serverPage = Number(payload.page || selectedPage) || selectedPage;
      const limit = Number(payload.limit || selectedLimit) || selectedLimit;

      if (totalPages > 0 && serverPage > totalPages) {
        selectedPage = totalPages;
        queueMicrotask(refetchDaybook);
      } else {
        selectedPage = serverPage;
      }
      selectedLimit = limit;
      activeMeta = { key: match.key, page: selectedPage, limit, total, totalPages };
      renderControls();

      const headers = new Headers(response.headers);
      headers.set("Content-Type", "application/json; charset=utf-8");
      return new Response(JSON.stringify(payload.items), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch {
      return response;
    }
  };

  window.addEventListener("popstate", handleRouteState);
  const originalPushState = history.pushState.bind(history);
  history.pushState = (...args) => {
    originalPushState(...args);
    queueMicrotask(handleRouteState);
  };
  const originalReplaceState = history.replaceState.bind(history);
  history.replaceState = (...args) => {
    originalReplaceState(...args);
    queueMicrotask(handleRouteState);
  };

  setInterval(handleRouteState, 1000);
}
