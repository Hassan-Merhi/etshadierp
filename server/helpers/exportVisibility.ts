import { db } from "../db";
import { factoryUserProfiles, users } from "@shared/schema";
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

    const role: string = req.user?.role || "";
    // Developer and Admin can always see everything in exports
    if (role === "Developer" || role === "Admin") {
      return { hideSelling: false, hideCost: false, hideProformaPrice: false };
    }

    // All other roles (Owner, Manager, POS, Normal User): check their factoryUserProfiles.hiddenCostFields
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

export interface ErpExportVisibility {
  hideSelling: boolean;
  hideCost: boolean;
  hideSalesProfitCost: boolean;
}

/**
 * ERP/POS context export visibility — reads from users.hiddenErpCostFields.
 * Developer and Admin always see everything.
 * Everyone else respects their individual field restriction settings.
 */
export async function getErpExportVisibility(req: any): Promise<ErpExportVisibility> {
  try {
    const userId = req.user?.id ? String(req.user.id) : null;
    if (!userId) return { hideSelling: false, hideCost: false, hideSalesProfitCost: false };

    const role: string = req.user?.role || "";
    if (role === "Developer" || role === "Admin") {
      return { hideSelling: false, hideCost: false, hideSalesProfitCost: false };
    }

    const [user] = await db
      .select({ hiddenErpCostFields: users.hiddenErpCostFields })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const fields: string[] = user?.hiddenErpCostFields ?? [];
    return {
      hideSelling: fields.includes("hide_export_selling_price"),
      hideCost: fields.includes("hide_export_cost_price"),
      hideSalesProfitCost: fields.includes("sales_profit_cost"),
    };
  } catch {
    return { hideSelling: false, hideCost: false, hideSalesProfitCost: false };
  }
}
