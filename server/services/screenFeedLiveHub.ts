import type { ScreenFrame } from "../screenFeedStore";

type StatusListener = () => void;
type FrameListener = (frame: ScreenFrame) => void;
type DisconnectListener = () => void;

export class ScreenFeedLiveHub {
  private readonly statusListeners = new Map<string, Set<StatusListener>>();
  private readonly frameListeners = new Map<string, Set<FrameListener>>();
  private readonly disconnectListeners = new Set<DisconnectListener>();

  subscribeStatus(userId: string, listener: StatusListener): () => void {
    const listeners = this.statusListeners.get(userId) ?? new Set<StatusListener>();
    listeners.add(listener);
    this.statusListeners.set(userId, listeners);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.statusListeners.delete(userId);
    };
  }

  subscribeFrames(userId: string, listener: FrameListener): () => void {
    const listeners = this.frameListeners.get(userId) ?? new Set<FrameListener>();
    listeners.add(listener);
    this.frameListeners.set(userId, listeners);
    this.notifyStatus(userId);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.frameListeners.delete(userId);
      this.notifyStatus(userId);
    };
  }

  subscribeDisconnect(listener: DisconnectListener): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  hasViewer(userId: string): boolean {
    return (this.frameListeners.get(userId)?.size ?? 0) > 0;
  }

  publishFrame(userId: string, frame: ScreenFrame): number {
    const listeners = this.frameListeners.get(userId);
    if (!listeners?.size) return 0;

    let delivered = 0;
    for (const listener of listeners) {
      try {
        listener(frame);
        delivered += 1;
      } catch {
        // A broken stream is cleaned up by its request close handler.
      }
    }
    return delivered;
  }

  notifyStatus(userId: string): void {
    const listeners = this.statusListeners.get(userId);
    if (!listeners?.size) return;

    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // A broken stream is cleaned up by its request close handler.
      }
    }
  }

  disconnectAll(): void {
    for (const disconnect of [...this.disconnectListeners]) {
      try {
        disconnect();
      } catch {
        // A request may already have closed while the kill switch was running.
      }
    }
  }

  clear(): void {
    this.disconnectAll();
    this.frameListeners.clear();
    this.statusListeners.clear();
    this.disconnectListeners.clear();
  }
}

export const screenFeedLiveHub = new ScreenFeedLiveHub();
