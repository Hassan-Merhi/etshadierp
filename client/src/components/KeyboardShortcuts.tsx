import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Keyboard } from "lucide-react";

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
    label: "ERP Quick Nav",
    shortcuts: [
      { keys: ["T"], description: "Tracking" },
      { keys: ["D"], description: "Dashboard" },
      { keys: ["A"], description: "Accounts" },
      { keys: ["V"], description: "Vouchers" },
      { keys: ["I"], description: "Inventory" },
      { keys: ["S"], description: "Settings" },
      { keys: ["P"], description: "Parties" },
      { keys: ["C"], description: "Containers" },
    ],
  },
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

export function openKeyboardShortcutsDialog() {
  document.dispatchEvent(new CustomEvent("show-keyboard-shortcuts"));
}

export function KeyboardShortcutsButton() {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={openKeyboardShortcutsDialog}
      data-testid="button-keyboard-shortcuts"
      title="Keyboard shortcuts (?)"
    >
      <Keyboard className="h-4 w-4" />
    </Button>
  );
}

export function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();

  useEffect(() => {
    const handler = () => setOpen(true);
    document.addEventListener("show-keyboard-shortcuts", handler);
    return () => document.removeEventListener("show-keyboard-shortcuts", handler);
  }, []);

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
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        if (e.code === "Digit1") { e.preventDefault(); navigate("/"); return; }
        if (e.code === "Digit2") { e.preventDefault(); navigate("/factory/stock-entry"); return; }
        if (e.code === "Digit3") { e.preventDefault(); navigate("/properties/rental/warehouses"); return; }
      }

      // ERP single-key quick nav (no modifiers)
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === "t") { e.preventDefault(); navigate("/tracking"); return; }
        if (key === "d") { e.preventDefault(); navigate("/financial-overview"); return; }
        if (key === "a") { e.preventDefault(); navigate("/accounts"); return; }
        if (key === "v") { e.preventDefault(); navigate("/vouchers"); return; }
        if (key === "i") { e.preventDefault(); navigate("/inventory"); return; }
        if (key === "s") { e.preventDefault(); navigate("/settings"); return; }
        if (key === "p") { e.preventDefault(); navigate("/parties"); return; }
        if (key === "c") { e.preventDefault(); navigate("/containers-otw"); return; }
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
