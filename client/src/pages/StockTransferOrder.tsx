import { StockTransferOrderView } from "./stock-transfer-order/StockTransferOrderView";
import { useStockTransferOrderModel } from "./stock-transfer-order/useStockTransferOrderModel";

export default function StockTransferOrder() {
  const model = useStockTransferOrderModel();
  return <StockTransferOrderView model={model} />;
}
