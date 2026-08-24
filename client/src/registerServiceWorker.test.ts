import { afterEach, describe, expect, it, vi } from "vitest";

const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  if (originalServiceWorker) {
    Object.defineProperty(navigator, "serviceWorker", originalServiceWorker);
  } else {
    delete (navigator as Navigator & { serviceWorker?: unknown }).serviceWorker;
  }
});

describe("service worker registration", () => {
  it("uses the no-cache registration and falls back for older implementations", async () => {
    const register = vi
      .fn()
      .mockRejectedValueOnce(new Error("updateViaCache unsupported"))
      .mockResolvedValueOnce(undefined);

    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register },
    });

    await import("./registerServiceWorker");
    window.dispatchEvent(new Event("load"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(register).toHaveBeenNthCalledWith(1, "/sw.js", { updateViaCache: "none" });
    expect(register).toHaveBeenNthCalledWith(2, "/sw.js");
  });
});
