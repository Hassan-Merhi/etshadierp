/**
 * Phase 3 — Keyboard Handler Unit Tests
 *
 * Tests client/src/pages/vouchers/keyboardHandlers.ts as a pure utility.
 * The handler is imported directly into Node (no jsdom needed) because:
 *  - It has no React component imports (only `import type React from "react"`).
 *  - The DOM calls (document.querySelector) happen inside setTimeout callbacks
 *    that we control via vi.useFakeTimers().
 *  - The event object is a plain mock with `key`, `shiftKey`, `preventDefault`.
 *
 * What these tests protect:
 *  - Arrow keys navigate between amount inputs and account inputs correctly.
 *  - Tab on the account field focuses the same-row amount input.
 *  - Enter / Tab on the last amount row appends a new blank row.
 *  - Enter / Tab on a non-last row navigates without appending.
 *  - Shift+Tab is never intercepted (browser default should handle it).
 *  - Arrow keys on amount field always call preventDefault (no browser scroll).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handlePaymentKeyDown } from "@/pages/vouchers/keyboardHandlers";

// ── Helpers ──────────────────────────────────────────────────────────────────

type MockEvent = {
  key: string;
  shiftKey: boolean;
  preventDefault: ReturnType<typeof vi.fn>;
};

function makeEvent(key: string, shiftKey = false): MockEvent {
  return { key, shiftKey, preventDefault: vi.fn() };
}

// A mock element that records focus/select calls
function makeMockEl() {
  return { focus: vi.fn(), select: vi.fn() };
}

// ── Setup ────────────────────────────────────────────────────────────────────

let querySelector: ReturnType<typeof vi.fn>;
let mockEl: ReturnType<typeof makeMockEl>;

beforeEach(() => {
  vi.useFakeTimers();
  mockEl = makeMockEl();
  querySelector = vi.fn().mockReturnValue(mockEl);
  vi.stubGlobal("document", { querySelector });
});

afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ── Account field (Tab navigation) ──────────────────────────────────────────

describe("handlePaymentKeyDown — account field", () => {
  it("Tab calls preventDefault and focuses same-row amount input", () => {
    const e = makeEvent("Tab");
    handlePaymentKeyDown(e, 0, "account", 3, vi.fn());

    expect(e.preventDefault).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(querySelector).toHaveBeenCalledWith('[data-testid="input-amount-0"]');
    expect(mockEl.focus).toHaveBeenCalledOnce();
    expect(mockEl.select).toHaveBeenCalledOnce();
  });

  it("Tab works on any row index", () => {
    const e = makeEvent("Tab");
    handlePaymentKeyDown(e, 2, "account", 5, vi.fn());

    expect(e.preventDefault).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(querySelector).toHaveBeenCalledWith('[data-testid="input-amount-2"]');
  });

  it("Shift+Tab does nothing (let browser handle backwards navigation)", () => {
    const e = makeEvent("Tab", true);
    handlePaymentKeyDown(e, 1, "account", 3, vi.fn());

    expect(e.preventDefault).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(querySelector).not.toHaveBeenCalled();
  });

  it("Enter on account field does nothing (not handled)", () => {
    const e = makeEvent("Enter");
    handlePaymentKeyDown(e, 0, "account", 3, vi.fn());

    expect(e.preventDefault).not.toHaveBeenCalled();
  });
});

// ── Amount field — arrow keys ────────────────────────────────────────────────

describe("handlePaymentKeyDown — amount field arrow keys", () => {
  it("ArrowUp calls preventDefault and focuses prev-row amount", () => {
    const e = makeEvent("ArrowUp");
    handlePaymentKeyDown(e, 2, "amount", 5, vi.fn());

    expect(e.preventDefault).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(querySelector).toHaveBeenCalledWith('[data-testid="input-amount-1"]');
    expect(mockEl.focus).toHaveBeenCalledOnce();
    expect(mockEl.select).toHaveBeenCalledOnce();
  });

  it("ArrowUp on first row calls preventDefault but does NOT query DOM", () => {
    const e = makeEvent("ArrowUp");
    handlePaymentKeyDown(e, 0, "amount", 3, vi.fn());

    expect(e.preventDefault).toHaveBeenCalledOnce();
    vi.runAllTimers();
    // rowIndex 0: no previous row → no querySelector call
    expect(querySelector).not.toHaveBeenCalled();
  });

  it("ArrowDown calls preventDefault and focuses next-row amount", () => {
    const e = makeEvent("ArrowDown");
    handlePaymentKeyDown(e, 1, "amount", 5, vi.fn());

    expect(e.preventDefault).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(querySelector).toHaveBeenCalledWith('[data-testid="input-amount-2"]');
    expect(mockEl.focus).toHaveBeenCalledOnce();
    expect(mockEl.select).toHaveBeenCalledOnce();
  });

  it("ArrowDown on last row calls preventDefault but does NOT query DOM", () => {
    const e = makeEvent("ArrowDown");
    // fieldsLength=3, rowIndex=2 (last)
    handlePaymentKeyDown(e, 2, "amount", 3, vi.fn());

    expect(e.preventDefault).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(querySelector).not.toHaveBeenCalled();
  });

  it("ArrowLeft calls preventDefault and focuses same-row account", () => {
    const e = makeEvent("ArrowLeft");
    handlePaymentKeyDown(e, 1, "amount", 3, vi.fn());

    expect(e.preventDefault).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(querySelector).toHaveBeenCalledWith('[data-testid="input-account-1"]');
    expect(mockEl.focus).toHaveBeenCalledOnce();
    // Note: ArrowLeft does NOT call .select()
  });

  it("ArrowRight calls preventDefault and focuses next-row account", () => {
    const e = makeEvent("ArrowRight");
    handlePaymentKeyDown(e, 0, "amount", 3, vi.fn());

    expect(e.preventDefault).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(querySelector).toHaveBeenCalledWith('[data-testid="input-account-1"]');
    expect(mockEl.focus).toHaveBeenCalledOnce();
  });

  it("ArrowRight on last row calls preventDefault but does NOT query DOM", () => {
    const e = makeEvent("ArrowRight");
    handlePaymentKeyDown(e, 2, "amount", 3, vi.fn());

    expect(e.preventDefault).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(querySelector).not.toHaveBeenCalled();
  });
});

// ── Amount field — Enter / Tab (row advancement) ─────────────────────────────

describe("handlePaymentKeyDown — amount field Enter/Tab row advancement", () => {
  it("Enter on last row calls append and navigates to next account", () => {
    const e = makeEvent("Enter");
    const append = vi.fn();
    handlePaymentKeyDown(e, 2, "amount", 3, append); // row 2 = last of 3

    expect(e.preventDefault).toHaveBeenCalledOnce();
    expect(append).toHaveBeenCalledOnce();
    expect(append).toHaveBeenCalledWith({
      accountType: "ledger",
      accountId: 0,
      accountName: "",
      amount: "",
    });
    vi.runAllTimers();
    // navigates to the newly appended row (rowIndex + 1)
    expect(querySelector).toHaveBeenCalledWith('[data-testid="input-account-3"]');
  });

  it("Enter on non-last row navigates without calling append", () => {
    const e = makeEvent("Enter");
    const append = vi.fn();
    handlePaymentKeyDown(e, 1, "amount", 3, append);

    expect(e.preventDefault).toHaveBeenCalledOnce();
    expect(append).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(querySelector).toHaveBeenCalledWith('[data-testid="input-account-2"]');
  });

  it("Tab on last amount row appends a new row", () => {
    const e = makeEvent("Tab");
    const append = vi.fn();
    handlePaymentKeyDown(e, 0, "amount", 1, append); // only 1 row → last row

    expect(e.preventDefault).toHaveBeenCalledOnce();
    expect(append).toHaveBeenCalledOnce();
  });

  it("Shift+Tab on amount field does nothing (no prevention)", () => {
    const e = makeEvent("Tab", true);
    const append = vi.fn();
    handlePaymentKeyDown(e, 1, "amount", 3, append);

    // Shift+Tab is not handled; no preventDefault, no append
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });
});

// ── querySelector returning null (graceful degradation) ──────────────────────

describe("handlePaymentKeyDown — null DOM element (graceful)", () => {
  it("does not throw when querySelector returns null", () => {
    querySelector.mockReturnValue(null);
    const e = makeEvent("Tab");

    expect(() => {
      handlePaymentKeyDown(e, 0, "account", 3, vi.fn());
      vi.runAllTimers();
    }).not.toThrow();
  });

  it("ArrowDown does not throw when target element is null", () => {
    querySelector.mockReturnValue(null);
    const e = makeEvent("ArrowDown");

    expect(() => {
      handlePaymentKeyDown(e, 0, "amount", 3, vi.fn());
      vi.runAllTimers();
    }).not.toThrow();
  });
});

// ── Keyboard navigation does not break normal typing ─────────────────────────

describe("handlePaymentKeyDown — typing keys pass through unmodified", () => {
  const typingKeys = ["a", "1", ".", "Backspace", "Delete", "Escape", "F1"];

  for (const key of typingKeys) {
    it(`key "${key}" on amount field is not intercepted`, () => {
      const e = makeEvent(key);
      handlePaymentKeyDown(e, 1, "amount", 3, vi.fn());

      expect(e.preventDefault).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(querySelector).not.toHaveBeenCalled();
    });
  }
});
