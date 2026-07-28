import { queryClient } from "./queryClient";

const ACCOUNT_ROUTE_SUFFIX = "/accounts";
const ENDPOINT_PATTERN =
  /^\/api\/accounts\/(ledger|bank|fixed-asset|supplier|employee|customer)\/\d+\/transactions$/;
const DEFAULT_LIMIT = 100;
const ALLOWED_LIMITS = [50, 100, 250];

interface StatementPage {
  transactions: unknown[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  periodDebitTotal?: number;
  periodCreditTotal?: number;
  closingNetBalance?: number;
}

export interface AccountStatementPaginationSnapshot {
  key: string;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  periodDebitTotal: number | null;
  periodCreditTotal: number | null;
  closingNetBalance: number | null;
}

let statementSnapshot: AccountStatementPaginationSnapshot | null = null;
const statementListeners = new Set<() => void>();

export function getAccountStatementPaginationSnapshot(): AccountStatementPaginationSnapshot | null {
  return statementSnapshot;
}

export function subscribeAccountStatementPagination(listener: () => void): () => void {
  statementListeners.add(listener);
  return () => statementListeners.delete(listener);
}

function updateStatementSnapshot(next: AccountStatementPaginationSnapshot | null): void {
  statementSnapshot = next;
  for (const listener of statementListeners) listener();
}

declare global {
  interface Window {
    __erpAccountStatementPaginationInstalled?: boolean;
  }
}

function onAccountsRoute(): boolean {
  return window.location.pathname === "/accounts" || window.location.pathname.endsWith(ACCOUNT_ROUTE_SUFFIX);
}

if (typeof window !== "undefined" && !window.__erpAccountStatementPaginationInstalled) {
  window.__erpAccountStatementPaginationInstalled = true;

  const previousFetch = window.fetch.bind(window);
  let activeMeta: AccountStatementPaginationSnapshot | null = null;
  let activeBaseKey = "";
  let selectedPage = 1;
  let selectedLimit = DEFAULT_LIMIT;
  let controlsRoot: HTMLDivElement | null = null;

  const resolveUrl = (input: RequestInfo | URL): URL | null => {
    try {
      if (typeof input === "string") return new URL(input, window.location.origin);
      if (input instanceof URL) return new URL(input.toString());
      if (input instanceof Request) return new URL(input.url, window.location.origin);
    } catch {
      return null;
    }
    return null;
  };

  const methodOf = (input: RequestInfo | URL, init?: RequestInit): string =>
    String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();

  const replaceInputUrl = (input: RequestInfo | URL, url: URL): RequestInfo | URL => {
    if (input instanceof Request) return new Request(url.toString(), input);
    if (input instanceof URL) return url;
    return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : url.toString();
  };

  const baseKey = (url: URL): string => {
    const params = new URLSearchParams(url.searchParams);
    for (const key of ["pagination", "page", "limit", "pageSize", "offset"]) params.delete(key);
    params.sort();
    return `${url.pathname}?${params.toString()}`;
  };

  function refetchStatement(): void {
    queryClient.invalidateQueries({
      predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === "account-statement",
      refetchType: "active",
    });
  }

  function requestPage(page: number, limit = selectedLimit): void {
    if (!activeMeta) return;
    selectedPage = Math.max(1, Math.min(page, Math.max(activeMeta.totalPages, 1)));
    selectedLimit = limit;
    renderControls();
    refetchStatement();
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
    controlsRoot.id = "erp-account-statement-pagination";
    controlsRoot.dataset.testid = "account-statement-pagination";
    controlsRoot.setAttribute("role", "navigation");
    controlsRoot.setAttribute("aria-label", "Account statement pages");
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
    if (!activeMeta || !onAccountsRoute()) {
      root.style.display = "none";
      return;
    }
    root.replaceChildren();
    root.style.display = "flex";

    const previous = button("Previous", "account-statement-page-previous", () => requestPage(selectedPage - 1));
    previous.disabled = selectedPage <= 1;
    previous.style.opacity = previous.disabled ? "0.45" : "1";
    previous.style.cursor = previous.disabled ? "not-allowed" : "pointer";

    const from = activeMeta.total === 0 ? 0 : (selectedPage - 1) * selectedLimit + 1;
    const to = Math.min(selectedPage * selectedLimit, activeMeta.total);
    const label = document.createElement("span");
    label.dataset.testid = "account-statement-page-label";
    label.textContent = `${from}-${to} of ${activeMeta.total} transactions · Page ${selectedPage} of ${Math.max(activeMeta.totalPages, 1)}`;
    label.style.fontSize = "12px";
    label.style.whiteSpace = "nowrap";

    const next = button("Next", "account-statement-page-next", () => requestPage(selectedPage + 1));
    next.disabled = selectedPage >= Math.max(activeMeta.totalPages, 1);
    next.style.opacity = next.disabled ? "0.45" : "1";
    next.style.cursor = next.disabled ? "not-allowed" : "pointer";

    const sizeLabel = document.createElement("label");
    sizeLabel.style.display = "flex";
    sizeLabel.style.alignItems = "center";
    sizeLabel.style.gap = "5px";
    sizeLabel.style.fontSize = "12px";
    const select = document.createElement("select");
    select.dataset.testid = "account-statement-page-size";
    select.setAttribute("aria-label", "Statement transactions per page");
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
    if (methodOf(input, init) !== "GET" || !onAccountsRoute()) return previousFetch(input, init);
    const url = resolveUrl(input);
    if (!url || !ENDPOINT_PATTERN.test(url.pathname)) return previousFetch(input, init);

    const key = baseKey(url);
    if (key !== activeBaseKey) {
      activeBaseKey = key;
      selectedPage = 1;
      selectedLimit = DEFAULT_LIMIT;
    }
    url.searchParams.set("pagination", "1");
    url.searchParams.set("page", String(selectedPage));
    url.searchParams.set("limit", String(selectedLimit));

    const response = await previousFetch(replaceInputUrl(input, url), init);
    if (!response.ok) return response;
    try {
      const payload = (await response.clone().json()) as StatementPage;
      if (!payload || !Array.isArray(payload.transactions) || payload.total === undefined) return response;
      const total = Number(payload.total || 0);
      const totalPages = Number(payload.totalPages || 0);
      const serverPage = Number(payload.page || selectedPage) || selectedPage;
      const limit = Number(payload.limit || selectedLimit) || selectedLimit;
      if (totalPages > 0 && serverPage > totalPages) {
        selectedPage = totalPages;
        queueMicrotask(refetchStatement);
      } else {
        selectedPage = serverPage;
      }
      selectedLimit = limit;
      activeMeta = {
        key,
        total,
        page: selectedPage,
        limit,
        totalPages,
        periodDebitTotal: Number.isFinite(Number(payload.periodDebitTotal))
          ? Number(payload.periodDebitTotal)
          : null,
        periodCreditTotal: Number.isFinite(Number(payload.periodCreditTotal))
          ? Number(payload.periodCreditTotal)
          : null,
        closingNetBalance: Number.isFinite(Number(payload.closingNetBalance))
          ? Number(payload.closingNetBalance)
          : null,
      };
      updateStatementSnapshot(activeMeta);
      renderControls();
      return response;
    } catch {
      return response;
    }
  };

  const handleRouteState = () => {
    if (!onAccountsRoute()) {
      activeMeta = null;
      activeBaseKey = "";
      selectedPage = 1;
      selectedLimit = DEFAULT_LIMIT;
      updateStatementSnapshot(null);
    }
    renderControls();
  };
  window.addEventListener("popstate", handleRouteState);
  setInterval(handleRouteState, 1000);
}
