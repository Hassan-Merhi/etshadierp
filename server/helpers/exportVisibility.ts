import { db } from "../db";
import { factoryUserProfiles } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface ExportPriceVisibility {
  hideSelling: boolean;
  hideCost: boolean;
  hideProformaPrice: boolean;
}

export async function getExportPriceVisibility(req: any): Promise<ExportPriceVisibility> {
  try {
    const userId = req.user?.id ? String(req.user.id) : null;
    if (!userId) return { hideSelling: true, hideCost: true, hideProformaPrice: true };

    // Non-admin / non-owner users never see prices in exports
    const role: string = req.user?.role || "";
    if (role !== "Admin" && role !== "Owner" && role !== "Developer") {
      return { hideSelling: true, hideCost: true, hideProformaPrice: true };
    }

    const [profile] = await db
      .select({ hiddenCostFields: factoryUserProfiles.hiddenCostFields })
      .from(factoryUserProfiles)
      .where(eq(factoryUserProfiles.userId, userId))
      .limit(1);

    const fields: string[] = profile?.hiddenCostFields ?? [];
    return {
      hideSelling: fields.includes("hide_export_selling_price"),
      hideCost: fields.includes("hide_export_cost_price"),
      hideProformaPrice: fields.includes("hide_proforma_price") || fields.includes("hide_export_selling_price"),
    };
  } catch {
    return { hideSelling: false, hideCost: false, hideProformaPrice: false };
  }
}
