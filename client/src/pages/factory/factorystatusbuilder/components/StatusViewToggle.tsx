import { History as HistoryIcon, LayoutGrid } from "lucide-react";

interface StatusViewToggleProps {
  viewMode: "sheet" | "history";
  onChange: (mode: "sheet" | "history") => void;
}

export function StatusViewToggle({ viewMode, onChange }: StatusViewToggleProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/20">
      <div className="flex items-center rounded-md border overflow-hidden shrink-0">
        <button
          onClick={() => onChange("sheet")}
          data-testid="sb-button-view-sheet"
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
            viewMode === "sheet" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
          }`}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          Sheet
        </button>
        <button
          onClick={() => onChange("history")}
          data-testid="sb-button-view-history"
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
            viewMode === "history" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
          }`}
        >
          <HistoryIcon className="h-3.5 w-3.5" />
          History
        </button>
      </div>
    </div>
  );
}
