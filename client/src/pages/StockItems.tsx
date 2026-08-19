import { StockItemsView } from "./stockitems/StockItemsView";
import { useStockItems } from "./stockitems/useStockItems";

export default function StockItems() {
  const stockItems = useStockItems();
  return <StockItemsView stockItems={stockItems} />;
}
