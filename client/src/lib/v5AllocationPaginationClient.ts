import { queryClient } from "./queryClient";

const ENDPOINT = "/api/factory/v5/stock-allocation";
const ROUTE = "/factory/stock-allocation-v5";
const DEFAULT_LIMIT = 50;
const MAX_ACTION_LIMIT = 250;
const ALLOWED_LIMITS = [25, 50, 100];

export interface V5AllocationRow {
  articleCode: string;
  productName: string;
  stockAvailable: number;
  totalLoaded: number;
  expectedToLoad: number;
  freeToPromise: number;
  totalKg: number;
  proformaDetails: Array<{
    proformaId: number;
    proformaName: string;
    customerId: number;
    customerName: string;
    lineQty: number;
    containerCount: number;
    totalExpected: number;
    containers: Array<{
      orderId: number;
      containerName: string;
      status: string;
      expectedQty: number;
      loadedQty: number;
      remainingQty: number;
    }>;
  }>;
  isGarbageOrWipers?: boolean;
}

export interface V5AllocationData {
  rows: V5AllocationRow[];
  totals: {
    stockAvailable: number;
    totalLoaded: number;
    expectedToLoad: number;
    freeToPromise: number;
    totalKg: number;
    shortageCount: number;
  };
  productNames: Record<string, string>;
  total?: number;
  page?: number;
  limit?: number;
  totalPages?: number;
  hasNextPage?: boolean;
  hasPreviousPage?: boolean;
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
    __erpV5AllocationPaginationInstalled?: boolean;
  }
}

function buildActionUrl(baseParams: URLSearchParams, page: number): string {
  const params = new URLSearchParams(baseParams);
  params.set("fullAction", "1");
  params.set("pagination", "1");
  params.set("page", String(page));
  params.set("limit", String(MAX_ACTION_LIMIT));
  return `${ENDPOINT}?${params.toString()}`;
}

/**
 * Fetches every server page for explicit full-data actions such as export and
 * proforma drawers. Normal table browsing must never call this helper.
 */
export async function fetchAllV5AllocationData(baseParams = new URLSearchParams()): Promise<V5AllocationData> {
  const firstResponse = await fetch(buildActionUrl(baseParams, 1), { credentials: "include" });
  if (!firstResponse.ok) {
    const body = await firstResponse.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to load complete stock allocation data");
  }

  const first = (await firstResponse.json()) as V5AllocationData;
  const rows = Array.isArray(first.rows) ? [...first.rows] : [];
  const productNames = { ...(first.productNames || {}) };
  const totalPages = Math.max(1, Number(first.totalPages || 1));

  for (let page = 2; page <= totalPages; page += 1) {
    const response = await fetch(buildActionUrl(baseParams, page), { credentials: "include" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.message || `Failed to load stock allocation page ${page}`);
    }
    const data = (await response.json()) as V5AllocationData;
    if (Array.isArray(data.rows)) rows.push(...data.rows);
    Object.assign(productNames, data.productNames || {});
  }

  return {
    ...first,
    rows,
    productNames,
    total: rows.length,
    page: 1,
    limit: rows.length,
    totalPages: rows.length > 0 ? 1 : 0,
    hasNextPage: false,
    hasPreviousPage: false,
  };
}

