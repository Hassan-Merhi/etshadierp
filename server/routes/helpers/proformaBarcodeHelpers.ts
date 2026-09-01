/**
 * Shared barcode/alias helpers for supplier-proforma and container-loaded-item
 * matching. Extracted from supplierProformaRoutes.ts so both the proforma
 * routes and the container-loaded-items routes can import them without a
 * circular dependency. Behaviour is unchanged.
 */
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { stockItemCodeAliases, stockItems } from "@shared/schema";

export interface AliasConflict {
  aliasCode: string; // the alias code that is misconfigured
  aliasedToCode: string; // stock item the alias table points it at
  aliasedToName: string;
  ownerCode: string; // the stock item whose OWN primary code this alias code collides with
  ownerName: string;
}

/**
 * Builds the alias-code → primary-barcode lookup used to match proforma lines
 * and loaded container items to the same underlying stock item.
 *
 * Guardrail: matching here is strictly by barcode/alias-code identity — never
 * by item name similarity. An alias row is only trusted when its aliasCode is
 * not itself the OWN primary `code` of a *different* stock item. If it is,
 * that's a data-entry conflict (one item's real barcode was mistakenly
 * registered as another item's alias), which is exactly the failure mode
 * that silently swapped two items' loaded prices in the verification report.
 * Conflicting aliases are excluded from the map (the raw code is used
 * unresolved instead) and reported back in `conflicts` so the caller can
 * surface a warning instead of producing a silently wrong comparison.
 */
export async function buildAliasMap(
  companyId: number
): Promise<{ map: Map<string, string>; conflicts: AliasConflict[] }> {
  const [aliases, allItems] = await Promise.all([
    db
      .select({
        aliasCode: stockItemCodeAliases.aliasCode,
        primaryCode: stockItems.code,
        primaryName: stockItems.name,
        primaryId: stockItems.id,
      })
      .from(stockItemCodeAliases)
      .innerJoin(stockItems, eq(stockItemCodeAliases.stockItemId, stockItems.id))
      .where(eq(stockItemCodeAliases.companyId, companyId)),
    db
      .select({ id: stockItems.id, code: stockItems.code, name: stockItems.name })
      .from(stockItems)
      .where(eq(stockItems.companyId, companyId)),
  ]);

  const ownerByCodeLower = new Map(allItems.map((i) => [i.code.trim().toLowerCase(), i]));

  const map = new Map<string, string>();
  const conflicts: AliasConflict[] = [];
  for (const a of aliases) {
    const aliasLower = a.aliasCode.trim().toLowerCase();
    const owner = ownerByCodeLower.get(aliasLower);
    if (owner && owner.id !== a.primaryId) {
      conflicts.push({
        aliasCode: a.aliasCode,
        aliasedToCode: a.primaryCode,
        aliasedToName: a.primaryName,
        ownerCode: owner.code,
        ownerName: owner.name,
      });
      continue; // do not apply — leave this barcode unresolved (matches itself)
    }
    map.set(aliasLower, a.primaryCode);
  }
  return { map, conflicts };
}

export function resolveBarcode(bc: string, aliasMap: Map<string, string>): string {
  const lower = bc.toLowerCase();
  return aliasMap.get(lower) ?? bc;
}
