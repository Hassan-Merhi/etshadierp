/**
 * TrackNowProgressLog — extracted sub-component.
 *
 * Extracted from FactoryOtwTrackingTab.tsx during the Phase 4 god-file split.
 */
import {useState, useEffect} from "react";
import {Loader2} from "lucide-react";
import {factoryApiRequest} from "@/lib/factoryApi";
import type {ProgressStep} from "../types";
import {ProgressStepIcon} from "./ProgressStepIcon";

export function TrackNowProgressLog({ containerId }: { containerId: number }) {
  const [steps, setSteps] = useState<ProgressStep[]>([]);
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      while (!cancelled) {
        try {
          const res = await factoryApiRequest("GET", `/api/factory/container-tracking/${containerId}/progress`);
          const data: ProgressStep[] = res.ok ? await res.json() : [];
          if (!cancelled) setSteps(data ?? []);
        } catch {
          /* ignore */
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [containerId]);

  if (steps.length === 0) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Starting…
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-0.5 max-w-[140px]">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-1.5 text-xs">
          <ProgressStepIcon status={s.status} />
          <span className="text-muted-foreground truncate">{s.provider}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
