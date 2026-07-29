export interface CompanySwitchQueue {
  enqueue<T>(task: () => Promise<T>): Promise<T>;
  isBusy(): boolean;
}

/**
 * Serializes company-session writes. Without serialization, two rapid switches
 * can reach the server out of order and leave the browser showing one company
 * while the session is scoped to another.
 */
export function createCompanySwitchQueue(onBusyChange?: (busy: boolean) => void): CompanySwitchQueue {
  let tail: Promise<void> = Promise.resolve();
  let queuedTasks = 0;

  return {
    enqueue<T>(task: () => Promise<T>): Promise<T> {
      queuedTasks += 1;
      if (queuedTasks === 1) onBusyChange?.(true);

      const result = tail.then(task);
      tail = result.then(
        () => undefined,
        () => undefined,
      );

      return result.finally(() => {
        queuedTasks -= 1;
        if (queuedTasks === 0) onBusyChange?.(false);
      });
    },

    isBusy(): boolean {
      return queuedTasks > 0;
    },
  };
}
