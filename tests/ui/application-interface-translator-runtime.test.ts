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
    expect(surface.querySelector("input")?.getAttribute("placeholder")).toBe("Rechercher clients");

    translateInterfaceTree(surface, "ar");
    expect(surface.textContent).toContain("إتمام البيع");
    expect(surface.textContent).toContain("طباعة الإيصال");
  });

  it("treats plain content and table data as business values by default", () => {
    const surface = document.createElement("section");
    surface.innerHTML = `
      <span>Sales</span>
      <table><tbody><tr><td>Reports</td></tr></tbody></table>
      <div data-i18n-ui>Dashboard</div>
    `;
    document.body.appendChild(surface);

    translateInterfaceTree(surface, "fr");
    expect(surface.querySelector("span")?.textContent).toBe("Sales");
    expect(surface.querySelector("td")?.textContent).toBe("Reports");
    expect(surface.querySelector("[data-i18n-ui]")?.textContent).toBe("Tableau de bord");
  });

  it("never translates explicitly protected business values", () => {
    const surface = document.createElement("section");
    surface.innerHTML = `
      <button data-stock-name>Sales</button>
      <button data-account-name>Reports</button>
      <button data-article-code>Checkout</button>
      <button data-voucher-number>Print Receipt</button>
      <button data-business-value>Dashboard</button>
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
