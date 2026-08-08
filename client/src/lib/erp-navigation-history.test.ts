import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canGoBackToPreviousErpLocation,
  consumeErpScrollRestore,
  goBackToPreviousErpLocation,
  installErpNavigationHistory,
} from "./erp-navigation-history";

let cleanup: (() => void) | null = null;
let main: HTMLDivElement;

beforeEach(() => {
  window.history.replaceState({}, "", "/stock?tab=items&page=3#inventory");
  main = document.createElement("div");
  main.id = "main-content";
  document.body.appendChild(main);
  cleanup = installErpNavigationHistory();
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("ERP navigation history", () => {
  it("records the exact originating ERP URL on SPA pushes", () => {
    main.scrollTop = 418;

    window.history.pushState({ recordId: 77 }, "", "/stock-query/77?view=movement#details");

    expect(canGoBackToPreviousErpLocation()).toBe(true);
    expect(window.history.state).toMatchObject({
      recordId: 77,
      __erpNavigation: {
        version: 1,
        mode: "erp",
        from: "/stock?tab=items&page=3#inventory",
        entryUrl: "/stock-query/77?view=movement#details",
        scrollTop: 0,
      },
    });
  });

  it("persists the current scroll position before going back", () => {
    window.history.pushState({}, "", "/stock-query/77");
    main.scrollTop = 265;
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});

    expect(goBackToPreviousErpLocation()).toBe(true);
    expect(back).toHaveBeenCalledTimes(1);
    expect(window.history.state.__erpNavigation.scrollTop).toBe(265);
  });

  it("captures the destination scroll position from browser Back/Forward", () => {
    window.dispatchEvent(
      new PopStateEvent("popstate", {
        state: {
          __erpNavigation: {
            version: 1,
            mode: "erp",
            from: null,
            entryUrl: "/stock?tab=items&page=3#inventory",
            scrollTop: 612,
          },
        },
      })
    );

    expect(consumeErpScrollRestore()).toBe(612);
    expect(consumeErpScrollRestore()).toBeNull();
  });

  it("upgrades legacy ERP Back buttons to exact browser history", () => {
    window.history.pushState({}, "", "/closing-stock/12?name=GROUP-A");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const button = document.createElement("button");
    button.dataset.testid = "button-back";
    document.body.appendChild(button);

    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    button.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("does not invent a previous ERP page for a direct entry", () => {
    expect(canGoBackToPreviousErpLocation()).toBe(false);
    expect(goBackToPreviousErpLocation()).toBe(false);
  });

  it("does not consume tracked ERP history on Factory or Properties paths", () => {
    window.history.pushState({}, "", "/factory/daybook");
    expect(canGoBackToPreviousErpLocation()).toBe(false);

    window.history.replaceState(window.history.state, "", "/properties/units");
    expect(canGoBackToPreviousErpLocation()).toBe(false);
  });
});
