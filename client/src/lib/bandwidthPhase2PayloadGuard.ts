function resolveUrl(input: RequestInfo | URL): URL | null {
  try {
    if (typeof input === "string") return new URL(input, window.location.origin);
    if (input instanceof URL) return new URL(input.toString(), window.location.origin);
    if (input instanceof Request) return new URL(input.url, window.location.origin);
  } catch {
    return null;
  }
  return null;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
}

function isInventoryOtwTab(): boolean {
  if (typeof window === "undefined" || window.location.pathname !== "/inventory") return false;
  return new URLSearchParams(window.location.search).get("tab") === "on-the-way";
}

function profileFor(url: URL): string | null {
  if (url.pathname === "/api/containers") return "otw-summary";
  if (url.pathname === "/api/containers/otw-items") return "stock-otw";
  if (url.pathname === "/api/inventory" && url.searchParams.get("page") === "1" && url.searchParams.get("pageSize") === "100") {
    return "combined";
  }
  if (/^\/api\/containers\/\d+$/.test(url.pathname)) return "combined-detail";
  return null;
}

function rewriteInput(input: RequestInfo | URL, url: URL): RequestInfo | URL {
  if (typeof input === "string") {
    return input.startsWith("/") ? `${url.pathname}${url.search}${url.hash}` : url.toString();
  }
  if (input instanceof URL) return url;
  if (input instanceof Request) return new Request(url.toString(), input);
  return input;
}

export function installBandwidthPhase2PayloadGuard(): void {
  if (typeof window === "undefined" || (window as any).__bandwidthPhase2PayloadGuardInstalled) return;
  (window as any).__bandwidthPhase2PayloadGuardInstalled = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (requestMethod(input, init) !== "GET" || !isInventoryOtwTab()) {
      return originalFetch(input, init);
    }

    const url = resolveUrl(input);
    if (!url || !url.pathname.startsWith("/api/")) return originalFetch(input, init);

    const profile = profileFor(url);
    if (!profile || url.searchParams.has("profile")) return originalFetch(input, init);

    url.searchParams.set("profile", profile);
    return originalFetch(rewriteInput(input, url), init);
  };
}

installBandwidthPhase2PayloadGuard();
