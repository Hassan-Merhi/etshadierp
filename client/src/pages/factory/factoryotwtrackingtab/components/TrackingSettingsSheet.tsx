/**
 * TrackingSettingsSheet — extracted sub-component.
 *
 * Extracted from FactoryOtwTrackingTab.tsx during the Phase 4 god-file split.
 */
import { useState, useEffect } from "react";
import { useMutation, useQueryClient as useTQClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Loader2, Settings2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { factoryApiRequest } from "@/lib/factoryApi";
import type { ContainerWithSupplier } from "../types";

export // ── Tracking Settings Sheet ──────────────────────────────────────────────────
function TrackingSettingsSheet({
  container,
  open,
  onClose,
}: {
  container: ContainerWithSupplier | null;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const tqClient = useTQClient();
  const [enabled, setEnabled] = useState(true);
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [carrierHint, setCarrierHint] = useState("");

  useEffect(() => {
    if (container) {
      const fc = container;
      setEnabled(fc.trackingEnabled !== false);
      setAutoUpdate(fc.trackingAutoUpdate !== false);
      setCarrierHint(fc.trackingCarrierHint ?? "");
    }
  }, [container]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!container) return;
      await factoryApiRequest("PATCH", `/api/factory/container-tracking/${container.id}/settings`, {
        trackingEnabled: enabled,
        trackingAutoUpdate: autoUpdate,
        trackingCarrierHint: carrierHint.trim() || null,
      });
    },
    onSuccess: () => {
      tqClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
      toast({ title: "Tracking settings saved" });
      onClose();
    },
    onError: (err: unknown) => {
      toast({ title: "Failed to save settings", description: err?.message, variant: "destructive" });
    },
  });

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <SheetContent className="w-full sm:max-w-sm flex flex-col gap-0 p-0">
        <SheetHeader className="px-6 py-4 border-b shrink-0">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            Tracking Settings
            {container && (
              <span className="font-mono text-muted-foreground font-normal text-sm">{container.containerNumber}</span>
            )}
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 px-6 py-5 space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Enable Tracking</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Allow this container to be tracked via carrier APIs
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} data-testid="switch-tracking-enabled" />
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Auto Update</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Let the scheduler check this container automatically
              </p>
            </div>
            <Switch
              checked={autoUpdate}
              onCheckedChange={setAutoUpdate}
              disabled={!enabled}
              data-testid="switch-auto-update"
            />
          </div>
          <Separator />
          <div className="space-y-2">
            <Label className="text-sm font-medium">Carrier Hint</Label>
            <p className="text-xs text-muted-foreground">
              Select the shipping line — enables JSON Cargo ETA tracking for Maersk, Hapag-Lloyd, MSC, and CMA CGM.
            </p>
            <Select
              value={carrierHint || "NONE"}
              onValueChange={(v) => setCarrierHint(v === "NONE" ? "" : v)}
              disabled={!enabled}
            >
              <SelectTrigger data-testid="select-carrier-hint-tab">
                <SelectValue placeholder="None (auto-detect)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">None (auto-detect)</SelectItem>
                <SelectItem value="MAERSK">Maersk</SelectItem>
                <SelectItem value="HAPAG">Hapag-Lloyd</SelectItem>
                <SelectItem value="MSC">MSC</SelectItem>
                <SelectItem value="CMA">CMA CGM</SelectItem>
              </SelectContent>
            </Select>
            {carrierHint && !["MAERSK", "HAPAG", "MSC", "CMA"].includes(carrierHint) && (
              <p className="text-[11px] text-amber-500">
                Custom value &quot;{carrierHint}&quot; — JSON Cargo only activates for Maersk, Hapag-Lloyd, MSC, CMA
                CGM.
              </p>
            )}
          </div>
        </div>
        <div className="px-6 pb-6 shrink-0">
          <Button
            className="w-full"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            data-testid="button-save-tracking-settings-tab"
          >
            {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Settings
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Track-now progress log ────────────────────────────────────────────────────
