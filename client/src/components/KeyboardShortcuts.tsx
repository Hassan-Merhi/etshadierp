import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const isMac = typeof navigator !== "undefined" &&
  /Mac|iPod|iPhone|iPad/.test(navigator.platform);

const MOD_KEY = isMac ? "⌘" : "Ctrl";
const ALT_KEY = isMac ? "⌥" : "Alt";

interface ShortcutGroup {
  label: string;
  shortcuts: { keys: string[]; description: string }[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    label: "Navigation",
    shortcuts: [
      { keys: [ALT_KEY, "1"], description: "Go to ERP / Business OS" },
      { keys: [ALT_KEY, "2"], description: "Go to Factory" },
      { keys: [ALT_KEY, "3"], description: "Go to Properties" },
    ],
  },
  {
    label: "Page Actions",
    shortcuts: [
      { keys: ["N"], description: "New item (on supported pages)" },
      { keys: ["/"], description: "Focus search bar" },
      { keys: [MOD_KEY, "K"], description: "Focus search bar" },
    ],
  },
  {
    label: "Help",
    shortcuts: [
      { keys: ["?"], description: "Show this shortcuts panel" },
      { keys: ["Esc"], description: "Close panel / dialog" },
    ],
  },
];

function KeyBadge({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center justify-center min-w-[1.75rem] h-6 px-1.5 rounded border border-border bg-muted text-[0.7rem] font-mono font-semibold text-muted-foreground shadow-sm">
      {children}
    </span>
  );
}

function ShortcutsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 mt-1">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                {group.label}
              </p>
              <div className="space-y-2">
                {group.shortcuts.map((s) => (
                  <div
                    key={s.description}
                    className="flex items-center justify-between gap-4"
                  >
                    <span className="text-sm text-foreground">
                      {s.description}
                    </span>
                    <span className="flex items-center gap-1 shrink-0">
                      {s.keys.map((k, i) => (
                        <span key={i} className="flex items-center gap-1">
                          {i > 0 && (
                            <span className="text-[0.65rem] text-muted-foreground">
                              +
                            </span>
                          )}
                          <KeyBadge>{k}</KeyBadge>
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Press <KeyBadge>?</KeyBadge> at any time to open this panel.
        </p>
      </DialogContent>
    </Dialog>
  );
}

export function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const isTyping =
        tag === "input" ||
        tag === "textarea" ||
        (e.target as HTMLElement)?.isContentEditable;

      if (open && e.key === "Escape") {
        setOpen(false);
        return;
      }

      if (isTyping) return;

      if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }

      if (
        (e.key === "k" || e.key === "K") &&
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey
      ) {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>(
          'input[type="search"], input[placeholder*="earch"], input[data-testid*="search"], input[data-testid*="Search"]',
        );
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
        return;
      }

      if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>(
          'input[type="search"], input[placeholder*="earch"], input[data-testid*="search"], input[data-testid*="Search"]',
        );
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
        return;
      }

      // Alt/Option+1/2/3 navigation
      // Use e.code ("Digit1" etc.) instead of e.key so this fires correctly on Mac,
      // where Option+1 sets e.key to "¡" rather than "1".
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        if (e.code === "Digit1") { e.preventDefault(); navigate("/"); return; }
        if (e.code === "Digit2") { e.preventDefault(); navigate("/factory/stock-entry"); return; }
        if (e.code === "Digit3") { e.preventDefault(); navigate("/properties/rental/warehouses"); return; }
      }
    },
    [open, navigate],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return <ShortcutsDialog open={open} onClose={() => setOpen(false)} />;
}
