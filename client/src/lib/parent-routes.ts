export function getParentRoute(pathname: string): string | null {
  if (pathname.startsWith("/factory/")) {
    if (/^\/factory\/employees\/\d+/.test(pathname)) return "/factory/payroll-hub?tab=employees";
    if (/^\/factory\/workers\/\d+/.test(pathname)) return "/factory/payroll-hub?tab=workers";
    if (/^\/factory\/customers\/\d+/.test(pathname)) return "/factory/customers";
    if (pathname === "/factory/containers/new") return "/factory/containers";
    if (/^\/factory\/raw-stock\/opening-balance\/\d+\/edit/.test(pathname)) return "/factory/raw-materials";
    if (/^\/factory\/sales\/invoices\/\d+/.test(pathname)) return "/factory/invoicing?tab=invoices";
    if (/^\/factory\/sales\/pending-invoices\/\d+\/verify/.test(pathname)) return "/factory/invoicing?tab=invoices";
    {
      const m = pathname.match(/^\/factory\/invoices\/(\d+)\/loading-scan/);
      if (m) return `/factory/sales/invoices/${m[1]}`;
    }
    if (/^\/factory\/stock-query\/\d+/.test(pathname)) return "/factory/stock-query";
    {
      const m = pathname.match(/^\/factory\/ledger-vouchers\/([^/]+)\//);
      if (m) return `/factory/ledger-monthly/${m[1]}`;
    }
    if (/^\/factory\/ledger-monthly\//.test(pathname)) return "/factory/accounts";
    {
      const m = pathname.match(/^\/factory\/bale-product-history\/(\d+)\/(\d+)\/\d+(?:\/(?:all|\d+))?/);
      if (m) return `/factory/bale-product-history/${m[1]}/${m[2]}`;
    }
    if (/^\/factory\/bale-product-history\/\d+\/\d+/.test(pathname)) return "/factory/location-inventory";
    if (/^\/factory\/voucher-detail\//.test(pathname)) return "/factory/vouchers";
    if (/^\/factory\/vouchers\/\d+\/edit/.test(pathname)) return "/factory/vouchers";
    return null;
  }

  if (pathname.startsWith("/properties/")) {
    if (/^\/properties\/voucher-detail\//.test(pathname)) return "/properties/vouchers";
    if (/^\/properties\/vouchers\/\d+\/edit/.test(pathname)) return "/properties/vouchers";
    {
      const m = pathname.match(/^\/properties\/ledger-vouchers\/([^/]+)\//);
      if (m) return `/properties/ledger-monthly/${m[1]}`;
    }
    if (/^\/properties\/ledger-monthly\//.test(pathname)) return "/properties/accounts";
    return null;
  }

  if (/^\/suppliers\/\d+\/edit/.test(pathname)) return "/parties?tab=suppliers";
  if (/^\/suppliers\/\d+\/proformas/.test(pathname)) return "/parties?tab=suppliers";
  if (/^\/purchase-orders\/\d+\/edit/.test(pathname)) return "/containers";
  if (/^\/containers\/\d+\/verification/.test(pathname)) {
    const m = pathname.match(/^\/containers\/(\d+)\//);
    return m ? `/containers/${m[1]}` : "/containers";
  }
  if (/^\/containers\/\d+/.test(pathname)) return "/containers";
  if (/^\/offloads\/\d+/.test(pathname)) return "/containers";
  if (pathname.startsWith("/sales-report/")) return "/sales-report";
  {
    const m = pathname.match(/^\/ledger-vouchers\/([^/]+)\//);
    if (m) return `/ledger-monthly/${m[1]}`;
  }
  if (/^\/ledger-monthly\//.test(pathname)) return "/accounts";
  if (/^\/stock-query\/\d+/.test(pathname)) return "/stock-query";
  if (/^\/stock-items\/\d+\/history\/\d+\/\d+/.test(pathname)) {
    const m = pathname.match(/^\/stock-items\/(\d+)\/history/);
    return m ? `/stock-items/${m[1]}/history` : "/stock-items";
  }
  if (/^\/stock-items\/\d+\/history/.test(pathname)) return "/stock-items";
  if (/^\/stock-items\/\d+\/monthly-summary/.test(pathname)) return "/location-inventory";
  if (/^\/locations\/\d+\/stock-items\/\d+\/vouchers\/\d+\/\d+/.test(pathname)) {
    const m = pathname.match(/^\/locations\/(\d+)\/stock-items\/(\d+)\//);
    return m ? `/locations/${m[1]}/stock-items/${m[2]}/history` : "/location-inventory";
  }
  if (/^\/locations\/\d+\/stock-items\/\d+\/history/.test(pathname)) return "/location-inventory";
  if (/^\/voucher-detail\//.test(pathname)) return "/vouchers";
  if (/^\/vouchers\/\d+\/edit/.test(pathname)) return "/vouchers";
  if (/^\/opening-stock\/[^/]+/.test(pathname)) return "/opening-stock";
  if (/^\/closing-stock\/[^/]+/.test(pathname)) return "/closing-stock-summary";

  return null;
}
