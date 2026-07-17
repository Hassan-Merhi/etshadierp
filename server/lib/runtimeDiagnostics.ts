import fs from "fs";
import os from "os";
import path from "path";
import { monitorEventLoopDelay, performance } from "perf_hooks";
import { getHeapStatistics } from "v8";
import { logger } from "./logger";

const MB = 1024 * 1024;
const SAMPLE_INTERVAL_MS = Math.max(5_000, Number(process.env.RUNTIME_DIAGNOSTICS_INTERVAL_MS || 10_000));
const EVENT_LOOP_WARN_MS = Math.max(100, Number(process.env.EVENT_LOOP_WARN_P99_MS || 500));
const MAX_SAMPLES = Math.max(12, Number(process.env.RUNTIME_DIAGNOSTICS_MAX_SAMPLES || 60));
const MAX_REASONABLE_DELAY_MS = 5 * 60 * 1000;

const eventLoop = monitorEventLoopDelay({ resolution: 20 });
eventLoop.enable();

let lastElu = performance.eventLoopUtilization();
let lastEventLoopWarningAt = 0;

interface RuntimeSample {
  timestamp: string;
  rssMb: number;
  heapUsedMb: number;
  externalMb: number;
  arrayBuffersMb: number;
  cgroupCurrentMb: number | null;
  cgroupWorkingSetMb: number | null;
  childRssMb: number;
}

const samples: RuntimeSample[] = [];
const highWater = {
  rssMb: 0,
  heapUsedMb: 0,
  externalMb: 0,
  arrayBuffersMb: 0,
  cgroupCurrentMb: 0,
  cgroupWorkingSetMb: 0,
  childRssMb: 0,
  combinedProcessAndChildrenMb: 0,
};

function safeDelayMs(nanoseconds: number): number {
  const milliseconds = nanoseconds / 1e6;
  if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > MAX_REASONABLE_DELAY_MS) return 0;
  return Math.round(milliseconds * 10) / 10;
}

function readNumericFile(paths: string[]): number | null {
  for (const file of paths) {
    try {
      const raw = fs.readFileSync(file, "utf8").trim();
      if (!raw || raw === "max") continue;
      const value = Number(raw);
      if (Number.isFinite(value) && value >= 0) return value;
    } catch {
      // Try the next cgroup layout.
    }
  }
  return null;
}

function readInactiveFileBytes(): number | null {
  for (const file of ["/sys/fs/cgroup/memory.stat", "/sys/fs/cgroup/memory/memory.stat"]) {
    try {
      const values = new Map<string, number>();
      for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const [key, rawValue] = line.trim().split(/\s+/);
        const value = Number(rawValue);
        if (key && Number.isFinite(value)) values.set(key, value);
      }
      const inactive = values.get("inactive_file") ?? values.get("total_inactive_file");
      if (inactive !== undefined) return Math.max(0, inactive);
    } catch {
      // Try the next cgroup layout.
    }
  }
  return null;
}

function readCgroupMemory() {
  const currentBytes = readNumericFile([
    "/sys/fs/cgroup/memory.current",
    "/sys/fs/cgroup/memory/memory.usage_in_bytes",
  ]);
  const inactiveFileBytes = currentBytes === null ? null : readInactiveFileBytes();
  const workingSetBytes =
    currentBytes === null
      ? null
      : Math.max(0, currentBytes - Math.min(currentBytes, inactiveFileBytes ?? 0));

  return {
    currentMb: currentBytes === null ? null : Math.round(currentBytes / MB),
    inactiveFileMb: inactiveFileBytes === null ? null : Math.round(inactiveFileBytes / MB),
    workingSetMb: workingSetBytes === null ? null : Math.round(workingSetBytes / MB),
  };
}

function readCgroupLimitMb(): number | null {
  const bytes = readNumericFile([
    "/sys/fs/cgroup/memory.max",
    "/sys/fs/cgroup/memory/memory.limit_in_bytes",
  ]);
  if (bytes === null || bytes > 1024 ** 5) return null;
  return Math.round(bytes / MB);
}

interface ProcRecord {
  pid: number;
  ppid: number;
  rssKb: number;
  cmdline: string;
}

function readProcessTree(): Map<number, ProcRecord> {
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
      const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
      const rssMatch = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
      const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").trim();
      records.set(pid, {
        pid,
        ppid: Number.isFinite(ppid) ? ppid : 0,
        rssKb: rssMatch ? Number(rssMatch[1]) : 0,
        cmdline,
      });
    } catch {
      // Process exited during the scan.
    }
  }

  return records;
}

function isDescendant(pid: number, records: Map<number, ProcRecord>): boolean {
  let current = records.get(pid);
  const visited = new Set<number>();
  while (current && current.ppid > 0 && !visited.has(current.pid)) {
    if (current.ppid === process.pid) return true;
    visited.add(current.pid);
    current = records.get(current.ppid);
  }
  return false;
}

function getChildProcessSnapshot() {
  const records = readProcessTree();
  const descendants = Array.from(records.values()).filter((record) => isDescendant(record.pid, records));
  const groups: Record<string, { count: number; rssMb: number }> = {};
  let totalRssKb = 0;

  for (const record of descendants) {
    totalRssKb += record.rssKb;
    const type = /(?:chromium|chrome|google-chrome)/i.test(record.cmdline)
      ? "chrome"
      : /full-export-worker/i.test(record.cmdline)
        ? "exportWorker"
        : "other";
    const group = (groups[type] ||= { count: 0, rssMb: 0 });
    group.count += 1;
    group.rssMb += record.rssKb / 1024;
  }

  for (const group of Object.values(groups)) group.rssMb = Math.round(group.rssMb);

  return {
    count: descendants.length,
    rssMb: Math.round(totalRssKb / 1024),
    groups,
  };
}

