import { StockTransferDesktopItemCell } from "./StockTransferDesktopItemCell";
import { StockTransferDesktopQuantityCells } from "./StockTransferDesktopQuantityCells";
import { StockTransferDesktopSourceCell } from "./StockTransferDesktopSourceCell";
import type { StockTransferFormModel } from "./useStockTransferFormModel";

export function StockTransferDesktopRow({ model, index }: { model: StockTransferFormModel; index: number }) {
  return (
    <>
      {!model.isPOS && <StockTransferDesktopSourceCell model={model} index={index} />}
      <StockTransferDesktopItemCell model={model} index={index} />
      <StockTransferDesktopQuantityCells model={model} index={index} />
    </>
  );
}
