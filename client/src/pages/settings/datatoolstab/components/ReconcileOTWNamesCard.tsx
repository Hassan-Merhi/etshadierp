/**
 * ReconcileOTWNamesCard — extracted sub-component.
 *
 * Extracted from DataToolsTab.tsx during the Phase 4 god-file split.
 */
import {useState} from "react";
import {Card, CardHeader, CardTitle, CardContent, CardDescription} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {Alert, AlertDescription} from "@/components/ui/alert";
import {useToast} from "@/hooks/use-toast";
import {queryClient, apiRequest} from "@/lib/queryClient";
import {Loader2, RotateCcw} from "lucide-react";

export function ReconcileOTWNamesCard() {
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ fixed: number; mergesChecked: number } | null>(null);

  async function handleRun() {
    setRunning(true);
    setResult(null);
    try {
      const res = await apiRequest("POST", "/api/stock-items/reconcile-otw-names", {});
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Reconcile failed");
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/containers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      toast({
        title: data.fixed > 0 ? `Fixed ${data.fixed} OTW line item(s)` : "All OTW names are already up to date",
      });
    } catch (err: any) {
      toast({ title: "Reconcile failed", description: err.message, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <RotateCcw className="h-4 w-4" />
          Reconcile OTW Names
        </CardTitle>
        <CardDescription className="text-xs">
          Re-points any On-The-Way container lines that still reference a merged or deleted item to the correct kept
          item, so OTW shows the current name.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {result && (
          <Alert>
            <AlertDescription className="text-sm">
              {result.fixed > 0
                ? `Fixed ${result.fixed} line item(s) across ${result.mergesChecked} merge record(s).`
                : `Nothing to fix — checked ${result.mergesChecked} merge record(s), all names are current.`}
            </AlertDescription>
          </Alert>
        )}
        <Button
          variant="outline"
          className="w-full"
          onClick={handleRun}
          disabled={running}
          data-testid="button-reconcile-otw-names"
        >
          {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-2" />}
          {running ? "Reconciling…" : "Run Reconcile"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Merge Stock Items Launcher (unified dialog) ───────────────────────────────
