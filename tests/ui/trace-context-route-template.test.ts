import { describe, expect, it } from "vitest";
import { normaliseRouteTemplate } from "../../server/lib/traceContext";

describe("bandwidth route template canonicalization", () => {
  it("does not double-prefix an absolute API route with Express baseUrl", () => {
    expect(normaliseRouteTemplate("/api/factory/bale-products", "/api/factory/bale-products", "/api/factory")).toBe(
      "/api/factory/bale-products"
    );

    expect(normaliseRouteTemplate("/api/factory/categories", "/api/factory/categories", "/api/factory")).toBe(
      "/api/factory/categories"
    );
  });

  it("still joins relative route templates to their mounted base", () => {
    expect(normaliseRouteTemplate("/api/factory/items/42", "/items/:id", "/api/factory")).toBe(
      "/api/factory/items/:id"
    );
  });

  it("does not duplicate a route that already contains its non-api base", () => {
    expect(normaliseRouteTemplate("/factory/items/42", "/factory/items/:id", "/factory")).toBe("/factory/items/:id");
  });
});
