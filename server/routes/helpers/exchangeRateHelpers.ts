import { storage } from "../../storage";
import { logger } from "../../lib/logger";

// ─── Exchange rate ────────────────────────────────────────────────────────────
export async function getCurrentExchangeRate(companyId: number): Promise<string | null> {
  try {
    const company = await storage.getCompanyById(companyId);
    if (!company || !company.displayCurrency || !company.baseCurrency) {
      return null;
    }
    const rate = await storage.getLatestExchangeRate(companyId, company.baseCurrency, company.displayCurrency);
    return rate?.rate || null;
  } catch (error) {
    logger.error("Error fetching exchange rate:", { error: error });
    return null;
  }
}
