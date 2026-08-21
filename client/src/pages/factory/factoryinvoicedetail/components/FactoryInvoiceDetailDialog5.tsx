import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeftRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { useFactoryInvoiceDetailModel } from "../useFactoryInvoiceDetailModel";

type Model = ReturnType<typeof useFactoryInvoiceDetailModel>;

export function FactoryInvoiceDetailDialog5({ model }: { model: Model }) {
  const {
    exchangeBale,
    setExchangeBale,
    newRefInput,
    setNewRefInput,
    exchangeMutation,
  } = model;
  return (
    <Dialog
              open={exchangeBale !== null}
              onOpenChange={(open) => {
                if (!open) {
                  setExchangeBale(null);
                  setNewRefInput("");
                }
              }}
            >
              <DialogContent className="max-w-sm">
                <DialogHeader>
                  <DialogTitle className="text-base flex items-center gap-2">
                    <ArrowLeftRight className="h-4 w-4" />
                    Exchange Bale
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">Removing: </span>
                    <span className="font-mono font-medium">{exchangeBale?.reference}</span>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Replacement bale reference</label>
                    <Input
                      placeholder="e.g. REF12345"
                      value={newRefInput}
                      onChange={(e) => setNewRefInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newRefInput.trim() && exchangeBale) {
                          exchangeMutation.mutate({
                            orderBaleId: exchangeBale.orderBaleId,
                            newBaleReference: newRefInput.trim(),
                          });
                        }
                      }}
                      data-testid="input-exchange-bale-ref"
                      autoFocus
                    />
                    <p className="text-xs text-muted-foreground">
                      The replacement bale must be in stock. Price is preserved.
                    </p>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setExchangeBale(null);
                        setNewRefInput("");
                      }}
                      data-testid="button-cancel-exchange"
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={() => {
                        if (exchangeBale && newRefInput.trim())
                          exchangeMutation.mutate({
                            orderBaleId: exchangeBale.orderBaleId,
                            newBaleReference: newRefInput.trim(),
                          });
                      }}
                      disabled={!newRefInput.trim() || exchangeMutation.isPending}
                      data-testid="button-confirm-exchange"
                    >
                      <ArrowLeftRight className="mr-2 h-4 w-4" />
                      {exchangeMutation.isPending ? "Exchanging…" : "Exchange"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
  );
}
