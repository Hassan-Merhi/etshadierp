import type { OrderBale } from "./types";
export interface LoadingBaleGroup {
  articleCode: string;
  baleName: string;
  bales: OrderBale[];
  totalWeight: number;
}
export function groupLoadingBales(bales: readonly OrderBale[]): Record<string, LoadingBaleGroup> {
  return bales.reduce<Record<string, LoadingBaleGroup>>((acc, bale) => {
    const key = bale.articleCode;
    if (!acc[key]) acc[key] = { articleCode: bale.articleCode, baleName: bale.baleName, bales: [], totalWeight: 0 };
    acc[key].bales.push(bale);
    acc[key].totalWeight += parseFloat(bale.weight || "0");
    return acc;
  }, {});
}
export function orderLoadingGroups(groups: Record<string, LoadingBaleGroup>): LoadingBaleGroup[] {
  return Object.values(groups).sort(
    (a, b) => Math.max(...b.bales.map((x) => x.id)) - Math.max(...a.bales.map((x) => x.id))
  );
}
