/**
 * Global Puppeteer concurrency and lifecycle gate.
 *
 * At most one browser operation may run. Waiting callers are bounded, new
 * browser work is refused during memory pressure, and Chromium processes
 * launched by this Node process are terminated after an idle period. The
 * scrapers already detect browser disconnection and recreate the shared browser
 * on the next request.
 */

import fs from "fs";
import { logger } from "./logger";
import { getResourceGuardSnapshot } from "./resourceGuard";

const MAX_CONCURRENT = 1;
const MAX_QUEUE_DEPTH = Math.max(1, Number(process.env.PUPPETEER_MAX_QUEUE_DEPTH || 6));
const IDLE_SHUTDOWN_MS = Math.max(60_000, Number(process.env.PUPPETEER_IDLE_SHUTDOWN_MS || 5 * 60 * 1000));
const REAPER_INTERVAL_MS = Math.max(30_000, Number(process.env.PUPPETEER_REAPER_INTERVAL_MS || 60_000));

let _running = 0;
const _queue: Array<() => void> = [];
let _lastActivityAt = Date.now();
let _reaperRunning = false;

function touchActivity(): void {
  _lastActivityAt = Date.now();
}

export function acquirePuppeteerSlot(): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const guard = getResourceGuardSnapshot();
    if (
      guard.draining ||
      guard.memory.level === "critical" ||
      guard.memory.level === "hard"
    ) {
      logger.warn("Puppeteer request rejected during memory pressure", {
        module: "puppeteer-semaphore",
        action: "memory-reject",
        memory: guard.memory,
      });
      return reject(new Error("PUPPETEER_QUEUE_FULL"));
    }

    if (_running >= MAX_CONCURRENT && _queue.length >= MAX_QUEUE_DEPTH) {
      return reject(new Error("PUPPETEER_QUEUE_FULL"));
    }

    function tryGrab() {
      if (_running < MAX_CONCURRENT) {
        _running++;
        touchActivity();
        let released = false;

        resolve(() => {
          if (released) return;
          released = true;
          _running = Math.max(0, _running - 1);
          touchActivity();
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

export function puppeteerLastActivityAt(): number {
  return _lastActivityAt;
}

interface ProcRecord {
  pid: number;
  ppid: number;
  cmdline: string;
  rssKb: number;
}

function readLinuxProcesses(): Map<number, ProcRecord> {
  const records = new Map<number, ProcRecord>();
  if (process.platform !== "linux") return records;

  let entries: string[] = [];
  try {
    entries = fs.readdirSync("/proc");
  } catch {
    return records;
  }

  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const closeParen = stat.lastIndexOf(")");
      if (closeParen < 0) continue;
      const fields = stat.slice(closeParen + 2).trim().split(/\s+/);
      const ppid = Number(fields[1]);
      const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").trim();
      const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
      const rssMatch = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
      records.set(pid, {
        pid,
        ppid: Number.isFinite(ppid) ? ppid : 0,
        cmdline,
        rssKb: rssMatch ? Number(rssMatch[1]) : 0,
      });
    } catch {
      // Process exited while /proc was being read.
    }
  }

  return records;
}

function isDescendantOfCurrentProcess(pid: number, records: Map<number, ProcRecord>): boolean {
  let current = records.get(pid);
  const visited = new Set<number>();

  while (current && current.ppid > 0 && !visited.has(current.pid)) {
    if (current.ppid === process.pid) return true;
    visited.add(current.pid);
    current = records.get(current.ppid);
  }

  return false;
}

function findOwnedChromeProcesses(): ProcRecord[] {
  const records = readLinuxProcesses();
  return Array.from(records.values()).filter((record) => {
    if (!record.cmdline) return false;
    const isChrome = /(?:chromium|chrome|google-chrome)/i.test(record.cmdline);
    return isChrome && isDescendantOfCurrentProcess(record.pid, records);
  });
}

async function reapIdleChrome(): Promise<void> {
  if (_reaperRunning || process.platform !== "linux") return;
  if (_running > 0 || _queue.length > 0) {
    touchActivity();
    return;
  }
  if (Date.now() - _lastActivityAt < IDLE_SHUTDOWN_MS) return;

  _reaperRunning = true;
  try {
    const chromeProcesses = findOwnedChromeProcesses();
    if (chromeProcesses.length === 0) return;

    const totalRssMb = Math.round(chromeProcesses.reduce((sum, proc) => sum + proc.rssKb, 0) / 1024);
    logger.info("Stopping idle Puppeteer Chrome processes", {
      module: "puppeteer-semaphore",
      action: "idle-shutdown",
      processCount: chromeProcesses.length,
      totalRssMb,
      idleMs: Date.now() - _lastActivityAt,
    });

    // Children first, then the browser parent. The scraper's disconnected event
    // clears its shared browser handle so the next request relaunches cleanly.
    for (const proc of chromeProcesses.sort((a, b) => b.pid - a.pid)) {
      try {
        process.kill(proc.pid, "SIGTERM");
      } catch {
        // Already exited.
      }
    }

    const killTimer = setTimeout(() => {
      for (const proc of chromeProcesses) {
        try {
          process.kill(proc.pid, 0);
          process.kill(proc.pid, "SIGKILL");
        } catch {
          // Exited after SIGTERM.
        }
      }
    }, 5_000);
    killTimer.unref();
    touchActivity();
  } finally {
    _reaperRunning = false;
  }
}

const reaperTimer = setInterval(() => {
  void reapIdleChrome();
}, REAPER_INTERVAL_MS);
reaperTimer.unref();
