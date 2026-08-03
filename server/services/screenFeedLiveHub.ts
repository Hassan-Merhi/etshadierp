import type { ScreenFrame } from "../screenFeedStore";

type StatusListener = () => void;
type FrameListener = (frame: ScreenFrame) => void;

export class ScreenFeedLiveHub {
  private readonly statusListeners = new Map<string, Set<StatusListener>>();
  private readonly frameListeners = new Map<string, Set<FrameListener>>();

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

  clear(): void {
    const userIds = new Set([...this.statusListeners.keys(), ...this.frameListeners.keys()]);
    this.frameListeners.clear();
    for (const userId of userIds) this.notifyStatus(userId);
    this.statusListeners.clear();
  }
}

export const screenFeedLiveHub = new ScreenFeedLiveHub();