function getTempExportDiskSnapshot() {
  let directories = 0;
  let bytes = 0;
  try {
    const tempRoot = os.tmpdir();
    for (const entry of fs.readdirSync(tempRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith("erp-export-")) continue;
      directories += 1;
      const dir = path.join(tempRoot, entry.name);
      for (const child of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!child.isFile()) continue;
        try {
          bytes += fs.statSync(path.join(dir, child.name)).size;
        } catch {
          // File disappeared during scan.
        }
      }
    }
  } catch {
    // Diagnostics must never affect request handling.
  }
  return { directories, bytes, mb: Math.round((bytes / MB) * 10) / 10 };
}

function sampleRuntime(): RuntimeSample {
  const memory = process.memoryUsage();
  const child = getChildProcessSnapshot();
  const cgroup = readCgroupMemory();
  const sample: RuntimeSample = {
    timestamp: new Date().toISOString(),
    rssMb: Math.round(memory.rss / MB),
    heapUsedMb: Math.round(memory.heapUsed / MB),
    externalMb: Math.round(memory.external / MB),
    arrayBuffersMb: Math.round(memory.arrayBuffers / MB),
    cgroupCurrentMb: cgroup.currentMb,
    cgroupWorkingSetMb: cgroup.workingSetMb,
    childRssMb: child.rssMb,
  };

  samples.push(sample);
  while (samples.length > MAX_SAMPLES) samples.shift();

  highWater.rssMb = Math.max(highWater.rssMb, sample.rssMb);
  highWater.heapUsedMb = Math.max(highWater.heapUsedMb, sample.heapUsedMb);
  highWater.externalMb = Math.max(highWater.externalMb, sample.externalMb);
  highWater.arrayBuffersMb = Math.max(highWater.arrayBuffersMb, sample.arrayBuffersMb);
  highWater.cgroupCurrentMb = Math.max(highWater.cgroupCurrentMb, cgroup.currentMb || 0);
  highWater.cgroupWorkingSetMb = Math.max(highWater.cgroupWorkingSetMb, cgroup.workingSetMb || 0);
  highWater.childRssMb = Math.max(highWater.childRssMb, child.rssMb);
  highWater.combinedProcessAndChildrenMb = Math.max(
    highWater.combinedProcessAndChildrenMb,
    sample.rssMb + child.rssMb
  );

  const p99Ms = safeDelayMs(eventLoop.percentile(99));
  if (p99Ms > 0 && p99Ms >= EVENT_LOOP_WARN_MS && Date.now() - lastEventLoopWarningAt >= 60_000) {
    lastEventLoopWarningAt = Date.now();
    logger.warn("High event-loop delay detected", {
      module: "runtime-diagnostics",
      action: "event-loop-delay",
      p99Ms,
      maxMs: safeDelayMs(eventLoop.max),
      memory: sample,
    });
  }

  return sample;
}

sampleRuntime();
const sampleTimer = setInterval(sampleRuntime, SAMPLE_INTERVAL_MS);
sampleTimer.unref();

export function getRuntimeDiagnosticsSnapshot() {
  const memory = process.memoryUsage();
  const heap = getHeapStatistics();
  const child = getChildProcessSnapshot();
  const elu = performance.eventLoopUtilization(lastElu);
  lastElu = performance.eventLoopUtilization();
  const cgroup = readCgroupMemory();
  const cgroupLimitMb = readCgroupLimitMb();
  const resourceUsage = process.resourceUsage();

  return {
    sampledAt: new Date().toISOString(),
    eventLoop: {
      minMs: safeDelayMs(eventLoop.min),
      meanMs: safeDelayMs(eventLoop.mean),
      p50Ms: safeDelayMs(eventLoop.percentile(50)),
      p95Ms: safeDelayMs(eventLoop.percentile(95)),
      p99Ms: safeDelayMs(eventLoop.percentile(99)),
      maxMs: safeDelayMs(eventLoop.max),
      utilizationPercent: Math.round(elu.utilization * 10_000) / 100,
    },
    memory: {
      rssMb: Math.round(memory.rss / MB),
      heapUsedMb: Math.round(memory.heapUsed / MB),
      heapTotalMb: Math.round(memory.heapTotal / MB),
      externalMb: Math.round(memory.external / MB),
      arrayBuffersMb: Math.round(memory.arrayBuffers / MB),
      heapLimitMb: Math.round(heap.heap_size_limit / MB),
      mallocedMb: Math.round(heap.malloced_memory / MB),
      peakMallocedMb: Math.round(heap.peak_malloced_memory / MB),
      processMaxRssMb: Math.round(resourceUsage.maxRSS / 1024),
      cgroupCurrentMb: cgroup.currentMb,
      cgroupInactiveFileMb: cgroup.inactiveFileMb,
      cgroupWorkingSetMb: cgroup.workingSetMb,
      cgroupLimitMb,
      cgroupUtilizationPercent:
        cgroup.workingSetMb !== null && cgroupLimitMb
          ? Math.round((cgroup.workingSetMb / cgroupLimitMb) * 1000) / 10
          : null,
    },
    children: child,
    tempExports: getTempExportDiskSnapshot(),
    highWater: { ...highWater },
    active: {
      handles: typeof (process as any)._getActiveHandles === "function" ? (process as any)._getActiveHandles().length : null,
      requests: typeof (process as any)._getActiveRequests === "function" ? (process as any)._getActiveRequests().length : null,
    },
    recentSamples: samples.slice(-12),
  };
}
