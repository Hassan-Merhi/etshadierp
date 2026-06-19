import { useState, useEffect, useCallback, useRef } from "react";
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

interface ShortcutDef { keys: string[]; description: string }
interface ShortcutGroup { label: string; shortcuts: ShortcutDef[] }

const ERP_NAV_SHORTCUTS: ShortcutDef[] = [
  { keys: ["T"], description: "Tracking" },
  { keys: ["D"], description: "Dashboard" },
  { keys: ["A"], description: "Accounts" },
  { keys: ["V"], description: "Vouchers" },
  { keys: ["I"], description: "Inventory" },
  { keys: ["S"], description: "Settings" },
  { keys: ["P"], description: "Parties" },
  { keys: ["C"], description: "Containers" },
];

const FACTORY_NAV_SHORTCUTS: ShortcutDef[] = [
  { keys: ["O"], description: "Overview" },
  { keys: ["D"], description: "Daybook" },
  { keys: ["A"], description: "Accounts" },
  { keys: ["S"], description: "Stock Allocation" },
  { keys: ["R"], description: "Raw Materials" },
  { keys: ["B"], description: "Bale Explorer" },
  { keys: ["I"], description: "Invoicing" },
  { keys: ["L"], description: "Loading" },
  { keys: ["L", "I"], description: "Location Inventory" },
  { keys: ["C"], description: "Containers" },
  { keys: ["P"], description: "Parties" },
  { keys: ["V"], description: "Vouchers" },
];

const GLOBAL_SHORTCUTS: ShortcutGroup[] = [
  {
    label: "Mode Switching",
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

function ShortcutRow({ s }: { s: ShortcutDef }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-foreground">{s.description}</span>
      <span className="flex items-center gap-1 shrink-0">
        {s.keys.map((k, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-[0.65rem] text-muted-foreground">then</span>}
            <KeyBadge>{k}</KeyBadge>
          </span>
        ))}
      </span>
    </div>
  );
}

function ShortcutsDialog({ open, onClose, isFactory }: { open: boolean; onClose: () => void; isFactory: boolean }) {
  const modeGroup: ShortcutGroup = isFactory
    ? { label: "Factory Quick Nav", shortcuts: FACTORY_NAV_SHORTCUTS }
    : { label: "ERP Quick Nav", shortcuts: ERP_NAV_SHORTCUTS };

  const groups = [modeGroup, ...GLOBAL_SHORTCUTS];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 mt-1">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                {group.label}
              </p>
              <div className="space-y-2">
                {group.shortcuts.map((s) => <ShortcutRow key={s.description} s={s} />)}
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
  const [location, navigate] = useLocation();
  const isFactory = location.startsWith("/factory");

  // For the L → L+I chord: track pending L press
  const pendingLRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const awaitingIRef = useRef(false);

  const clearLChord = useCallback(() => {
    if (pendingLRef.current) {
      clearTimeout(pendingLRef.current);
      pendingLRef.current = null;
    }
    awaitingIRef.current = false;
  }, []);

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

      // Show shortcuts dialog
      if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }

      // Ctrl/Cmd+K → focus search
      if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        document.querySelector<HTMLInputElement>(
          'input[type="search"], input[placeholder*="earch"], input[data-testid*="search"], input[data-testid*="Search"]',
        )?.focus();
        return;
      }

      // / → focus search
      if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        document.querySelector<HTMLInputElement>(
          'input[type="search"], input[placeholder*="earch"], input[data-testid*="search"], input[data-testid*="Search"]',
        )?.focus();
        return;
      }

      // Alt+1/2/3 mode switching
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        if (e.code === "Digit1") { e.preventDefault(); clearLChord(); navigate("/"); return; }
        if (e.code === "Digit2") { e.preventDefault(); clearLChord(); navigate("/factory/stock-entry"); return; }
        if (e.code === "Digit3") { e.preventDefault(); clearLChord(); navigate("/properties/rental/warehouses"); return; }
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const key = e.key.toLowerCase();

      // ── Factory quick-nav ────────────────────────────────────────────────────
      if (isFactory) {
        // L+I chord: if awaiting I after L, resolve immediately
        if (awaitingIRef.current) {
          if (key === "i") {
            e.preventDefault();
            clearLChord();
            navigate("/factory/location-inventory");
            return;
          }
          // Any other key cancels the chord and fires L now
          clearLChord();
          // fall through to handle the new key
        }

        if (key === "l") {
          e.preventDefault();
          awaitingIRef.current = true;
          // After 700 ms with no I, navigate to loadings
          pendingLRef.current = setTimeout(() => {
            awaitingIRef.current = false;
            navigate("/factory/sales/loadings");
          }, 700);
          return;
        }

        if (key === "o") { e.preventDefault(); navigate("/factory/intelligence/dashboard"); return; }
        if (key === "d") { e.preventDefault(); navigate("/factory/daybook"); return; }
        if (key === "a") { e.preventDefault(); navigate("/factory/accounts"); return; }
        if (key === "s") { e.preventDefault(); navigate("/factory/stock-allocation"); return; }
        if (key === "r") { e.preventDefault(); navigate("/factory/raw-materials"); return; }
        if (key === "b") { e.preventDefault(); navigate("/factory/bales-hub"); return; }
        if (key === "i") { e.preventDefault(); navigate("/factory/invoicing"); return; }
        if (key === "c") { e.preventDefault(); navigate("/factory/containers-hub"); return; }
        if (key === "p") { e.preventDefault(); navigate("/factory/parties"); return; }
        if (key === "v") { e.preventDefault(); navigate("/factory/vouchers"); return; }
        return;
      }

      // ── ERP quick-nav ────────────────────────────────────────────────────────
      if (key === "t") { e.preventDefault(); navigate("/tracking"); return; }
      if (key === "d") { e.preventDefault(); navigate("/financial-overview"); return; }
      if (key === "a") { e.preventDefault(); navigate("/accounts"); return; }
      if (key === "v") { e.preventDefault(); navigate("/vouchers"); return; }
      if (key === "i") { e.preventDefault(); navigate("/inventory"); return; }
      if (key === "s") { e.preventDefault(); navigate("/settings"); return; }
      if (key === "p") { e.preventDefault(); navigate("/parties"); return; }
      if (key === "c") { e.preventDefault(); navigate("/containers-otw"); return; }
    },
    [open, navigate, isFactory, clearLChord],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Cleanup chord on unmount
  useEffect(() => () => clearLChord(), [clearLChord]);

  return <ShortcutsDialog open={open} onClose={() => setOpen(false)} isFactory={isFactory} />;
}
