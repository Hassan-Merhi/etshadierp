import PropertyRentalPage from "@/pages/properties/PropertyRentalPage";
import { Store } from "lucide-react";

export default function ErpRentalShops() {
  return (
    <PropertyRentalPage
      unitType="SHOP"
      pageTitle="ERP — Shop Rentals"
      pageIcon={<Store className="h-7 w-7 text-blue-600" />}
      testIdPrefix="erp-rental-shops"
      apiBase="/api/erp/rental"
    />
  );
}
