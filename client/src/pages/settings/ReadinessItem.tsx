import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

export function ReadinessItem({ ok, warn, label }: { ok: boolean; warn?: boolean; label: string }) {
  const icon = ok
    ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" />
    : warn
      ? <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
      : <XCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
  return (
    <div className="flex items-center gap-1.5 text-xs">
      {icon}
      <span className={ok ? "text-foreground" : warn ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}>
        {label}
      </span>
    </div>
  );
}
