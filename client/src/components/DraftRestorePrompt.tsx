import { RotateCcw, Trash2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DraftRestorePromptProps {
  draftAge: string;
  label?: string;
  onRestore: () => void;
  onDiscard: () => void;
}

export function DraftRestorePrompt({
  draftAge,
  label = "Unsaved draft found",
  onRestore,
  onDiscard,
}: DraftRestorePromptProps) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 rounded-md border border-amber-500/30 bg-amber-50 dark:bg-amber-950/30 text-sm"
      data-testid="draft-restore-prompt"
    >
      <FileText className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="font-medium text-amber-800 dark:text-amber-300">{label}</span>
        <span className="text-amber-700/70 dark:text-amber-400/70 ml-1.5">saved {draftAge}</span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onRestore}
          data-testid="button-restore-draft"
        >
          <RotateCcw className="h-3.5 w-3.5 mr-1" />
          Restore
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onDiscard}
          data-testid="button-discard-draft"
        >
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          Discard
        </Button>
      </div>
    </div>
  );
}
