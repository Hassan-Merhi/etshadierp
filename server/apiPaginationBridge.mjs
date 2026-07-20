import process from "node:process";

const INSTALL_KEY = Symbol.for("erp.api-pagination-bridge.installed");
const PATCH_KEY = Symbol.for("erp.api-pagination-bridge.patch");

if (!globalThis[INSTALL_KEY]) {
  globalThis[INSTALL_KEY] = true;

  const DEFAULT_LIMIT = 100;
  const DEFAULT_MAX_LIMIT = 250;
  const maxLimit = readPositiveInt(process.env.API_PAGINATION_MAX_LIMIT, DEFAULT_MAX_LIMIT);
  const defaultLimit = Math.min(readPositiveInt(process.env.API_PAGINATION_DEFAULT_LIMIT, DEFAULT_LIMIT), maxLimit);

  const heavyArrayPaths = new Set([
    "/api/factory/daybook",
    "/api/stock-items",
    "/api/inventory",
    // "/api/factory/bales/stock-entry-history" — removed: the route now paginates natively in SQL.
    "/api/factory/bales",
    "/api/factory/v5/stock-allocation",
  ]);

  function readPositiveInt(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  function parseRequest(req) {
    try {
      const url = new URL(req?.originalUrl || req?.url || "/", "http://localhost");
      return { pathname: url.pathname, searchParams: url.searchParams };
    } catch {
      return { pathname: req?.path || req?.url || "/", searchParams: new URLSearchParams() };
    }
  }

  function wantsPagination(searchParams) {
    return (
      searchParams.get("pagination") === "1" ||
      searchParams.has("page") ||
      searchParams.has("limit") ||
      searchParams.has("pageSize") ||
      searchParams.has("offset")
    );
  }

  function parsePagination(searchParams) {
    const requestedLimit = searchParams.get("limit") ?? searchParams.get("pageSize");
    const limit = Math.min(readPositiveInt(requestedLimit, defaultLimit), maxLimit);

    const offsetValue = searchParams.get("offset");
    if (offsetValue !== null) {
      const offset = Math.max(0, Number.parseInt(offsetValue, 10) || 0);
      return { page: Math.floor(offset / limit) + 1, limit, offset };
    }

    const page = readPositiveInt(searchParams.get("page"), 1);
    return { page, limit, offset: (page - 1) * limit };
  }

  function setPaginationHeaders(res, total, page, limit, totalPages) {
    if (res.headersSent) return;
    res.setHeader("X-Total-Count", String(total));
    res.setHeader("X-Page", String(page));
    res.setHeader("X-Page-Size", String(limit));
    res.setHeader("X-Total-Pages", String(totalPages));
    res.setHeader("Access-Control-Expose-Headers", "X-Total-Count, X-Page, X-Page-Size, X-Total-Pages");
  }

  const expressNamespace = await import("express");
  const expressModule = expressNamespace.default || expressNamespace;
  const responsePrototype = expressModule.response || expressNamespace.response;

  if (responsePrototype?.json && !responsePrototype.json[PATCH_KEY]) {
    const originalJson = responsePrototype.json;

    const paginatedJson = function paginatedHeavyArrayJson(body) {
      const req = this.req;
      if (req?.method !== "GET" || !Array.isArray(body)) return originalJson.call(this, body);

      const { pathname, searchParams } = parseRequest(req);
      if (!heavyArrayPaths.has(pathname) || !wantsPagination(searchParams)) {
        return originalJson.call(this, body);
      }

      const { page, limit, offset } = parsePagination(searchParams);
      const total = body.length;
      const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
      const items = body.slice(offset, offset + limit);

      setPaginationHeaders(this, total, page, limit, totalPages);
      return originalJson.call(this, {
        items,
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1 && totalPages > 0,
      });
    };

    Object.defineProperty(paginatedJson, PATCH_KEY, { value: true });
    responsePrototype.json = paginatedJson;
  }

  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "INFO",
      message: "Heavy API pagination bridge enabled",
      module: "api-pagination-bridge",
      defaultLimit,
      maxLimit,
      protectedPaths: [...heavyArrayPaths],
    })
  );
}
