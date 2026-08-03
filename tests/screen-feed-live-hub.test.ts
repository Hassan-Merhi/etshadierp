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
  });

  it("pushes each frame to every connected viewer", () => {
    const hub = new ScreenFeedLiveHub();
    const firstViewer = vi.fn();
    const secondViewer = vi.fn();
    hub.subscribeFrames("42", firstViewer);
    hub.subscribeFrames("42", secondViewer);

    const frame = buildFrame();
    expect(hub.publishFrame("42", frame)).toBe(2);
    expect(firstViewer).toHaveBeenCalledWith(frame);
    expect(secondViewer).toHaveBeenCalledWith(frame);
  });

  it("pushes pointer updates without forcing another image frame", () => {
    const hub = new ScreenFeedLiveHub();
    const cursorViewer = vi.fn();
    const cursor: ScreenFeedCursor = { x: 0.25, y: 0.75, ts: Date.now(), visible: true };
    hub.subscribeCursors("42", cursorViewer);

    expect(hub.publishCursor("42", cursor)).toBe(1);
    expect(cursorViewer).toHaveBeenCalledWith(cursor);
    expect(hub.publishFrame("42", buildFrame())).toBe(0);
  });

  it("disconnects all active streams when the kill switch runs", () => {
    const hub = new ScreenFeedLiveHub();
    const firstDisconnect = vi.fn();
    const secondDisconnect = vi.fn();
    hub.subscribeDisconnect(firstDisconnect);
    hub.subscribeDisconnect(secondDisconnect);

    hub.disconnectAll();

    expect(firstDisconnect).toHaveBeenCalledTimes(1);
    expect(secondDisconnect).toHaveBeenCalledTimes(1);
  });
});
