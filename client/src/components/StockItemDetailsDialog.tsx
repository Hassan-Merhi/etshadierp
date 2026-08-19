import type { StockItemDetailsDialogProps } from "./stockitemdetailsdialog/types";
import { StockItemDetailsDialogView } from "./stockitemdetailsdialog/StockItemDetailsDialogView";
import { useStockItemDetailsDialog } from "./stockitemdetailsdialog/useStockItemDetailsDialog";

export function StockItemDetailsDialog(props: StockItemDetailsDialogProps) {
  const dialog = useStockItemDetailsDialog(props);
  return <StockItemDetailsDialogView dialog={dialog} />;
}
