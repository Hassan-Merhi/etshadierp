import "./bandwidthPhase1HotspotGuard";
import "./bandwidthPhase2PayloadGuard";
import {
  attachAccountingRequestIdentity,
  isProtectedAccountingRequest,
  releaseAccountingRequestIdentity,
  shouldReleaseAccountingRequestIdentity,
} from "./accountingRequestIdentity";

function resolvePath(input: RequestInfo | URL): string | null {
  try {
    if (typeof input === "string") return new URL(input, window.location.origin).pathname;
    if (input instanceof URL) return input.pathname;
    if (input instanceof Request) return new URL(input.url, window.location.origin).pathname;
  } catch {
    return null;
  }
  return null;
}

function parseJsonBody(init?: RequestInit): Record<string, unknown> | null {
  if (typeof init?.body !== "string" || !init.body.trim()) return null;
  try {
    const parsed = JSON.parse(init.body);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Adds retry-stable identity to protected accounting JSON writes, including
 * callers that use apiRequest directly instead of the factory request wrapper.
 * Network and 5xx outcomes retain the identity because the commit result may be
 * uncertain. Successful and definite 4xx responses release it.
 */
export function installAccountingRequestFetchGuard(): void {
  if (typeof window === "undefined" || (window as any).__accountingRequestFetchGuardInstalled) return;
  (window as any).__accountingRequestFetchGuardInstalled = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const pathname = resolvePath(input);
    const parsedBody = parseJsonBody(init);

    if (!pathname || !parsedBody || !isProtectedAccountingRequest(method, pathname, parsedBody)) {
      return originalFetch(input, init);
    }

    const outboundBody = attachAccountingRequestIdentity(method, pathname, parsedBody) as Record<string, unknown>;
    const outboundInit: RequestInit = {
      ...init,
      body: JSON.stringify(outboundBody),
    };

    const response = await originalFetch(input, outboundInit);
    if (shouldReleaseAccountingRequestIdentity(response.status)) {
      releaseAccountingRequestIdentity(method, pathname, outboundBody);
    }
    return response;
  };
}

installAccountingRequestFetchGuard();
