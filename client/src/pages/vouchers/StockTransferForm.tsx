import type { StockTransferFormProps } from "./stocktransferform/types";
import { StockTransferFormView } from "./stock-transfer-form/StockTransferHeader";
import { useStockTransferFormModel } from "./stock-transfer-form/useStockTransferFormModel";

export function StockTransferForm(props: StockTransferFormProps) {
  const model = useStockTransferFormModel(props);
  return <StockTransferFormView model={model} />;
}
