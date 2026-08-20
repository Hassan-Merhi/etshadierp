import { Button } from "@/components/ui/button";

export function StockTransferRowAction({ onAction, testId }: { onAction: () => void; testId: string }) {
  return (
    <Button type="button" variant="ghost" size="icon" onClick={onAction} className="h-8 w-8" data-testid={testId}>
      ×
    </Button>
  );
}
