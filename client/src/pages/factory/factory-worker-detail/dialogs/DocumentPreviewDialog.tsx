/**
 * DocumentPreviewDialog — extracted from FactoryWorkerDetail.tsx during the Phase 4 split.
 *
 * Props are the parent-scope bindings the block referenced; they were
 * discovered from compiler errors rather than guessed.
 */
import { FileImage, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function DocumentPreviewDialog({ setViewingDoc, viewingDoc }: { setViewingDoc: unknown; viewingDoc: unknown }) {
  return (
    <Dialog
      open={viewingDoc !== null}
      onOpenChange={(open) => {
        if (!open) setViewingDoc(null);
      }}
    >
      <DialogContent className="max-w-4xl p-2" data-testid="dialog-view-doc">
        <DialogHeader className="px-3 pt-2 pb-1">
          <DialogTitle className="text-sm font-medium flex items-center gap-2 truncate">
            <FileImage className="h-4 w-4 shrink-0 text-muted-foreground" />
            {viewingDoc?.originalName}
          </DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-center bg-muted/30 rounded-md overflow-hidden min-h-64 max-h-[70vh]">
          {viewingDoc && (
            <img
              src={viewingDoc.fileUrl}
              alt={viewingDoc.originalName}
              className="max-w-full max-h-[70vh] object-contain"
              data-testid="img-doc-preview"
            />
          )}
        </div>
        <div className="flex justify-between items-center px-1 pb-1">
          <p className="text-xs text-muted-foreground">
            {viewingDoc?.fileSize ? `${(viewingDoc.fileSize / 1024).toFixed(1)} KB` : ""}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (viewingDoc) {
                  const a = document.createElement("a");
                  a.href = viewingDoc.fileUrl;
                  a.download = viewingDoc.originalName;
                  a.click();
                }
              }}
              data-testid="button-download-viewing-doc"
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Download
            </Button>
            <Button size="sm" onClick={() => setViewingDoc(null)} data-testid="button-close-doc-viewer">
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
