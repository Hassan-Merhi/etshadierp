/**
 * puppeteerSemaphore.ts — Global Puppeteer concurrency gate.
 *
 * Guarantees at most MAX_CONCURRENT Puppeteer browser/page operations run
 * simultaneously across the entire server process.  Both the Maersk scraper
 * and the ParcelsApp scraper must acquire a slot before doing any browser
 * work, keeping peak Chrome memory predictable regardless of how many
 * concurrent "Track Now" clicks or scheduler runs are in flight.
 *
 * Usage:
 *   const release = await acquirePuppeteerSlot();
 *   try { ... puppeteer work ... } finally { release(); }
 */

// Allow at most 1 Puppeteer browser operation at a time.
// Each headless Chrome instance uses ~300-600 MB; on a 2 GB host that means
// a hard cap of 1 (leaving ~1 GB for Node, Express, PG, etc.).
const MAX_CONCURRENT = 1;

let _running = 0;
let _queue: Array<() => void> = [];

export function acquirePuppeteerSlot(): Promise<() => void> {
  return new Promise((resolve) => {
    function tryGrab() {
      if (_running < MAX_CONCURRENT) {
        _running++;
        resolve(() => {
          _running--;
          if (_queue.length > 0) {
            const next = _queue.shift()!;
            next();
          }
        });
      } else {
        _queue.push(tryGrab);
      }
    }
    tryGrab();
  });
}

/** How many slots are currently in use (0 or 1). */
export function puppeteerSlotsBusy(): number {
  return _running;
}

/** How many callers are waiting for a slot. */
export function puppeteerQueueDepth(): number {
  return _queue.length;
}
