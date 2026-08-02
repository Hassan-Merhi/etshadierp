/**
 * FormButtons — extracted sub-component.
 *
 * Extracted from AccountingCreate.tsx during the Phase 4 god-file split.
 */
import { Button } from "@/components/ui/button";

export // Reusable Form Buttons Component
function FormButtons({ onCancel, isPending }: { onCancel: () => void; isPending: boolean }) {
  return (
    <div className="flex flex-wrap gap-2 justify-end border-t pt-4">
      <Button type="button" variant="outline" onClick={onCancel} disabled={isPending} data-testid="button-cancel">
        Cancel
      </Button>
      <Button type="submit" disabled={isPending} data-testid="button-save">
        {isPending ? "Saving..." : "Save"}
      </Button>
    </div>
  );
}
