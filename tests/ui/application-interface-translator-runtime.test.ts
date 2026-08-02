import { beforeEach, describe, expect, it } from "vitest";
import { translateInterfaceTree } from "../../client/src/components/ApplicationInterfaceTranslator";

describe("application interface translator runtime behavior", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders reviewed interface labels in French and Arabic", () => {
    const surface = document.createElement("section");
    surface.innerHTML = `
      <h1>Checkout</h1>
      <button title="Print Receipt">Print Receipt</button>
      <input placeholder="Search customers" />
    `;
    document.body.appendChild(surface);

    translateInterfaceTree(surface, "fr");
    expect(surface.textContent).toContain("Encaisser");
    expect(surface.textContent).toContain("Imprimer le reçu");
    expect(surface.querySelector("button")?.getAttribute("title")).toBe("Imprimer le reçu");
    expect(surface.querySelector("input")?.getAttribute("placeholder")).toBe("Rechercher des clients");

    translateInterfaceTree(surface, "ar");
    expect(surface.textContent).toContain("إتمام البيع");
    expect(surface.textContent).toContain("طباعة الإيصال");
  });

  it("never translates explicitly protected business values", () => {
    const surface = document.createElement("section");
    surface.innerHTML = `
      <span data-stock-name>Sales</span>
      <span data-account-name>Reports</span>
      <span data-article-code>Checkout</span>
      <span data-voucher-number>Print Receipt</span>
      <span data-business-value>Dashboard</span>
    `;
    document.body.appendChild(surface);

    translateInterfaceTree(surface, "fr");
    expect(surface.querySelector("[data-stock-name]")?.textContent).toBe("Sales");
    expect(surface.querySelector("[data-account-name]")?.textContent).toBe("Reports");
    expect(surface.querySelector("[data-article-code]")?.textContent).toBe("Checkout");
    expect(surface.querySelector("[data-voucher-number]")?.textContent).toBe("Print Receipt");
    expect(surface.querySelector("[data-business-value]")?.textContent).toBe("Dashboard");
  });
});
