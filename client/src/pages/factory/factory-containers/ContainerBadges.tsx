import { useState, useEffect, useRef } from "react";
import { StickyNote } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  OTW_NOTES_KEY,
  otwFmtCcy,
  otwCcySymbol,
  getContainerStatusLabel,
} from "./otwHelpers";

export function OtwCurrencyInline({ amounts }: { amounts: Record<string, number> }) {
  const entries = Object.entries(amounts).filter(([, v]) => v > 0);
  if (entries.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col items-end gap-0.5">
      {entries.map(([ccy, amt]) => (
        <span key={ccy} className="font-mono text-base font-semibold whitespace-nowrap">
          {otwFmtCcy(otwCcySymbol(ccy), amt)}
        </span>
      ))}
    </div>
  );
}

export function OtwNotes() {
  const [value, setValue] = useState(() => localStorage.getItem(OTW_NOTES_KEY) ?? "");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setValue(e.target.value);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      localStorage.setItem(OTW_NOTES_KEY, e.target.value);
    }, 600);
  }

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  return (
    <div className="rounded-xl border overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-muted/20">
        <StickyNote className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Notes</span>
      </div>
      <div className="px-4 py-3">
        <Textarea
          value={value}
          onChange={handleChange}
          placeholder="Write anything here…"
          className="min-h-[72px] resize-y text-sm border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
          data-testid="textarea-otw-notes"
        />
      </div>
    </div>
  );
}

export function ContainerStatusBadge({ status }: { status: string }) {
  const label = getContainerStatusLabel(status);
  if (status === "OFFLOADED") {
    return <Badge className="text-xs bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/20">{label}</Badge>;
  }
  if (status === "PARTIALLY_RECEIVED") {
    return <Badge className="text-xs bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20">{label}</Badge>;
  }
  if (status === "IN_TRANSIT") {
    return <Badge className="text-xs bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20">{label}</Badge>;
  }
  if (status === "ARRIVED") {
    return <Badge className="text-xs bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20">{label}</Badge>;
  }
  return <Badge variant="secondary" className="text-xs">{label}</Badge>;
}