if (typeof window !== "undefined" && !window.__erpV5AllocationPaginationInstalled) {
  window.__erpV5AllocationPaginationInstalled = true;

  const previousFetch = window.fetch.bind(window);
  let activeMeta: PaginationMeta | null = null;
  let activeBaseKey = "";
  let selectedPage = 1;
  let selectedLimit = DEFAULT_LIMIT;
  let negativeOnlyMode = false;
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

  function hasFocusedDeepLink(): boolean {
    const params = new URLSearchParams(window.location.search);
    return params.has("proformaId") || params.get("openEdit") === "true";
  }

  function shouldPaginate(input: RequestInfo | URL, init?: RequestInit): { url: URL; key: string } | null {
    if (methodOf(input, init) !== "GET" || window.location.pathname !== ROUTE) return null;
    const url = resolveUrl(input);
    if (!url || url.pathname !== ENDPOINT || url.searchParams.get("fullAction") === "1") return null;

    // Rare workflows that require the complete model deliberately keep the
    // legacy response: focused deep links and the global Negative Only mode.
    if (negativeOnlyMode || hasFocusedDeepLink()) return null;
    return { url, key: baseKey(url) };
  }

  function refetchAllocation(): void {
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
    refetchAllocation();
  }

  function button(label: string, testId: string, onClick: () => void): HTMLButtonElement {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.dataset.testid = testId;
    element.style.border = "1px solid hsl(var(--border))";
    element.style.borderRadius = "6px";
    element.style.padding = "6px 10px";
    element.style.background = "hsl(var(--background))";
    element.style.color = "hsl(var(--foreground))";
    element.style.fontSize = "12px";
    element.style.fontWeight = "600";
    element.style.cursor = "pointer";
    element.addEventListener("click", onClick);
    return element;
  }

  function ensureControls(): HTMLDivElement {
    if (controlsRoot?.isConnected) return controlsRoot;
    controlsRoot = document.createElement("div");
    controlsRoot.id = "erp-v5-allocation-pagination";
    controlsRoot.dataset.testid = "v5-allocation-pagination";
    controlsRoot.setAttribute("role", "navigation");
    controlsRoot.setAttribute("aria-label", "Stock allocation pages");
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
    if (!activeMeta || window.location.pathname !== ROUTE || negativeOnlyMode || hasFocusedDeepLink()) {
      root.style.display = "none";
      return;
    }

    root.replaceChildren();
    root.style.display = "flex";

    const previous = button("Previous", "v5-allocation-page-previous", () => requestPage(selectedPage - 1));
    previous.disabled = selectedPage <= 1;
    previous.style.opacity = previous.disabled ? "0.45" : "1";
    previous.style.cursor = previous.disabled ? "not-allowed" : "pointer";

    const from = activeMeta.total === 0 ? 0 : (selectedPage - 1) * selectedLimit + 1;
    const to = Math.min(selectedPage * selectedLimit, activeMeta.total);
    const label = document.createElement("span");
    label.dataset.testid = "v5-allocation-page-label";
    label.textContent = `${from}-${to} of ${activeMeta.total} products · Page ${selectedPage} of ${Math.max(activeMeta.totalPages, 1)} · garbage/wiper toggle is page-scoped`;
    label.style.fontSize = "12px";
    label.style.whiteSpace = "nowrap";

    const next = button("Next", "v5-allocation-page-next", () => requestPage(selectedPage + 1));
    next.disabled = selectedPage >= Math.max(activeMeta.totalPages, 1);
    next.style.opacity = next.disabled ? "0.45" : "1";
    next.style.cursor = next.disabled ? "not-allowed" : "pointer";

    const sizeLabel = document.createElement("label");
    sizeLabel.style.display = "flex";
    sizeLabel.style.alignItems = "center";
    sizeLabel.style.gap = "5px";
    sizeLabel.style.fontSize = "12px";

    const select = document.createElement("select");
    select.dataset.testid = "v5-allocation-page-size";
    select.setAttribute("aria-label", "Products per page");
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
      const payload = (await response.clone().json()) as V5AllocationData;
      if (!payload || !Array.isArray(payload.rows) || payload.total === undefined) return response;

      const total = Number(payload.total || 0);
      const totalPages = Number(payload.totalPages || 0);
      const serverPage = Number(payload.page || selectedPage) || selectedPage;
      const limit = Number(payload.limit || selectedLimit) || selectedLimit;

      if (totalPages > 0 && serverPage > totalPages) {
        selectedPage = totalPages;
        queueMicrotask(refetchAllocation);
      } else {
        selectedPage = serverPage;
      }
      selectedLimit = limit;
      activeMeta = { key: match.key, page: selectedPage, limit, total, totalPages };
      renderControls();
      return response;
    } catch {
      return response;
    }
  };

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-testid]") : null;
    if (target?.getAttribute("data-testid") !== "button-v5-toggle-negative-only") return;
    negativeOnlyMode = !negativeOnlyMode;
    selectedPage = 1;
    activeMeta = null;
    renderControls();
    queueMicrotask(refetchAllocation);
  });

  window.addEventListener("popstate", renderControls);
  const originalPushState = history.pushState.bind(history);
  history.pushState = (...args) => {
    originalPushState(...args);
    queueMicrotask(renderControls);
  };
  const originalReplaceState = history.replaceState.bind(history);
  history.replaceState = (...args) => {
    originalReplaceState(...args);
    queueMicrotask(renderControls);
  };

  setInterval(renderControls, 1000);
}
