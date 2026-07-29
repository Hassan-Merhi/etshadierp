import { createCompanySwitchQueue } from "@/lib/companySwitchQueue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("company switch queue", () => {
  it("serializes rapid switches so server session writes cannot finish out of order", async () => {
    const busy: boolean[] = [];
    const events: string[] = [];
    const firstGate = deferred<void>();
    const queue = createCompanySwitchQueue((value) => busy.push(value));

    const first = queue.enqueue(async () => {
      events.push("first-start");
      await firstGate.promise;
      events.push("first-end");
      return "first";
    });
    const second = queue.enqueue(async () => {
      events.push("second-start");
      events.push("second-end");
      return "second";
    });

    await Promise.resolve();
    expect(events).toEqual(["first-start"]);
    expect(queue.isBusy()).toBe(true);
    expect(busy).toEqual([true]);

    firstGate.resolve();
    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");

    expect(events).toEqual(["first-start", "first-end", "second-start", "second-end"]);
    expect(queue.isBusy()).toBe(false);
    expect(busy).toEqual([true, false]);
  });

  it("continues with the next switch after an earlier switch fails", async () => {
    const events: string[] = [];
    const queue = createCompanySwitchQueue();

    const failed = queue.enqueue(async () => {
      events.push("failed-start");
      throw new Error("server rejected switch");
    });
    const next = queue.enqueue(async () => {
      events.push("next-start");
      return 2;
    });

    await expect(failed).rejects.toThrow("server rejected switch");
    await expect(next).resolves.toBe(2);
    expect(events).toEqual(["failed-start", "next-start"]);
  });
});
