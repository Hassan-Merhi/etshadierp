export interface AuthoritativeStockAggregate {
  productId: number | null;
  articleCode: string;
  baleCount: number;
  totalWeight: number;
}

export interface AuthoritativeStockSnapshot {
  byProductId: Map<number, AuthoritativeStockAggregate>;
  byArticleCode: Map<string, AuthoritativeStockAggregate>;
}

export function normalizeStockArticleCode(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function mergeAggregate(
  current: AuthoritativeStockAggregate | undefined,
  incoming: AuthoritativeStockAggregate
): AuthoritativeStockAggregate {
  if (!current) return { ...incoming };
  return {
    productId: current.productId ?? incoming.productId,
    articleCode: current.articleCode || incoming.articleCode,
    baleCount: current.baleCount + incoming.baleCount,
    totalWeight: current.totalWeight + incoming.totalWeight,
  };
}

export function buildAuthoritativeStockSnapshot(rows: AuthoritativeStockAggregate[]): AuthoritativeStockSnapshot {
  const byProductId = new Map<number, AuthoritativeStockAggregate>();
  const byArticleCode = new Map<string, AuthoritativeStockAggregate>();

  for (const row of rows) {
    const aggregate: AuthoritativeStockAggregate = {
      productId: row.productId == null ? null : Number(row.productId),
      articleCode: String(row.articleCode ?? "").trim(),
      baleCount: Math.max(0, Number(row.baleCount) || 0),
      totalWeight: Math.max(0, Number(row.totalWeight) || 0),
    };

    if (aggregate.productId != null && Number.isFinite(aggregate.productId) && aggregate.productId > 0) {
      byProductId.set(aggregate.productId, mergeAggregate(byProductId.get(aggregate.productId), aggregate));
    }

    const codeKey = normalizeStockArticleCode(aggregate.articleCode);
    if (codeKey) {
      byArticleCode.set(codeKey, mergeAggregate(byArticleCode.get(codeKey), aggregate));
    }
  }

  return { byProductId, byArticleCode };
}

export function buildArticleCodeStockCountRecord(
  articleCodes: string[],
  snapshot: AuthoritativeStockSnapshot
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const articleCode of articleCodes) {
    const key = normalizeStockArticleCode(articleCode);
    counts[articleCode] = key ? snapshot.byArticleCode.get(key)?.baleCount ?? 0 : 0;
  }
  return counts;
}

function resolveStock(
  item: Record<string, unknown>,
  snapshot: AuthoritativeStockSnapshot
): AuthoritativeStockAggregate | null {
  const productId = Number(item.productId);
  if (Number.isFinite(productId) && productId > 0) {
    const byId = snapshot.byProductId.get(productId);
    if (byId) return byId;
  }

  const articleKey = normalizeStockArticleCode(item.articleCode);
  if (articleKey) {
    const byCode = snapshot.byArticleCode.get(articleKey);
    if (byCode) return byCode;
    return { productId: null, articleCode: String(item.articleCode ?? ""), baleCount: 0, totalWeight: 0 };
  }

  if (Number.isFinite(productId) && productId > 0) {
    return { productId, articleCode: "", baleCount: 0, totalWeight: 0 };
  }

  return null;
}

export function patchInventoryStockRows(body: unknown, snapshot: AuthoritativeStockSnapshot): unknown {
  if (!Array.isArray(body)) return body;

  return body.map((row) => {
    if (!row || typeof row !== "object") return row;
    const item = row as Record<string, unknown>;
    const stock = resolveStock(item, snapshot);
    if (!stock) return row;

    const next: Record<string, unknown> = {
      ...item,
      baleCount: stock.baleCount,
      totalWeight: stock.totalWeight,
    };

    if ("loadingCount" in item) next.loadingCount = 0;
    if ("quantity" in item) next.quantity = stock.baleCount;
    if ("availableQty" in item) next.availableQty = stock.baleCount;
    if ("reservedQty" in item) next.reservedQty = 0;
    if ("reservations" in item) next.reservations = [];

    if ("totalCost" in item) {
      const productionPrice = Number(item.productionPrice);
      if (Number.isFinite(productionPrice)) next.totalCost = productionPrice * stock.baleCount;
    }

    return next;
  });
}

function patchStockQtyArray(
  value: unknown,
  snapshot: AuthoritativeStockSnapshot,
  includeWeight: boolean
): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((row) => {
    if (!row || typeof row !== "object") return row;
    const item = row as Record<string, unknown>;
    const stock = resolveStock(item, snapshot);
    if (!stock) return row;
    return {
      ...item,
      stockQty: stock.baleCount,
      ...(includeWeight ? { stockTotalWeight: stock.totalWeight } : {}),
    };
  });
}

export function patchVerificationSummaryStock(body: unknown, snapshot: AuthoritativeStockSnapshot): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const summary = body as Record<string, unknown>;
  return {
    ...summary,
    comparison: patchStockQtyArray(summary.comparison, snapshot, true),
    proformaLines: patchStockQtyArray(summary.proformaLines, snapshot, false),
    loadedItems: patchStockQtyArray(summary.loadedItems, snapshot, false),
  };
}
