import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Key } from "lucide-react";

interface ChangePasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (current: string, next: string) => void;
  isPending: boolean;
}

export function ChangePasswordDialog({ open, onOpenChange, onSubmit, isPending }: ChangePasswordDialogProps) {
  const [data, setData] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });

  const handleOpenChange = (val: boolean) => {
    onOpenChange(val);
    if (!val) setData({ currentPassword: "", newPassword: "", confirmPassword: "" });
  };

  const isValid =
    data.currentPassword &&
    data.newPassword &&
    data.newPassword.length >= 6 &&
    data.newPassword === data.confirmPassword;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Change Your Password
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Current Password</Label>
            <Input
              type="password"
              value={data.currentPassword}
              onChange={(e) => setData((prev) => ({ ...prev, currentPassword: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label>New Password</Label>
            <Input
              type="password"
              value={data.newPassword}
              onChange={(e) => setData((prev) => ({ ...prev, newPassword: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label>Confirm New Password</Label>
            <Input
              type="password"
              value={data.confirmPassword}
              onChange={(e) => setData((prev) => ({ ...prev, confirmPassword: e.target.value }))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => onSubmit(data.currentPassword, data.newPassword)} disabled={!isValid || isPending}>
            {isPending ? "Updating..." : "Update Password"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
