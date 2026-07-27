import process from "node:process";

const INSTALL_KEY = Symbol.for("erp.api-pagination-bridge.installed");
const PATCH_KEY = Symbol.for("erp.api-pagination-bridge.patch");
const EXPENSIVE_GET_PATCH_KEY = Symbol.for("erp.expensive-get-cache.patch");
const RESPONSE_END_PATCH_KEY = Symbol.for("erp.expensive-get-cache.end-patch");

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

  // These read models are expensive to assemble but are safe to reuse briefly for
  // the same authenticated user/company. Any write increments the generation and
  // clears this cache, including 204 responses, so accounting and stock mutations
  // are never intentionally hidden behind the short cache window.
  const expensiveGetTtls = new Map([
    ["/api/factory/suppliers/with-balances", 15_000],
    ["/api/factory/suppliers/:id/broker-statement", 15_000],
    ["/api/worker-groups/with-members", 30_000],
    ["/api/accounts/all", 15_000],
  ]);
  const expensiveGetCache = new Map();
  let writeGeneration = 0;

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

  function normalizedSearch(searchParams) {
    return [...searchParams.entries()]
      .sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv))
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join("&");
  }

  function expensiveCacheKey(req, routePath) {
    const { searchParams } = parseRequest(req);
    const session = req?.session || {};
    const companyId = session.factoryCompanyId || session.currentCompanyId || "none";
    const userId = session.userId || req?.user?.id || "anonymous";
    const role = session.currentRole || req?.user?.role || "unknown";
    return `${routePath}|company=${companyId}|user=${userId}|role=${role}|${normalizedSearch(searchParams)}`;
  }

  function clearExpensiveGetCache() {
    writeGeneration += 1;
    expensiveGetCache.clear();
  }

  function trimExpensiveGetCache() {
    if (expensiveGetCache.size <= 64) return;
    const oldest = [...expensiveGetCache.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
    while (expensiveGetCache.size > 64 && oldest.length > 0) {
      const entry = oldest.shift();
      if (entry) expensiveGetCache.delete(entry[0]);
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

  function wantsCompact(searchParams) {
    return searchParams.get("compact") === "1" || searchParams.get("compact") === "true";
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

  function pick(row, fields) {
    const compact = {};
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(row, field)) compact[field] = row[field];
    }
    return compact;
  }

  const LOCATION_INVENTORY_FIELDS = [
    "inventoryId",
    "locationId",
    "stockItemId",
    "quantity",
    "averageRate",
    "totalValue",
    "stockItemCode",
    "stockItemName",
    "stockItemUom",
    "stockGroupId",
    "stockGroupName",
    "stockGroupCode",
    "stockItemActive",
    "categoryId",
    "categoryName",
  ];

  const FACTORY_CONTAINER_COMPACT_FIELDS = [
    "id",
    "containerNumber",
    "supplierId",
    "supplierName",
    "origin",
    "destination",
    "totalKg",
    "declaredKg",
    "actualReceivedKg",
    "ratePerKg",
    "ratePerKgUsd",
    "currencyCode",
    "fxRateToUsd",
    "finalPayableAmount",
    "finalPayableAmountUsd",
    "arrivalDate",
    "status",
    "freight",
    "freightCurrencyCode",
    "otherCharges",
    "commissionAmount",
    "commissionCurrencyCode",
    "additionalChargesSum",
    "preRegisteredChargesSum",
    "preRegisteredChargesCount",
    "preRegisteredChargesByCurrency",
    "dutyAmount",
    "dutyStatus",
    "trackingEnabled",
    "trackingAutoUpdate",
    "trackingCarrierHint",
    "trackingProvider",
    "trackingLastStatus",
    "trackingLastLocation",
    "trackingLastCheckedAt",
    "trackingLastEventDate",
    "trackingLastDescription",
    "trackingError",
    "trackingDetectedCarrier",
    "trackingNextCheckAt",
    "trackingLastSkipReason",
  ];

  const STOCK_ITEM_IDENTITY_FIELDS = ["id", "code", "name", "uom"];

  function compactArray(pathname, searchParams, body) {
    if (pathname === "/api/stock-items/light" && searchParams.get("profile") === "identity") {
      return body.map((row) => pick(row, STOCK_ITEM_IDENTITY_FIELDS));
    }

    if (!wantsCompact(searchParams)) return body;

    if (/^\/api\/locations\/\d+\/inventory$/.test(pathname)) {
      return body.map((row) => pick(row, LOCATION_INVENTORY_FIELDS));
    }

    if (pathname === "/api/factory/containers") {
      return body.map((row) => pick(row, FACTORY_CONTAINER_COMPACT_FIELDS));
    }

    return body;
  }

  const expressNamespace = await import("express");
  const expressModule = expressNamespace.default || expressNamespace;
  const responsePrototype = expressModule.response || expressNamespace.response;
  const applicationPrototype = expressModule.application || expressNamespace.application;

  if (responsePrototype?.end && !responsePrototype.end[RESPONSE_END_PATCH_KEY]) {
    const originalEnd = responsePrototype.end;
    const generationAwareEnd = function generationAwareEnd(...args) {
      if (this.req?.method && this.req.method !== "GET" && this.req.method !== "HEAD") {
        clearExpensiveGetCache();
      }
      return originalEnd.apply(this, args);
    };
    Object.defineProperty(generationAwareEnd, RESPONSE_END_PATCH_KEY, { value: true });
    responsePrototype.end = generationAwareEnd;
  }

  if (applicationPrototype?.get && !applicationPrototype.get[EXPENSIVE_GET_PATCH_KEY]) {
    const originalGet = applicationPrototype.get;
    const cachedGet = function cachedGet(routePath, ...handlers) {
      // Preserve Express's app.get(setting) overload and every unlisted route.
      if (handlers.length === 0 || typeof routePath !== "string" || !expensiveGetTtls.has(routePath)) {
        return originalGet.call(this, routePath, ...handlers);
      }

      const ttlMs = expensiveGetTtls.get(routePath);
      const finalIndex = handlers.length - 1;
      const finalHandler = handlers[finalIndex];
      if (typeof finalHandler !== "function") return originalGet.call(this, routePath, ...handlers);

      handlers[finalIndex] = async function cachedExpensiveGetHandler(req, res, next) {
        const key = expensiveCacheKey(req, routePath);
        const now = Date.now();
        const cached = expensiveGetCache.get(key);
        if (cached && cached.expiresAt > now && cached.generation === writeGeneration) {
          res.setHeader("X-ERP-Read-Cache", "HIT");
          return res.json(cached.body);
        }
        if (cached) expensiveGetCache.delete(key);

        const generationAtStart = writeGeneration;
        const originalJson = res.json.bind(res);
        let stored = false;
        res.json = function captureExpensiveRead(body) {
          if (!stored && res.statusCode < 400 && generationAtStart === writeGeneration) {
            stored = true;
            expensiveGetCache.set(key, {
              body,
              createdAt: Date.now(),
              expiresAt: Date.now() + ttlMs,
              generation: generationAtStart,
            });
            trimExpensiveGetCache();
            res.setHeader("X-ERP-Read-Cache", "MISS");
          }
          return originalJson(body);
        };

        try {
          return await finalHandler(req, res, next);
        } catch (error) {
          return next(error);
        } finally {
          res.json = originalJson;
        }
      };

      return originalGet.call(this, routePath, ...handlers);
    };
    Object.defineProperty(cachedGet, EXPENSIVE_GET_PATCH_KEY, { value: true });
    applicationPrototype.get = cachedGet;
  }

  if (responsePrototype?.json && !responsePrototype.json[PATCH_KEY]) {
    const originalJson = responsePrototype.json;

    const paginatedJson = function paginatedHeavyArrayJson(body) {
      const req = this.req;
      if (req?.method !== "GET" || !Array.isArray(body)) return originalJson.call(this, body);

      const { pathname, searchParams } = parseRequest(req);
      const responseBody = compactArray(pathname, searchParams, body);

      if (!heavyArrayPaths.has(pathname) || !wantsPagination(searchParams)) {
        return originalJson.call(this, responseBody);
      }

      const { page, limit, offset } = parsePagination(searchParams);
      const total = responseBody.length;
      const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
      const items = responseBody.slice(offset, offset + limit);

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
      message: "Heavy API pagination, compact payload and expensive-read cache bridge enabled",
      module: "api-pagination-bridge",
      defaultLimit,
      maxLimit,
      protectedPaths: [...heavyArrayPaths],
      compactProfiles: [
        "/api/locations/:locationId/inventory?compact=1",
        "/api/factory/containers?compact=1",
        "/api/stock-items/light?profile=identity",
      ],
      expensiveReadCacheRoutes: [...expensiveGetTtls.keys()],
    })
  );
}
