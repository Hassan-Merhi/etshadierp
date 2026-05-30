import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Lock, ShieldAlert } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface ConfirmPasswordDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirmed: () => void;
  action: string;
  description?: string;
}

export function ConfirmPasswordDialog({
  open,
  onClose,
  onConfirmed,
  action,
  description,
}: ConfirmPasswordDialogProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setPassword("");
    setError("");
    setLoading(false);
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) {
      reset();
      onClose();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await apiRequest("POST", "/api/auth/confirm-password", { password });
      reset();
      onConfirmed();
    } catch (err: any) {
      setError(err?.message || "Incorrect password. Please try again.");
      setPassword("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-muted-foreground" />
            Confirm your password
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 p-3 flex gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800 dark:text-amber-300">
              <p className="font-medium">{action}</p>
              {description && (
                <p className="text-xs mt-0.5 opacity-80">{description}</p>
              )}
            </div>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="cpd-password">Your password</Label>
            <Input
              id="cpd-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password to continue"
              autoFocus
              autoComplete="current-password"
              data-testid="input-confirm-password"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              data-testid="button-cancel-confirm-password"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || !password}
              data-testid="button-submit-confirm-password"
            >
              {loading ? "Verifying…" : "Confirm"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
