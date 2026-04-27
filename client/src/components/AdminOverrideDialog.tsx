import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldAlert } from "lucide-react";

interface AdminOverrideDialogProps {
  open: boolean;
  actionLabel?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function AdminOverrideDialog({
  open,
  actionLabel,
  onSuccess,
  onCancel,
}: AdminOverrideDialogProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const verifyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/factory/admin-verify", {
        username: username.trim(),
        password,
      });
      return res.json();
    },
    onSuccess: () => {
      setUsername("");
      setPassword("");
      setErrorMsg("");
      onSuccess();
    },
    onError: async (err: any) => {
      const body = err?.response ? await err.response.json().catch(() => null) : null;
      setErrorMsg(body?.message || "Invalid credentials. Please try again.");
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg("");
    if (!username.trim() || !password) {
      setErrorMsg("Please enter both username and password.");
      return;
    }
    verifyMutation.mutate();
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      setUsername("");
      setPassword("");
      setErrorMsg("");
      onCancel();
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm" data-testid="dialog-admin-override">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-destructive" />
            <DialogTitle>Admin Authorization Required</DialogTitle>
          </div>
          <DialogDescription>
            {actionLabel
              ? `"${actionLabel}" requires admin access.`
              : "This action requires admin access."}{" "}
            Please enter admin credentials to proceed.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="admin-override-username">Admin Username</Label>
            <Input
              id="admin-override-username"
              data-testid="input-admin-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              autoComplete="off"
              disabled={verifyMutation.isPending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="admin-override-password">Admin Password</Label>
            <Input
              id="admin-override-password"
              data-testid="input-admin-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete="current-password"
              disabled={verifyMutation.isPending}
            />
          </div>

          {errorMsg && (
            <p className="text-sm text-destructive" data-testid="text-admin-override-error">
              {errorMsg}
            </p>
          )}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={verifyMutation.isPending}
              data-testid="button-admin-override-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={verifyMutation.isPending}
              data-testid="button-admin-override-confirm"
            >
              {verifyMutation.isPending ? "Verifying..." : "Confirm"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
