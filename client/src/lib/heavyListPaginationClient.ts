import { queryClient } from "./queryClient";

const INSTALL_KEY = "__erpHeavyListPaginationClientInstalled";
const STOCK_ENTRY_ENDPOINT = "/api/factory/bales/stock-entry-history";
const STOCK_ENTRY_ROUTE = "/factory/stock-entry";
const DEFAULT_LIMIT = 50;
const ALLOWED_LIMITS = [25, 50, 100];

interface PaginationMeta {
  key: string;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

declare global {
  interface Window {
    __erpHeavyListPaginationClientInstalled?: boolean;
  }
}

if (typeof window !== "undefined" && !window[INSTALL_KEY as keyof Window]) {
  window.__erpHeavyListPaginationClientInstalled = true;

  const previousFetch = window.fetch.bind(window);
  let activeMeta: PaginationMeta | null = null;
  let activeBaseKey = "";
  let selectedPage = 1;
  let selectedLimit = DEFAULT_LIMIT;
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

  function getMethod(input: RequestInfo | URL, init?: RequestInit): string {
    return String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  }

  function buildBaseKey(url: URL): string {
    const params = new URLSearchParams(url.searchParams);
    for (const key of ["pagination", "page", "limit", "pageSize", "offset"]) params.delete(key);
    params.sort();
    return `${url.pathname}?${params.toString()}`;
  }

  function replaceInputUrl(input: RequestInfo | URL, url: URL): RequestInfo | URL {
    if (input instanceof Request) return new Request(url.toString(), input);
    if (input instanceof URL) return url;
    if (url.origin === window.location.origin) return `${url.pathname}${url.search}${url.hash}`;
    return url.toString();
  }

  function shouldPaginate(input: RequestInfo | URL, init?: RequestInit): { url: URL; key: string } | null {
    if (getMethod(input, init) !== "GET") return null;
    const url = resolveUrl(input);
    if (!url || url.pathname !== STOCK_ENTRY_ENDPOINT) return null;

    // Only the condensed screen request is paged. Detailed mode, lazy group
    // expansion, print/PDF, and Excel deliberately omit lite=1 and remain full.
    if (url.searchParams.get("lite") !== "1") return null;

    return { url, key: buildBaseKey(url) };
  }

  function isVisibleRoute(): boolean {
    return window.location.pathname === STOCK_ENTRY_ROUTE;
  }

  function controlButton(label: string, testId: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.testid = testId;
    button.style.border = "1px solid hsl(var(--border))";
    button.style.borderRadius = "6px";
    button.style.padding = "6px 10px";
    button.style.background = "hsl(var(--background))";
    button.style.color = "hsl(var(--foreground))";
    button.style.fontSize = "12px";
    button.style.fontWeight = "600";
    button.style.cursor = "pointer";
    button.addEventListener("click", onClick);
    return button;
  }

  function requestPage(page: number, limit = selectedLimit): void {
    if (!activeMeta) return;
    const nextPage = Math.max(1, Math.min(page, Math.max(activeMeta.totalPages, 1)));
    selectedPage = nextPage;
    selectedLimit = limit;
    renderControls();
    queryClient.invalidateQueries({
      predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === STOCK_ENTRY_ENDPOINT,
      refetchType: "active",
    });
  }

  function ensureControls(): HTMLDivElement {
    if (controlsRoot?.isConnected) return controlsRoot;

    controlsRoot = document.createElement("div");
    controlsRoot.id = "erp-stock-entry-pagination";
    controlsRoot.dataset.testid = "stock-entry-pagination";
    controlsRoot.setAttribute("role", "navigation");
    controlsRoot.setAttribute("aria-label", "Stock entry history pages");
    controlsRoot.style.position = "fixed";
    controlsRoot.style.left = "50%";
    controlsRoot.style.bottom = "18px";
    controlsRoot.style.transform = "translateX(-50%)";
    controlsRoot.style.zIndex = "1000";
    controlsRoot.style.display = "none";
    controlsRoot.style.alignItems = "center";
    controlsRoot.style.gap = "8px";
    controlsRoot.style.padding = "8px 10px";
    controlsRoot.style.border = "1px solid hsl(var(--border))";
    controlsRoot.style.borderRadius = "10px";
    controlsRoot.style.background = "hsl(var(--background))";
    controlsRoot.style.color = "hsl(var(--foreground))";
    controlsRoot.style.boxShadow = "0 8px 28px rgba(0, 0, 0, 0.18)";
    controlsRoot.style.maxWidth = "calc(100vw - 24px)";
    controlsRoot.style.flexWrap = "wrap";
    controlsRoot.style.justifyContent = "center";
    document.body.appendChild(controlsRoot);
    return controlsRoot;
  }

  function renderControls(): void {
    const root = ensureControls();
    if (!activeMeta || !isVisibleRoute()) {
      root.style.display = "none";
      return;
    }

    root.replaceChildren();
    root.style.display = "flex";

    const previous = controlButton("Previous", "stock-entry-page-previous", () => requestPage(selectedPage - 1));
    previous.disabled = !activeMeta.hasPreviousPage || selectedPage <= 1;
    previous.style.opacity = previous.disabled ? "0.45" : "1";
    previous.style.cursor = previous.disabled ? "not-allowed" : "pointer";

    const label = document.createElement("span");
    const from = activeMeta.total === 0 ? 0 : (selectedPage - 1) * selectedLimit + 1;
    const to = Math.min(selectedPage * selectedLimit, activeMeta.total);
    label.textContent = `${from}-${to} of ${activeMeta.total} groups · Page ${selectedPage} of ${Math.max(activeMeta.totalPages, 1)}`;
    label.dataset.testid = "stock-entry-page-label";
    label.style.fontSize = "12px";
    label.style.whiteSpace = "nowrap";

    const next = controlButton("Next", "stock-entry-page-next", () => requestPage(selectedPage + 1));
    next.disabled = !activeMeta.hasNextPage || selectedPage >= Math.max(activeMeta.totalPages, 1);
    next.style.opacity = next.disabled ? "0.45" : "1";
    next.style.cursor = next.disabled ? "not-allowed" : "pointer";

    const sizeLabel = document.createElement("label");
    sizeLabel.textContent = "Rows";
    sizeLabel.style.display = "flex";
    sizeLabel.style.alignItems = "center";
    sizeLabel.style.gap = "5px";
    sizeLabel.style.fontSize = "12px";

    const select = document.createElement("select");
    select.dataset.testid = "stock-entry-page-size";
    select.style.border = "1px solid hsl(var(--border))";
    select.style.borderRadius = "6px";
    select.style.padding = "5px 7px";
    select.style.background = "hsl(var(--background))";
    select.style.color = "hsl(var(--foreground))";
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
      const payload = await response.clone().json();
      if (!payload || !Array.isArray(payload.items)) return response;

      const total = Number(payload.total || 0);
      const limit = Number(payload.limit || selectedLimit) || selectedLimit;
      const totalPages = Number(payload.totalPages || 0);
      const serverPage = Number(payload.page || selectedPage) || selectedPage;
      selectedPage = serverPage;
      selectedLimit = limit;
      activeMeta = {
        key: match.key,
        page: serverPage,
        limit,
        total,
        totalPages,
        hasNextPage: Boolean(payload.hasNextPage),
        hasPreviousPage: Boolean(payload.hasPreviousPage),
      };
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
