import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

const runtimeSource = read("server/services/remoteSupportRuntime.ts");
const transportSource = read("server/routes/screenFeedTransportHardening.ts");
const routesSource = read("server/routes/applicationRoutes.ts");
const viewerSource = read("client/src/pages/settings/WatchUserDialog.tsx");
const captureSource = read("client/src/hooks/use-screen-feed.ts");
const capturePolicySource = read("client/src/hooks/screen-feed-capture-policy.ts");

describe("Phase 5 faster remote viewing contracts", () => {
  it("keeps fast mode disabled by default", () => {
    expect(runtimeSource).toMatch(/fastScreenFeed:\s*false/);
  });

  it("supports conditional polling without retransmitting unchanged frames", () => {
    expect(transportSource).toContain('res.setHeader("ETag", etag)');
    expect(transportSource).toContain('req.headers["if-none-match"]');
    expect(transportSource).toContain("res.status(304).end()");
    expect(transportSource).toContain('res.setHeader("X-Screen-Feed-Transport"');
  });

  it("adds reconnect jitter, payload limits, and producer backpressure", () => {
    expect(transportSource).toContain("MAX_RECONNECT_JITTER_MS");
    expect(transportSource).toContain("FAST_MAX_FRAME_SIZE = 900_000");
    expect(transportSource).toContain("LEGACY_MAX_FRAME_SIZE = 1_500_000");
    expect(transportSource).toContain("res.status(413)");
    expect(transportSource).toContain('res.setHeader("Retry-After"');
    expect(transportSource).toContain("res.status(429)");
  });

  it("registers hardening before the existing screen-feed routes", () => {
    const hardeningIndex = routesSource.indexOf("registerScreenFeedTransportHardening(app)");
    const screenFeedIndex = routesSource.indexOf("registerScreenFeedRoutes(app)");
    expect(hardeningIndex).toBeGreaterThan(-1);
    expect(screenFeedIndex).toBeGreaterThan(hardeningIndex);
  });

  it("cleans up watched-user switches while retaining polling fallback", () => {
    expect(viewerSource).toContain("eventSource?.close()");
    expect(viewerSource).toContain("[streamGeneration, userId]");
    expect(viewerSource).toContain("refetchInterval: liveConnected ? false : 3000");
    expect(viewerSource).toContain("setLiveFrame(null)");
    expect(viewerSource).toContain("setLiveCursor(null)");
  });

  it("keeps client-side serialization while making full-frame capture dirty-driven", () => {
    expect(captureSource).toContain("busyRef.current");
    expect(captureSource).toContain("new MutationObserver");
    expect(captureSource).toContain("document.visibilityState !== \"visible\"");
    expect(captureSource).toContain("ACTIVE_CAPTURE_MIN_GAP_MS");
    expect(captureSource).toContain("IDLE_REFRESH_MS");
    expect(captureSource).toContain("FAILED_CAPTURE_BACKOFF_MS");
    expect(captureSource).toContain("markDirty(");
    expect(captureSource).toContain("startFallbackPolling()");
    expect(captureSource).toContain("eventSource?.close()");
  });

  it("prevents the old sub-second continuous full-frame capture loop from returning", () => {
    expect(capturePolicySource).toContain("ACTIVE_CAPTURE_MIN_GAP_MS = 850");
    expect(capturePolicySource).toContain("IDLE_REFRESH_MS = 60000");
    expect(capturePolicySource).not.toContain("ACTIVE_CAPTURE_DELAY_MS = 150");
  });
});
