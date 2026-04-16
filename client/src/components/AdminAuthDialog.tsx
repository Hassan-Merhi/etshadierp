import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldAlert } from "lucide-react";

interface AdminAuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAuthorized: (credentials: { username: string; password: string }) => void;
  action?: string;
}

export function AdminAuthDialog({ open, onOpenChange, onAuthorized, action = "create this item" }: AdminAuthDialogProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = () => {
    if (!username.trim() || !password) return;
    onAuthorized({ username: username.trim(), password });
    setUsername("");
    setPassword("");
  };

  const handleClose = () => {
    setUsername("");
    setPassword("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-500" />
            <DialogTitle>Admin Authorization Required</DialogTitle>
          </div>
          <DialogDescription>
            You need an admin to authorize in order to {action}. Enter their credentials below.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="admin-auth-username">Admin Username</Label>
            <Input
              id="admin-auth-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter admin username"
              autoComplete="off"
              data-testid="input-admin-auth-username"
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
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
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose} data-testid="button-admin-auth-cancel">
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!username.trim() || !password}
            data-testid="button-admin-auth-submit"
          >
            Authorize
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
