import type { ClientErrorLike } from "@/lib/clientError";
/**
 * SettingsPopover — extracted sub-component.
 *
 * Extracted from TransporterStatement.tsx during the Phase 4 god-file split.
 */
import {useState} from "react";
import {useMutation} from "@tanstack/react-query";
import {apiRequest} from "@/lib/queryClient";
import {useToast} from "@/hooks/use-toast";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Popover, PopoverContent, PopoverTrigger} from "@/components/ui/popover";
import {Settings2} from "lucide-react";

export function SettingsPopover({
  accountId,
  paymentTermsDays,
  onSaved,
}: {
  accountId: number;
  paymentTermsDays: number;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [days, setDays] = useState(String(paymentTermsDays));
  const [open, setOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: (d: number) =>
      apiRequest("PUT", `/api/transporter-statement/${accountId}/settings`, { paymentTermsDays: d }),
    onSuccess: () => {
      toast({ title: "Settings saved" });
      setOpen(false);
      onSaved();
    },
    onError: (err: ClientErrorLike) => {
      toast({ title: "Failed", description: err?.message, variant: "destructive" });
    },
  });

  function handleSave() {
    const n = parseInt(days);
    if (isNaN(n) || n < 0) return;
    mutation.mutate(n);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" data-testid="btn-transporter-settings">
          <Settings2 className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <div className="space-y-3">
          <p className="text-sm font-medium">Payment Terms</p>
          <div className="space-y-1.5">
            <Label htmlFor="payment-days" className="text-xs text-muted-foreground">
              Days after offload date
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="payment-days"
                type="number"
                min={0}
                max={365}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                className="w-24"
                data-testid="input-payment-days"
              />
              <span className="text-sm text-muted-foreground">days</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            "Date to be Paid" = Offload Date + this many days. Override individual rows by clicking the date cell.
          </p>
          <Button
            className="w-full"
            onClick={handleSave}
            disabled={mutation.isPending}
            data-testid="btn-save-payment-settings"
          >
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
