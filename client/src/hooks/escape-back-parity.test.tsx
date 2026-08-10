import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGlobalScrollKeys } from "@/app/useGlobalScrollKeys";
import { installErpNavigationHistory } from "@/lib/erp-navigation-history";
import { useEscapeBack } from "./use-escape-back";

let cleanupHistory: (() => void) | null = null;

beforeEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/daybook?date=2026-08-10&tab=vouchers");

  const main = document.createElement("div");
  main.id = "main-content";
  document.body.appendChild(main);

  cleanupHistory = installErpNavigationHistory();
  window.history.pushState({}, "", "/voucher-detail/123?from=daybook");
});

afterEach(() => {
  cleanup();
  cleanupHistory?.();
  cleanupHistory = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Escape / Back parity", () => {
  it("uses exact ERP history before a page-specific Escape fallback", () => {
    const fallback = vi.fn();
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    renderHook(() => useEscapeBack(fallback));

    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(back).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });

  it("keeps open overlays ahead of ERP Back", () => {
    const fallback = vi.fn();
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const dialog = document.createElement("div");
    dialog.dataset.state = "open";
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);

    renderHook(() => useEscapeBack(fallback));

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      })
    );

    expect(back).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });

  it("keeps app-level Escape on exact ERP Back even with a focused input", () => {
    const handleGoBack = vi.fn();
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    renderHook(() => {
      useEscapeBack(handleGoBack);
      useGlobalScrollKeys(handleGoBack);
    });

    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(back).toHaveBeenCalledTimes(1);
    expect(handleGoBack).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });
});
