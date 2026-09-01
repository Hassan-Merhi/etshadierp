import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldAlert } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";

interface AdminAuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAuthorized: (credentials: { username: string; password: string }) => void;
  action?: string;
}

/**
 * AdminAuthDialog — admin credential prompt that simply hands the entered
 * username/password back to the caller. Built on top of the canonical
 * {@link ConfirmDialog} primitive for consistent layout and behavior.
 */
export function AdminAuthDialog({
  open,
  onOpenChange,
  onAuthorized,
  action = "create this item",
}: AdminAuthDialogProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!open) {
      setUsername("");
      setPassword("");
    }
  }, [open]);

  const canSubmit = !!username.trim() && !!password;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Admin Authorization Required"
      description={`You need an admin to authorize in order to ${action}. Enter their credentials below.`}
      icon={ShieldAlert}
      tone="warning"
      confirmText="Authorize"
      confirmDisabled={!canSubmit}
      onConfirm={() => {
        onAuthorized({ username: username.trim(), password });
      }}
      data-testid="dialog-admin-auth"
    >
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="admin-auth-username">Admin Username</Label>
          <Input
            id="admin-auth-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Enter admin username"
            autoComplete="off"
            data-testid="input-admin-auth-username"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="admin-auth-password">Admin Password</Label>
          <Input
            id="admin-auth-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter admin password"
            autoComplete="new-password"
            data-testid="input-admin-auth-password"
          />
        </div>
      </div>
    </ConfirmDialog>
  );
}
