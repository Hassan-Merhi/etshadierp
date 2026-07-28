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
    "/api/stock-items",
    "/api/inventory",
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

  function compactOtwContainerSummary(body) {
    return body
      .filter((container) => container?.status === "OTW")
      .map((container) => ({
        id: container.id,
        status: container.status,
        grandTotal: container.grandTotal,
      }));
  }

  function compactStockOtwItems(body) {
    const grouped = new Map();

    for (const row of body) {
      const key = JSON.stringify([
        row?.stockItemName || "",
        row?.containerNumber || "",
        row?.supplierName || "",
        row?.gradeName || "",
        row?.categoryName || "",
      ]);
      const quantity = Number(row?.quantity || 0);
      const totalCost = Number(row?.totalCost || 0);
      const existing = grouped.get(key);

      if (existing) {
        existing.quantity += Number.isFinite(quantity) ? quantity : 0;
        existing.totalCost += Number.isFinite(totalCost) ? totalCost : 0;
        continue;
      }

      grouped.set(key, {
        stockItemName: row?.stockItemName || "",
        containerNumber: row?.containerNumber || "",
        supplierName: row?.supplierName || "Unknown",
        gradeName: row?.gradeName ?? null,
        categoryName: row?.categoryName ?? null,
        quantity: Number.isFinite(quantity) ? quantity : 0,
        totalCost: Number.isFinite(totalCost) ? totalCost : 0,
      });
    }

    return [...grouped.values()].map((row) => ({
      stockItemName: row.stockItemName,
      quantity: String(row.quantity),
      totalCost: String(row.totalCost),
      rate: String(row.quantity === 0 ? 0 : row.totalCost / row.quantity),
      containerNumber: row.containerNumber,
      supplierName: row.supplierName,
      gradeName: row.gradeName,
      categoryName: row.categoryName,
    }));
  }

  function compactCombinedContainerDetail(body) {
    const pos = Array.isArray(body?.pos)
      ? body.pos.map((po) => ({
          items: Array.isArray(po?.items)
            ? po.items.map((item) => ({
                stockItemId: item?.stockItemId ?? null,
                stockItemName: item?.stockItemName || item?.itemName || "",
                itemName: item?.itemName || item?.stockItemName || "",
                stockGroupId: item?.stockGroupId ?? null,
                stockGroupName: item?.stockGroupName || "",
                quantity: item?.quantity || "0",
                rate: item?.rate || "0",
              }))
            : [],
        }))
      : [];

    return { pos };
  }

  function applyResponseProfile(pathname, searchParams, body) {
    const profile = searchParams.get("profile");
    if (!profile) return body;

    if (pathname === "/api/containers" && profile === "otw-summary" && Array.isArray(body)) {
      return compactOtwContainerSummary(body);
    }

    if (pathname === "/api/containers/otw-items" && profile === "stock-otw" && Array.isArray(body)) {
      return compactStockOtwItems(body);
    }

    if (
      /^\/api\/containers\/\d+$/.test(pathname) &&
      profile === "combined-detail" &&
      body &&
      typeof body === "object"
    ) {
      return compactCombinedContainerDetail(body);
    }

    return body;
  }

  const expressNamespace = await import("express");
  const expressModule = expressNamespace.default || expressNamespace;
  const responsePrototype = expressModule.response || expressNamespace.response;

  if (responsePrototype?.json && !responsePrototype.json[PATCH_KEY]) {
    const originalJson = responsePrototype.json;

    const paginatedJson = function paginatedHeavyArrayJson(body) {
      const req = this.req;
      if (req?.method !== "GET") return originalJson.call(this, body);

      const { pathname, searchParams } = parseRequest(req);
      const profiledBody = applyResponseProfile(pathname, searchParams, body);

      if (
        !Array.isArray(profiledBody) ||
        !heavyArrayPaths.has(pathname) ||
        !wantsPagination(searchParams)
      ) {
        return originalJson.call(this, profiledBody);
      }

      const { page, limit, offset } = parsePagination(searchParams);
      const total = profiledBody.length;
      const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
      const items = profiledBody.slice(offset, offset + limit);

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
      message: "Heavy API pagination and payload profiles enabled",
      module: "api-pagination-bridge",
      defaultLimit,
      maxLimit,
      protectedPaths: [...heavyArrayPaths],
      responseProfiles: ["otw-summary", "stock-otw", "combined-detail"],
    })
  );
}
