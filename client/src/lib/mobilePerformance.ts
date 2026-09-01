export interface BrowserConnectionProfile {
  saveData: boolean;
  effectiveType: string;
  slowConnection: boolean;
}

type NetworkInformationLike = EventTarget & {
  saveData?: boolean;
  effectiveType?: string;
};

export function getBrowserConnection(): NetworkInformationLike | null {
  if (typeof navigator === "undefined") return null;
  const candidate = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  return candidate ?? null;
}

export function getBrowserConnectionProfile(): BrowserConnectionProfile {
  const connection = getBrowserConnection();
  const effectiveType = connection?.effectiveType || "unknown";
  const saveData = connection?.saveData === true;
  return {
    saveData,
    effectiveType,
    slowConnection: saveData || effectiveType === "slow-2g" || effectiveType === "2g",
  };
}

export function isDocumentVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

export function getConnectivityPollDelay(options: { isOnline: boolean; visible?: boolean }): number {
  const visible = options.visible ?? isDocumentVisible();
  const { slowConnection } = getBrowserConnectionProfile();

  if (!visible) return options.isOnline ? 5 * 60_000 : 2 * 60_000;
  if (!options.isOnline) return 30_000;
  return slowConnection ? 2 * 60_000 : 60_000;
}

export function getQueueRefreshDelay(visible = isDocumentVisible()): number {
  const { slowConnection } = getBrowserConnectionProfile();
  if (!visible) return 5 * 60_000;
  return slowConnection ? 2 * 60_000 : 60_000;
}

export function runWhenIdle(callback: () => void, timeout = 1_500): () => void {
  if (typeof window === "undefined") {
    callback();
    return () => {};
  }

  const idleWindow = window as Window & {
    requestIdleCallback?: (cb: IdleRequestCallback, options?: IdleRequestOptions) => number;
    cancelIdleCallback?: (id: number) => void;
  };

  if (typeof idleWindow.requestIdleCallback === "function") {
    const id = idleWindow.requestIdleCallback(() => callback(), { timeout });
    return () => idleWindow.cancelIdleCallback?.(id);
  }

  const id = window.setTimeout(callback, Math.min(timeout, 250));
  return () => window.clearTimeout(id);
}
