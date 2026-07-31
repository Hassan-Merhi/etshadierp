/**
 * MergeStockItemsLauncher — extracted sub-component.
 *
 * Extracted from DataToolsTab.tsx during the Phase 4 god-file split.
 */
import {useState} from "react";
import {Card, CardHeader, CardTitle, CardContent, CardDescription} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {Tabs, TabsList, TabsTrigger, TabsContent} from "@/components/ui/tabs";
import {ArrowLeftRight} from "lucide-react";
import {MergeStockItemsCard} from "./MergeStockItemsCard";
import {BulkMergeStockItemsCard} from "./BulkMergeStockItemsCard";
import {MergeHistoryCard} from "./MergeHistoryCard";

export function MergeStockItemsLauncher() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("single");

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ArrowLeftRight className="h-4 w-4" />
            Merge Duplicate Stock Items
          </CardTitle>
          <CardDescription className="text-xs">
            Merge two items into one, run a bulk merge from Excel, or view and reverse past merges.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              setTab("single");
              setOpen(true);
            }}
            data-testid="button-open-merge-launcher"
          >
            <ArrowLeftRight className="h-4 w-4 mr-2" />
            Open Merge Tool
          </Button>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Merge Duplicate Stock Items</DialogTitle>
            <DialogDescription>
              Choose a merge method below. Quantities and values are preserved exactly to the cent.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={tab} onValueChange={setTab} className="mt-2">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="single" data-testid="tab-merge-single">
                Single Item
              </TabsTrigger>
              <TabsTrigger value="bulk" data-testid="tab-merge-bulk">
                Bulk via Excel
              </TabsTrigger>
              <TabsTrigger value="history" data-testid="tab-merge-history">
                History
              </TabsTrigger>
            </TabsList>
            <TabsContent value="single" className="mt-4">
              <MergeStockItemsCard embedded />
            </TabsContent>
            <TabsContent value="bulk" className="mt-4">
              <BulkMergeStockItemsCard embedded />
            </TabsContent>
            <TabsContent value="history" className="mt-4">
              <MergeHistoryCard embedded />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Edit Log helpers ──────────────────────────────────────────────────────────
