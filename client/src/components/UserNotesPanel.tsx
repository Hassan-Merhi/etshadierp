import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { NotebookPen, Save, Check } from "lucide-react";

const NOTES_KEY = "/api/user/notes";
const DEBOUNCE_MS = 1200;

interface NotesData {
  content: string;
  updatedAt: string | null;
}

export function UserNotesPanel() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [savedRecently, setSavedRecently] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data, isLoading } = useQuery<NotesData>({
    queryKey: [NOTES_KEY],
    enabled: open,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (data && draft === null) {
      setDraft(data.content);
    }
  }, [data, draft]);

  const saveMutation = useMutation({
    mutationFn: (content: string) =>
      apiRequest("PUT", NOTES_KEY, { content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [NOTES_KEY] });
      setSavedRecently(true);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSavedRecently(false), 2000);
    },
  });

  const scheduleSave = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        saveMutation.mutate(value);
      }, DEBOUNCE_MS);
    },
    [saveMutation],
  );

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setDraft(value);
    scheduleSave(value);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (draft !== null && draft !== (data?.content ?? "")) {
        saveMutation.mutate(draft);
      }
      setDraft(null);
    }
  }

  function formatUpdated(iso: string | null | undefined): string {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return `Saved ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} at ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
    } catch {
      return "";
    }
  }

  const displayContent = draft ?? data?.content ?? "";

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => setOpen(true)}
            data-testid="button-open-user-notes"
            aria-label="My notes"
            className="fixed bottom-5 left-5 z-50 h-11 w-11 rounded-full flex items-center justify-center bg-primary text-primary-foreground shadow-md transition-transform duration-150 hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <NotebookPen className="h-5 w-5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">My notes</TooltipContent>
      </Tooltip>

      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent
          side="right"
          className="flex flex-col w-full sm:max-w-md p-0"
          data-testid="panel-user-notes"
        >
          <SheetHeader className="px-5 pt-5 pb-3 border-b flex-shrink-0">
            <div className="flex items-center justify-between gap-2">
              <SheetTitle className="flex items-center gap-2 text-base">
                <NotebookPen className="h-4 w-4 text-muted-foreground" />
                My Notes
              </SheetTitle>
              <div className="flex items-center gap-2">
                {saveMutation.isPending && (
                  <span className="text-xs text-muted-foreground">Saving…</span>
                )}
                {savedRecently && !saveMutation.isPending && (
                  <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                    <Check className="h-3.5 w-3.5" />
                    Saved
                  </span>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (debounceRef.current) clearTimeout(debounceRef.current);
                    saveMutation.mutate(displayContent);
                  }}
                  disabled={saveMutation.isPending}
                  data-testid="button-save-notes"
                >
                  <Save className="h-3.5 w-3.5 mr-1.5" />
                  Save
                </Button>
              </div>
            </div>
            {data?.updatedAt && !savedRecently && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {formatUpdated(data.updatedAt)}
              </p>
            )}
          </SheetHeader>

          <div className="flex-1 overflow-hidden p-4">
            {isLoading ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                Loading…
              </div>
            ) : (
              <Textarea
                value={displayContent}
                onChange={handleChange}
                placeholder="Type anything here — just for you. Auto-saves as you type."
                className="h-full resize-none text-sm leading-relaxed border-0 focus-visible:ring-0 p-0"
                data-testid="textarea-user-notes"
                autoFocus={open}
              />
            )}
          </div>

          <div className="px-5 pb-4 pt-2 border-t flex-shrink-0">
            <p className="text-xs text-muted-foreground">
              Only you can see these notes.
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
