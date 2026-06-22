import { CheckCircle2, XCircle, AlertTriangle, Info } from "lucide-react";
import { JobStep } from "./ExportCenterTypes.ts";

export function StepIcon({ type }: { type: JobStep["type"] }) {
  if (type === "success") return <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />;
  if (type === "error")   return <XCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />;
  if (type === "warning") return <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />;
  return <Info className="h-3.5 w-3.5 text-blue-500 shrink-0 mt-0.5" />;
}
