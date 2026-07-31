/**
 * ProgressStepIcon — extracted sub-component.
 *
 * Extracted from FactoryOtwTrackingTab.tsx during the Phase 4 god-file split.
 */
import {Loader2, CheckCircle, XCircle, Minus, AlertCircle} from "lucide-react";
import type {ProgressStep} from "../types";

export function ProgressStepIcon({ status }: { status: ProgressStep["status"] }) {
  if (status === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />;
  if (status === "success") return <CheckCircle className="h-3.5 w-3.5 text-green-500" />;
  if (status === "fail") return <XCircle className="h-3.5 w-3.5 text-destructive" />;
  if (status === "skip") return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  return <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />;
}
