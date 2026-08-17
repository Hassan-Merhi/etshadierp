import type { OrderBale } from "./types";
export interface FactoryLoadingBaleGroup {
  articleCode: string;
  baleName: string;
  bales: OrderBale[];
  totalWeight: number;
}
export function groupFactoryLoadingBales(bales: readonly OrderBale[]): Record<string, FactoryLoadingBaleGroup> {
  return bales.reduce<Record<string, FactoryLoadingBaleGroup>>((acc, bale) => {
    const key = bale.articleCode ?? "__unknown__";
    if (!acc[key])
      acc[key] = { articleCode: bale.articleCode ?? "", baleName: bale.baleName, bales: [], totalWeight: 0 };
    acc[key].bales.push(bale);
    acc[key].totalWeight += parseFloat(bale.weight || "0");
    return acc;
  }, {});
}
export function orderFactoryLoadingGroups(groups: Record<string, FactoryLoadingBaleGroup>): FactoryLoadingBaleGroup[] {
  return Object.values(groups).sort(
    (a, b) => Math.max(...b.bales.map((x) => x.id)) - Math.max(...a.bales.map((x) => x.id))
  );
}
