/**
 * Types for the FactoryOtwTrackingTab page.
 *
 * Extracted from FactoryOtwTrackingTab.tsx during the Phase 4 god-file split.
 */
import type {FactoryContainer} from "@shared/schema";

export // ── Types ───────────────────────────────────────────────────────────────────
interface ContainerWithSupplier extends FactoryContainer {
  supplierName?: string | null;
}

export interface OtwTrackingTabProps {
  onEdit?: (container: ContainerWithSupplier) => void;
}

export // ── Event Timeline Sheet ─────────────────────────────────────────────────────
interface TrackingEvent {
  id: number;
  eventTime: string | null;
  description: string | null;
  location: string | null;
  status: string | null;
  provider: string | null;
}

export // ── Track-now progress log ────────────────────────────────────────────────────
interface ProgressStep {
  provider: string;
  status: "running" | "success" | "fail" | "skip" | "blocked";
  detail?: string;
  ts: number;
}
