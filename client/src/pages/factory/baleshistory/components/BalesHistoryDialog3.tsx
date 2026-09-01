import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { generateCombinedLabelsHtml, generateStickerLabelsHtml, prefetchBannersForPrint } from "@/lib/labelHtml";
import type { useBalesHistoryModel } from "../useBalesHistoryModel";

type Model = ReturnType<typeof useBalesHistoryModel>;

export function BalesHistoryDialog3({ model }: { model: Model }) {
  const {
    designColors,
    designPickerOpen,
    setDesignPickerOpen,
    pendingReprintLabels,
    setPendingReprintLabels,
    openBrowserReprint,
  } = model;
  return (
    <Dialog
      open={designPickerOpen}
      onOpenChange={(open) => {
        if (!open) {
          setDesignPickerOpen(false);
          setPendingReprintLabels(null);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Choose Label Design</DialogTitle>
          <DialogDescription>Select a brand color for the A4 label header banner.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          {designColors.map((opt) => (
            <button
              key={opt.value}
              data-testid={`button-design-${opt.value}`}
              className="flex flex-col items-center gap-2 p-3 rounded-md border hover-elevate cursor-pointer"
              onClick={() => {
                setDesignPickerOpen(false);
                if (pendingReprintLabels) {
                  const labels = pendingReprintLabels;
                  setPendingReprintLabels(null);
                  openBrowserReprint(labels, opt.value);
                }
              }}
            >
              <img src={opt.previewUrl} className="w-full h-16 rounded-md object-cover" alt={opt.label} />
              <span className="text-sm font-medium">{opt.label}</span>
            </button>
          ))}
        </div>
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setDesignPickerOpen(false);
              setPendingReprintLabels(null);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="secondary"
            data-testid="button-design-none"
            onClick={() => {
              setDesignPickerOpen(false);
              if (pendingReprintLabels) {
                const labels = pendingReprintLabels;
                setPendingReprintLabels(null);
                prefetchBannersForPrint();
                const paperHtml = generateCombinedLabelsHtml(labels);
                const stickerHtml = generateStickerLabelsHtml(labels);
                const w1 = window.open("", "_blank", "width=800,height=900");
                if (w1) {
                  w1.document.write(paperHtml);
                  w1.document.close();
                  w1.focus();
                  setTimeout(() => w1.print(), 500);
                }
                const w2 = window.open("", "_blank", "width=400,height=600");
                if (w2) {
                  w2.document.write(stickerHtml);
                  w2.document.close();
                  w2.focus();
                  const imgs = w2.document.images;
                  let loaded = 0;
                  const total = imgs.length;
                  const tryPrint = () => {
                    loaded++;
                    if (loaded >= total) setTimeout(() => w2.print(), 300);
                  };
                  if (total === 0) {
                    setTimeout(() => w2.print(), 300);
                  } else {
                    for (let i = 0; i < total; i++) {
                      if (imgs[i].complete) tryPrint();
                      else imgs[i].onload = imgs[i].onerror = tryPrint;
                    }
                  }
                }
              }
            }}
          >
            No Banner (Blank)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
