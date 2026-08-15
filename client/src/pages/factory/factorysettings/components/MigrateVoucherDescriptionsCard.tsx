/**
 * MigrateVoucherDescriptionsCard — extracted sub-component.
 *
 * Extracted from FactorySettings.tsx during the Phase 4 god-file split.
 */
import {useState} from "react";
import {useMutation} from "@tanstack/react-query";
import {apiRequest} from "@/lib/queryClient";
import {Card, CardContent, CardHeader, CardTitle, CardDescription} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {Loader2, Wrench} from "lucide-react";
import {useToast} from "@/hooks/use-toast";

export function MigrateVoucherDescriptionsCard() {
  const { toast } = useToast();
  const [result, setResult] = useState<{ chargesFixed: number; narrationFixed: number } | null>(null);
  const migrateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/factory/migrate-voucher-descriptions");
      return res.json();
    },
    onSuccess: (data: unknown) => {
      setResult(data);
      toast({
        title: "Update complete",
        description: `Fixed ${data.chargesFixed} charge entries and ${data.narrationFixed} narrations.`,
      });
    },
    onError: (error: unknown) => {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wrench className="h-5 w-5 text-muted-foreground" />
          Fix Old Voucher Descriptions
        </CardTitle>
        <CardDescription>
          Updates old charge descriptions to use container numbers, and cleans up auto-generated narrations on payments,
          receipts, and journals to show only the description you wrote.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {result && (
          <p className="text-sm text-muted-foreground">
            Last run: fixed {result.chargesFixed} charge entries and {result.narrationFixed} narration entries.
          </p>
        )}
        <Button
          onClick={() => migrateMutation.mutate()}
          disabled={migrateMutation.isPending}
          data-testid="button-migrate-voucher-descriptions"
        >
          {migrateMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Wrench className="h-4 w-4 mr-2" />
          )}
          Run Update
        </Button>
      </CardContent>
    </Card>
  );
}
