import { RotateCcw, Trash2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertPanel } from "@/components/AlertPanel";

interface DraftRestorePromptProps {
  draftAge: string;
  label?: string;
  onRestore: () => void;
  onDiscard: () => void;
}

/**
 * DraftRestorePrompt — inline "unsaved draft found" panel built on top of
 * the canonical {@link AlertPanel} so it shares the warning visual language
 * used elsewhere in the app.
 */
export function DraftRestorePrompt({
  draftAge,
  label = "Unsaved draft found",
  onRestore,
  onDiscard,
}: DraftRestorePromptProps) {
  return (
    <AlertPanel
      tone="warning"
      icon={FileText}
      title={label}
      description={`saved ${draftAge}`}
      actions={
        <>
          <Button type="button" size="sm" variant="outline" onClick={onRestore} data-testid="button-restore-draft">
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            Restore
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDiscard} data-testid="button-discard-draft">
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            Discard
          </Button>
        </>
      }
      data-testid="draft-restore-prompt"
    />
  );
}
