import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { AlertTriangle, type LucideIcon } from "lucide-react";

export type ConfirmDialogTone = "default" | "destructive" | "warning";

export interface ConfirmDialogProps {
  /** Controlled open state. If omitted you must pass `trigger`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** If omitted you must use controlled `open`. */
  trigger?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  tone?: ConfirmDialogTone;
  icon?: LucideIcon;
  /** Optional confirmation phrase the user must type before Confirm enables. */
  requirePhrase?: string;
  /** Optional second-step confirmation, e.g. for destructive actions. */
  doubleConfirm?: { title: string; description?: React.ReactNode; confirmText?: string };
  loading?: boolean;
  /** When true, the primary confirm button is disabled (e.g. invalid form). */
  confirmDisabled?: boolean;
  /** Children render below description (e.g. extra inputs). */
  children?: React.ReactNode;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
  "data-testid"?: string;
}

/**
 * ConfirmDialog — single canonical confirmation primitive. Replaces the
 * hand-rolled confirm/auth/override/draft dialogs scattered across the app.
 * Supports controlled or trigger-based use, optional double-confirm, and
 * optional "type-to-confirm" phrase for destructive flows.
 */
export function ConfirmDialog({
  open: controlledOpen,
  onOpenChange,
  trigger,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  tone = "default",
  icon: Icon,
  requirePhrase,
  doubleConfirm,
  loading: externalLoading,
  confirmDisabled,
  children,
  onConfirm,
  onCancel,
  "data-testid": testId,
}: ConfirmDialogProps) {
  const isControlled = controlledOpen !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = isControlled ? !!controlledOpen : uncontrolledOpen;
  const setOpen = (v: boolean) => {
    if (!isControlled) setUncontrolledOpen(v);
    onOpenChange?.(v);
  };

  const [stage, setStage] = useState<1 | 2>(1);
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setStage(1);
      setPhrase("");
      setBusy(false);
    }
  }, [open]);

  const isLoading = busy || !!externalLoading;
  const phraseMatches = !requirePhrase || phrase.trim() === requirePhrase.trim();

  const handlePrimary = async (e: React.MouseEvent | React.SyntheticEvent) => {
    // Radix's AlertDialogAction closes the dialog by default. Prevent that
    // so we only close after async work / second-stage logic completes.
    e.preventDefault();
    if (!phraseMatches || isLoading || confirmDisabled) return;
    if (doubleConfirm && stage === 1) {
      setStage(2);
      return;
    }
    setBusy(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = () => {
    onCancel?.();
    setOpen(false);
  };

  const ResolvedIcon = Icon ?? (tone === "destructive" || tone === "warning" ? AlertTriangle : null);

  const showSecond = doubleConfirm && stage === 2;
  const headerTitle = showSecond ? doubleConfirm!.title : title;
  const headerDesc = showSecond ? doubleConfirm!.description : description;
  const primaryLabel = showSecond ? (doubleConfirm!.confirmText ?? confirmText) : confirmText;

  const destructiveBtn =
    tone === "destructive" || showSecond
      ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
      : tone === "warning"
      ? "bg-warning text-warning-foreground hover:bg-warning/90"
      : "";

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {trigger && <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>}
      <AlertDialogContent data-testid={testId ?? "dialog-confirm"}>
        <AlertDialogHeader>
          <div className="flex items-start gap-3">
            {ResolvedIcon && (
              <div
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-md shrink-0",
                  tone === "destructive" && "bg-destructive-soft text-destructive",
                  tone === "warning" && "bg-warning-soft text-warning-soft-foreground",
                  tone === "default" && "bg-primary/10 text-primary",
                )}
              >
                <ResolvedIcon className="h-5 w-5" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <AlertDialogTitle>{headerTitle}</AlertDialogTitle>
              {headerDesc && <AlertDialogDescription className="mt-1">{headerDesc}</AlertDialogDescription>}
            </div>
          </div>
        </AlertDialogHeader>

        {!showSecond && children && <div className="space-y-3">{children}</div>}

        {!showSecond && requirePhrase && (
          <div className="space-y-2">
            <Label htmlFor="confirm-phrase" className="text-xs">
              Type <span className="font-mono font-semibold">{requirePhrase}</span> to confirm
            </Label>
            <Input
              id="confirm-phrase"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              autoComplete="off"
              data-testid="input-confirm-phrase"
            />
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel} data-testid="button-confirm-cancel">
            {cancelText}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handlePrimary}
            disabled={isLoading || !phraseMatches || !!confirmDisabled}
            data-testid="button-confirm-confirm"
            className={destructiveBtn}
          >
            {isLoading ? "Working..." : primaryLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
