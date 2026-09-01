import { AsyncLocalStorage } from "node:async_hooks";

export type RuntimePerformanceKind = "background" | "dependency";

export interface RuntimePerformanceSample {
  timestamp: number;
  kind: RuntimePerformanceKind;
  name: string;
  durationMs: number;
  failed: boolean;
  source: string;
}

function finiteConfig(name: string, fallback: number, minimum: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback;
}

const WINDOW_MS = finiteConfig("PERFORMANCE_DASHBOARD_WINDOW_MS", 15 * 60_000, 60_000);
const MAX_SAMPLES = finiteConfig("PERFORMANCE_DASHBOARD_RUNTIME_MAX_SAMPLES", 2_000, 100);
const samples: RuntimePerformanceSample[] = [];
const failureContext = new AsyncLocalStorage<{ failed: boolean }>();

export async function captureRuntimeFailures<T>(operation: () => Promise<T> | T): Promise<{ result: T; failed: boolean }> {
  const state = { failed: false };
  const result = await failureContext.run(state, operation);
  return { result, failed: state.failed };
}

export function markRuntimeFailure(): void {
  const state = failureContext.getStore();
  if (state) state.failed = true;
}

function prune(now = Date.now()): void {
  const cutoff = now - WINDOW_MS;
  while (samples.length && samples[0].timestamp < cutoff) samples.shift();
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
}

function percentile(values: number[], ratio: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))]);
}

export function recordRuntimePerformance(input: Omit<RuntimePerformanceSample, "timestamp">): void {
  samples.push({ ...input, name: input.name.slice(0, 120), timestamp: Date.now() });
  prune();
}

export function getRuntimePerformanceSnapshot() {
  prune();
  const groups = new Map<string, RuntimePerformanceSample[]>();
  for (const sample of samples) {
    const key = `${sample.kind}:${sample.name}`;
    const current = groups.get(key) || [];
    current.push(sample);
    groups.set(key, current);
  }

  const rows = [...groups.values()].map((group) => ({
    kind: group[0].kind,
    name: group[0].name,
    source: group[0].source,
    calls: group.length,
    failures: group.filter((sample) => sample.failed).length,
    averageMs: Math.round(group.reduce((sum, sample) => sum + sample.durationMs, 0) / group.length),
    p95Ms: percentile(group.map((sample) => sample.durationMs), 0.95),
    maxMs: Math.round(Math.max(...group.map((sample) => sample.durationMs))),
  }));

  return {
    windowMinutes: Math.round(WINDOW_MS / 60_000),
    samples: samples.length,
    backgroundJobs: rows.filter((row) => row.kind === "background").sort((a, b) => b.p95Ms - a.p95Ms).slice(0, 20),
    dependencies: rows.filter((row) => row.kind === "dependency").sort((a, b) => b.p95Ms - a.p95Ms).slice(0, 20),
  };
}
