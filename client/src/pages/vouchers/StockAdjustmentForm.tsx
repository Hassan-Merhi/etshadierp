import type { StockAdjustmentFormProps } from "./stockadjustmentform/types";
import { StockAdjustmentFormView } from "./stock-adjustment-form/StockAdjustmentFormView";
import { useStockAdjustmentFormModel } from "./stock-adjustment-form/useStockAdjustmentFormModel";

export function StockAdjustmentForm(props: StockAdjustmentFormProps) {
  const model = useStockAdjustmentFormModel(props);
  return <StockAdjustmentFormView model={model} />;
}
