export function getParentRoute(pathname: string): string | null {
  if (pathname.startsWith("/factory/")) {
    // Detail pages → hub pages (using hub's section/tab query params)
    if (/^\/factory\/employees\/\d+/.test(pathname)) return "/factory/payroll-hub?section=employees";
    if (/^\/factory\/workers\/\d+/.test(pathname)) return "/factory/payroll-hub?section=workers";
    if (/^\/factory\/customers\/\d+/.test(pathname)) return "/factory/parties?section=customers";
    if (pathname === "/factory/containers/new") return "/factory/containers-hub?section=containers";
    if (/^\/factory\/raw-stock\/opening-balance\/\d+\/edit/.test(pathname)) return "/factory/raw-materials";
    if (/^\/factory\/sales\/invoices\/\d+/.test(pathname)) return "/factory/invoicing?tab=invoices";
    if (/^\/factory\/sales\/pending-invoices\/\d+\/verify/.test(pathname)) return "/factory/invoicing?tab=invoices";
    if (/^\/factory\/sales\/proformas\/\d+\/add-line/.test(pathname)) return "/factory/invoicing";
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
      // dispatch batch ride scan → batch detail
      const m = pathname.match(/^\/factory\/dispatch-batches\/(\d+)\/rides\/\d+\/scan/);
      if (m) return `/factory/dispatch-batches/${m[1]}`;
    }
    if (/^\/factory\/dispatch-batches\/\d+/.test(pathname)) return "/factory/dispatch-batches";
    {
      const m = pathname.match(/^\/factory\/bale-product-history\/(\d+)\/(\d+)\/\d+(?:\/(?:all|\d+))?/);
      if (m) return `/factory/bale-product-history/${m[1]}/${m[2]}`;
    }
    if (/^\/factory\/bale-product-history\/\d+\/\d+/.test(pathname)) return "/factory/location-inventory";
    if (/^\/factory\/voucher-detail\//.test(pathname)) return "/factory/vouchers";
    if (/^\/factory\/vouchers\/\d+\/edit/.test(pathname)) return "/factory/vouchers";
    if (/^\/factory\/net-position-details/.test(pathname)) return "/factory/intelligence/financial-hub";
    if (/^\/factory\/financial-snapshot/.test(pathname)) return "/factory/analytics";
    if (/^\/factory\/import-cycle-diagnostics/.test(pathname)) return "/factory/settings";
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
    if (/^\/properties\/net-position-details/.test(pathname)) return "/properties/settings";
    if (/^\/properties\/import-cycle-diagnostics/.test(pathname)) return "/properties/settings";
    return null;
  }

  // ERP — parties
  if (/^\/suppliers\/\d+\/edit/.test(pathname)) return "/parties?tab=suppliers";
  if (/^\/suppliers\/\d+\/proformas/.test(pathname)) return "/parties?tab=suppliers";

  // ERP — containers / purchase orders
  if (/^\/purchase-orders\/\d+\/edit/.test(pathname)) return "/containers";
  if (/^\/containers\/\d+\/verification/.test(pathname)) {
    const m = pathname.match(/^\/containers\/(\d+)\//);
    return m ? `/containers/${m[1]}` : "/containers";
  }
  if (/^\/containers\/\d+/.test(pathname)) return "/containers";
  if (/^\/offloads\/\d+/.test(pathname)) return "/containers";

  // ERP — sales report
  if (pathname.startsWith("/sales-report/")) return "/sales-report";

  // ERP — accounting / ledger
  {
    const m = pathname.match(/^\/ledger-vouchers\/([^/]+)\//);
    if (m) return `/ledger-monthly/${m[1]}`;
  }
  if (/^\/ledger-monthly\//.test(pathname)) return "/accounts";
  if (/^\/voucher-detail\//.test(pathname)) return "/vouchers";
  if (/^\/vouchers\/\d+\/edit/.test(pathname)) return "/vouchers";

  // ERP — stock / inventory (point to hub URLs where old pages are now redirects)
  if (/^\/stock-query\/\d+/.test(pathname)) return "/stock?tab=query";
  if (/^\/stock-items\/\d+\/history\/\d+\/\d+/.test(pathname)) {
    const m = pathname.match(/^\/stock-items\/(\d+)\/history/);
    return m ? `/stock-items/${m[1]}/history` : "/stock?tab=items";
  }
  if (/^\/stock-items\/\d+\/history/.test(pathname)) return "/stock?tab=items";
  if (/^\/stock-items\/\d+\/monthly-summary/.test(pathname)) return "/inventory?tab=by-location";
  if (/^\/locations\/\d+\/stock-items\/\d+\/vouchers\/\d+\/\d+/.test(pathname)) {
    const m = pathname.match(/^\/locations\/(\d+)\/stock-items\/(\d+)\//);
    return m ? `/locations/${m[1]}/stock-items/${m[2]}/history` : "/inventory?tab=by-location";
  }
  if (/^\/locations\/\d+\/stock-items\/\d+\/history/.test(pathname)) return "/inventory?tab=by-location";

  // ERP — other stock/accounting
  if (/^\/opening-stock\/[^/]+/.test(pathname)) return "/opening-stock";
  if (/^\/closing-stock\/[^/]+/.test(pathname)) return "/closing-stock-summary";

  // ERP — settings sub-pages
  if (/^\/net-position-details/.test(pathname)) return "/settings";
  if (/^\/import-cycle-diagnostics/.test(pathname)) return "/settings";

  return null;
}
