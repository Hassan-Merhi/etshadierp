import { db } from "../db";
import { factoryUserProfiles } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface ExportPriceVisibility {
  hideSelling: boolean;
  hideCost: boolean;
}

export async function getExportPriceVisibility(req: any): Promise<ExportPriceVisibility> {
  try {
    const userId = req.user?.id ? String(req.user.id) : null;
    if (!userId) return { hideSelling: false, hideCost: false };

    const [profile] = await db
      .select({ hiddenCostFields: factoryUserProfiles.hiddenCostFields })
      .from(factoryUserProfiles)
      .where(eq(factoryUserProfiles.userId, userId))
      .limit(1);

    const fields: string[] = profile?.hiddenCostFields ?? [];
    return {
      hideSelling: fields.includes("hide_export_selling_price"),
      hideCost: fields.includes("hide_export_cost_price"),
    };
  } catch {
    return { hideSelling: false, hideCost: false };
  }
}
