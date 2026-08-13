import { useStockTransferOrderActions } from "./useStockTransferOrderActions";
import { useStockTransferOrderState } from "./useStockTransferOrderState";

export function useStockTransferOrderModel() {
  const state = useStockTransferOrderState();
  const actions = useStockTransferOrderActions(state);

  return {
    ...state,
    ...actions,
    totalBales: state.orderItems.reduce((sum, item) => sum + item.quantity, 0),
  };
}

export type StockTransferOrderModel = ReturnType<typeof useStockTransferOrderModel>;
