const V5_ALLOCATION_ENDPOINT = "/api/factory/v5/stock-allocation";
const CUSTOMER_LOADING_HASH = "#customer-loading";

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
  return String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
}

function replaceInputUrl(input: RequestInfo | URL, url: URL): RequestInfo | URL {
  if (input instanceof Request) return new Request(url.toString(), input);
  if (input instanceof URL) return url;
  if (url.origin === window.location.origin) return `${url.pathname}${url.search}${url.hash}`;
  return url.toString();
}

if (typeof window !== "undefined") {
  const previousFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (requestMethod(input, init) !== "GET" || window.location.hash !== CUSTOMER_LOADING_HASH) {
      return previousFetch(input, init);
    }

    const url = resolveUrl(input);
    if (!url || url.pathname !== V5_ALLOCATION_ENDPOINT || url.searchParams.size > 0) {
      return previousFetch(input, init);
    }

    url.searchParams.set("compact", "1");
    return previousFetch(replaceInputUrl(input, url), init);
  };
}
