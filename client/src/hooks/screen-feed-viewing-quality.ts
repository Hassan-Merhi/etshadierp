export interface NormalizedScreenFeedPoint {
  x: number;
  y: number;
}

export function clampScreenFeedCoordinate(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function normalizeScreenFeedPoint(
  clientX: number,
  clientY: number,
  viewportWidth: number,
  viewportHeight: number,
): NormalizedScreenFeedPoint {
  const safeWidth = Math.max(1, viewportWidth);
  const safeHeight = Math.max(1, viewportHeight);
  return {
    x: clampScreenFeedCoordinate(clientX / safeWidth),
    y: clampScreenFeedCoordinate(clientY / safeHeight),
  };
}

export function getScreenFeedCaptureScale(devicePixelRatio: number): number {
  if (!Number.isFinite(devicePixelRatio)) return 1;
  return Math.min(1.25, Math.max(1, devicePixelRatio));
}

export function isSafeScreenFeedAssetUrl(value: string, origin: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("data:") || trimmed.startsWith("blob:")) return true;

  try {
    const parsed = new URL(trimmed, origin);
    return parsed.origin === origin;
  } catch {
    return false;
  }
}

export function extractScreenFeedCssUrls(value: string): string[] {
  const urls: string[] = [];
  const pattern = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    if (match[2]) urls.push(match[2]);
  }
  return urls;
}

export function shouldPreserveScreenFeedBackground(value: string, origin: string): boolean {
  if (!value || value === "none") return true;
  const urls = extractScreenFeedCssUrls(value);
  return urls.length === 0 || urls.every((url) => isSafeScreenFeedAssetUrl(url, origin));
}

export function approximateDataUrlBytes(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(",");
  const payloadLength = commaIndex >= 0 ? dataUrl.length - commaIndex - 1 : dataUrl.length;
  return Math.max(0, Math.floor((payloadLength * 3) / 4));
}
