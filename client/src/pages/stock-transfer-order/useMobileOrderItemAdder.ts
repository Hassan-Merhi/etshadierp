import type { Dispatch, SetStateAction } from "react";
import { useToast } from "@/hooks/use-toast";
import { formatNumber } from "@/lib/formatNumber";
import type {
  Location,
  LocationSummaryResponse,
  OrderItem,
  StockItemOption,
} from "../stocktransferorder/types";

type UseMobileOrderItemAdderInput = {
  mobileSelectedItemId: number | null;
  mobileSourceLocationId: number | null;
  mobileQty: string;
  stockItems: StockItemOption[];
  locations: Location[];
  summaryData: LocationSummaryResponse | undefined;
  orderItems: OrderItem[];
  setOrderItems: Dispatch<SetStateAction<OrderItem[]>>;
  setMobileQty: Dispatch<SetStateAction<string>>;
  setMobileSelectedItemId: Dispatch<SetStateAction<number | null>>;
  setMobileSheetOpen: Dispatch<SetStateAction<boolean>>;
};

export function useMobileOrderItemAdder({
  mobileSelectedItemId,
  mobileSourceLocationId,
  mobileQty,
  stockItems,
  locations,
  summaryData,
  orderItems,
  setOrderItems,
  setMobileQty,
  setMobileSelectedItemId,
  setMobileSheetOpen,
}: UseMobileOrderItemAdderInput) {
  const { toast } = useToast();

  return () => {
    if (!mobileSelectedItemId || !mobileSourceLocationId) {
      toast({ title: "Select a stock item and source location", variant: "destructive" });
      return;
    }

    const quantity = parseFloat(mobileQty);
    if (isNaN(quantity) || quantity <= 0) {
      toast({ title: "Enter a valid quantity", variant: "destructive" });
      return;
    }

    const stockItem = stockItems.find((item) => item.id === mobileSelectedItemId);
    const sourceLocation = locations.find((location) => location.id === mobileSourceLocationId);
    if (!stockItem || !sourceLocation) return;

    let rate = 0;
    let availableQty = 0;
    let hasAvailabilityData = false;
    if (summaryData) {
      let itemFound = false;
      for (const group of summaryData.stockGroups) {
        const matrixItem = group.items.find((item) => item.id === mobileSelectedItemId);
        if (!matrixItem) continue;
        itemFound = true;
        const locationData = matrixItem.locationData[mobileSourceLocationId];
        if (locationData) {
          rate = locationData.rate ?? 0;
          availableQty = locationData.quantity ?? 0;
        }
        break;
      }
      hasAvailabilityData = itemFound;
      if (itemFound && availableQty <= 0) {
        toast({
          title: "No Stock",
          description: `${stockItem.name} has no available stock at ${sourceLocation.name}`,
          variant: "destructive",
        });
        return;
      }
    }

    const existingIndex = orderItems.findIndex(
      (item) =>
        item.stockItemId === mobileSelectedItemId &&
        item.sourceLocationId === mobileSourceLocationId
    );
    const currentAllocated = existingIndex >= 0 ? orderItems[existingIndex].quantity : 0;
    const totalAfterAdd = currentAllocated + quantity;

    if (hasAvailabilityData && totalAfterAdd > availableQty) {
      toast({
        title: "Exceeds Available Stock",
        description: `Can add up to ${formatNumber(availableQty - currentAllocated, 0)} more. Available: ${formatNumber(availableQty, 0)}, In order: ${formatNumber(currentAllocated, 0)}`,
        variant: "destructive",
      });
      return;
    }

    const updatedItems = [...orderItems];
    if (existingIndex >= 0) {
      updatedItems[existingIndex] = { ...updatedItems[existingIndex], quantity: totalAfterAdd };
    } else {
      updatedItems.push({
        stockItemId: stockItem.id,
        stockItemName: stockItem.name,
        stockItemCode: stockItem.code,
        uom: stockItem.uom,
        sourceLocationId: sourceLocation.id,
        sourceLocationName: sourceLocation.name,
        quantity,
        availableQty: hasAvailabilityData ? availableQty : quantity,
        rate,
      });
    }

    updatedItems.sort((left, right) =>
      left.sourceLocationName.localeCompare(right.sourceLocationName)
    );
    setOrderItems(updatedItems);
    setMobileQty("");
    setMobileSelectedItemId(null);
    setMobileSheetOpen(false);
    toast({
      title: "Added to Order",
      description: `${formatNumber(quantity, 0)} ${stockItem.uom} of ${stockItem.name}`,
    });
  };
}
