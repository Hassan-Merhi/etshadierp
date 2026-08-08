import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const html2canvas = vi.fn();
vi.mock("html2canvas", () => ({ default: (...args: unknown[]) => html2canvas(...args) }));

import { captureAndUploadScreenFrame } from "./screen-feed-capture-engine";

/**
 * jsdom ships no 2D canvas implementation, so the engine is exercised against a
 * stub that reproduces the one browser behaviour this suite is about: a canvas
 * that consumed tainted pixels refuses both getImageData and toDataURL.
 */
const taintedCanvases = new WeakSet<HTMLCanvasElement>();

function securityError(): DOMException {
  return new DOMException("Tainted canvases may not be exported.", "SecurityError");
}

function stubContext(owner: HTMLCanvasElement): CanvasRenderingContext2D {
  return {
    canvas: owner,
    fillStyle: "",
    font: "",
    imageSmoothingEnabled: true,
    imageSmoothingQuality: "high",
    clearRect: () => undefined,
    fillRect: () => undefined,
    fillText: () => undefined,
    drawImage: (source: unknown) => {
      if (source instanceof HTMLCanvasElement && taintedCanvases.has(source)) taintedCanvases.add(owner);
    },
    getImageData: () => {
      if (taintedCanvases.has(owner)) throw securityError();
      return { data: new Uint8ClampedArray(32 * 18 * 4) };
    },
  } as unknown as CanvasRenderingContext2D;
}

function installCanvasStubs(): void {
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    return stubContext(this);
  } as unknown as HTMLCanvasElement["getContext"];

  HTMLCanvasElement.prototype.toDataURL = function (this: HTMLCanvasElement) {
    if (taintedCanvases.has(this)) throw securityError();
    return "data:image/jpeg;base64,AAAA";
  };
}

function makeCanvas(width: number, height: number, tainted: boolean): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  if (tainted) taintedCanvases.add(canvas);
  return canvas;
}

function captureOnce(fetchMock: ReturnType<typeof vi.fn>) {
  return captureAndUploadScreenFrame({
    fast: false,
    lastSignature: null,
    lastUploadedClickTs: 0,
    cursor: null,
    expectedPath: window.location.href,
    clicks: [],
    scrollElements: [],
    shouldContinue: () => true,
  }).then((result) => {
    // Development tracing also uses fetch, so pick the actual frame upload.
    const upload = fetchMock.mock.calls.find(
      (call) => call[0] === "/api/screen-feed" && (call[1] as { method?: string } | undefined)?.method === "POST"
    );
    const body = JSON.parse((upload?.[1] as { body: string } | undefined)?.body ?? "{}");
    return { result, body };
  });
}

describe("screen feed capture engine", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    installCanvasStubs();
    (globalThis as { CanvasRenderingContext2D?: unknown }).CanvasRenderingContext2D = class {
      createPattern() {
        return null;
      }
    };
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);
    html2canvas.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("never renders through foreignObject, whose output cannot be encoded", async () => {
    html2canvas.mockResolvedValue(makeCanvas(1200, 800, false));
    await captureOnce(fetchMock);

    const options = html2canvas.mock.calls[0]?.[1] as { foreignObjectRendering?: boolean };
    expect(options.foreignObjectRendering).toBe(false);
  });

  it("uploads a normal capture as a dom frame", async () => {
    html2canvas.mockResolvedValue(makeCanvas(1200, 800, false));
    const { result, body } = await captureOnce(fetchMock);

    expect(result.uploaded).toBe(true);
    expect(result.failed).toBe(false);
    expect(result.failureStage).toBeUndefined();
    expect(result.failureReason).toBeUndefined();
    expect(body.capture.source).toBe("dom");
    expect(body.capture.failureReason).toBeUndefined();
  });

  it("still delivers a frame, with the reason, when the rendered canvas cannot be encoded", async () => {
    html2canvas.mockResolvedValue(makeCanvas(1200, 800, true));
    const { result, body } = await captureOnce(fetchMock);

    // The watcher must never be left on an empty viewer with no explanation
    // while the watched browser silently re-renders the page forever.
    expect(result.uploaded).toBe(true);
    expect(result.failed).toBe(false);
    expect(body.capture.source).toBe("fallback");
    expect(String(body.capture.failureReason)).toContain("Tainted");
    expect(String(body.dataUrl)).toMatch(/^data:image\//);
  });

  it("returns an encode failure when even the fallback canvas cannot be exported", async () => {
    HTMLCanvasElement.prototype.toDataURL = function () {
      throw securityError();
    };
    html2canvas.mockResolvedValue(makeCanvas(1200, 800, false));

    const { result } = await captureOnce(fetchMock);

    expect(result.uploaded).toBe(false);
    expect(result.failed).toBe(true);
    expect(result.failureStage).toBe("encode");
    expect(result.failureReason).toContain("Tainted");
  });

  it("returns the upload status when the server rejects a frame", async () => {
    html2canvas.mockResolvedValue(makeCanvas(1200, 800, false));
    fetchMock.mockResolvedValue({ ok: false, status: 413 });

    const { result } = await captureOnce(fetchMock);

    expect(result.uploaded).toBe(false);
    expect(result.failed).toBe(true);
    expect(result.failureStage).toBe("upload");
    expect(result.failureReason).toBe("Screen frame upload rejected (413).");
  });

  it("reports how long the capture cost so the caller can pace itself", async () => {
    html2canvas.mockResolvedValue(makeCanvas(1200, 800, false));
    const { result } = await captureOnce(fetchMock);

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(result.durationMs)).toBe(true);
  });
});
