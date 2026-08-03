import { describe, expect, it, vi } from "vitest";
import type { ScreenFeedCursor, ScreenFrame } from "../server/screenFeedStore";
import { ScreenFeedLiveHub } from "../server/services/screenFeedLiveHub";

function buildFrame(): ScreenFrame {
  return {
    dataUrl: "data:image/jpeg;base64,abc",
    capturedAt: new Date("2026-08-03T10:00:00.000Z"),
    userId: "42",
    username: "employee",
    clicks: [],
  };
}

describe("screen feed live hub", () => {
  it("notifies status listeners when a viewer connects and disconnects", () => {
    const hub = new ScreenFeedLiveHub();
    const statusListener = vi.fn();
    const unsubscribeStatus = hub.subscribeStatus("42", statusListener);

    const unsubscribeFrames = hub.subscribeFrames("42", vi.fn());
    expect(hub.hasViewer("42")).toBe(true);
    expect(statusListener).toHaveBeenCalledTimes(1);

    unsubscribeFrames();
    expect(hub.hasViewer("42")).toBe(false);
    expect(statusListener).toHaveBeenCalledTimes(2);

    unsubscribeStatus();
    hub.notifyStatus("42");
    expect(statusListener).toHaveBeenCalledTimes(2);
  });

  it("pushes each frame to every connected viewer", () => {
    const hub = new ScreenFeedLiveHub();
    const firstViewer = vi.fn();
    const secondViewer = vi.fn();
    const unsubscribeFirst = hub.subscribeFrames("42", firstViewer);
    hub.subscribeFrames("42", secondViewer);

    const frame = buildFrame();
    expect(hub.publishFrame("42", frame)).toBe(2);
    expect(firstViewer).toHaveBeenCalledWith(frame);
    expect(secondViewer).toHaveBeenCalledWith(frame);

    unsubscribeFirst();
    expect(hub.publishFrame("42", frame)).toBe(1);
    expect(hub.publishFrame("missing", frame)).toBe(0);
  });

  it("isolates broken frame listeners", () => {
    const hub = new ScreenFeedLiveHub();
    const healthyViewer = vi.fn();
    hub.subscribeFrames("42", () => {
      throw new Error("closed stream");
    });
    hub.subscribeFrames("42", healthyViewer);

    expect(hub.publishFrame("42", buildFrame())).toBe(1);
    expect(healthyViewer).toHaveBeenCalledTimes(1);
  });

  it("pushes pointer updates without forcing another image frame", () => {
    const hub = new ScreenFeedLiveHub();
    const cursorViewer = vi.fn();
    const cursor: ScreenFeedCursor = { x: 0.25, y: 0.75, ts: Date.now(), visible: true };
    const unsubscribeCursor = hub.subscribeCursors("42", cursorViewer);

    expect(hub.publishCursor("42", cursor)).toBe(1);
    expect(cursorViewer).toHaveBeenCalledWith(cursor);
    expect(hub.publishFrame("42", buildFrame())).toBe(0);

    unsubscribeCursor();
    expect(hub.publishCursor("42", cursor)).toBe(0);
    expect(hub.publishCursor("missing", cursor)).toBe(0);
  });

  it("isolates broken pointer and status listeners", () => {
    const hub = new ScreenFeedLiveHub();
    const cursor: ScreenFeedCursor = { x: 0.25, y: 0.75, ts: Date.now(), visible: true };
    const healthyCursorViewer = vi.fn();
    const healthyStatusListener = vi.fn();

    hub.subscribeCursors("42", () => {
      throw new Error("closed stream");
    });
    hub.subscribeCursors("42", healthyCursorViewer);
    hub.subscribeStatus("42", () => {
      throw new Error("closed stream");
    });
    hub.subscribeStatus("42", healthyStatusListener);

    expect(hub.publishCursor("42", cursor)).toBe(1);
    expect(healthyCursorViewer).toHaveBeenCalledWith(cursor);
    expect(() => hub.notifyStatus("42")).not.toThrow();
    expect(healthyStatusListener).toHaveBeenCalledTimes(1);
  });

  it("disconnects all active streams when the kill switch runs", () => {
    const hub = new ScreenFeedLiveHub();
    const firstDisconnect = vi.fn();
    const secondDisconnect = vi.fn();
    const unsubscribeFirst = hub.subscribeDisconnect(firstDisconnect);
    hub.subscribeDisconnect(secondDisconnect);

    unsubscribeFirst();
    hub.disconnectAll();

    expect(firstDisconnect).not.toHaveBeenCalled();
    expect(secondDisconnect).toHaveBeenCalledTimes(1);
  });

  it("isolates broken disconnect callbacks and clears every listener", () => {
    const hub = new ScreenFeedLiveHub();
    const healthyDisconnect = vi.fn();
    hub.subscribeFrames("42", vi.fn());
    hub.subscribeCursors("42", vi.fn());
    hub.subscribeStatus("42", vi.fn());
    hub.subscribeDisconnect(() => {
      throw new Error("already closed");
    });
    hub.subscribeDisconnect(healthyDisconnect);

    expect(() => hub.clear()).not.toThrow();
    expect(healthyDisconnect).toHaveBeenCalledTimes(1);
    expect(hub.hasViewer("42")).toBe(false);
    expect(hub.publishFrame("42", buildFrame())).toBe(0);
  });
});
