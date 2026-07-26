export interface GlobalVoucherRouteMatch {
  voucherId: number;
  view: "detail" | "view-entries";
}

export function classifyGlobalVoucherRoute(path: string): GlobalVoucherRouteMatch | null {
  const match = path.match(
    /^\/api\/global\/transactions\/(\d+)\/(detail|view-entries)$/
  );
  if (!match) return null;

  const voucherId = Number(match[1]);
  if (!Number.isSafeInteger(voucherId) || voucherId <= 0) return null;
  return { voucherId, view: match[2] as GlobalVoucherRouteMatch["view"] };
}
