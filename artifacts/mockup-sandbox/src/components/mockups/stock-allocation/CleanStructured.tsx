import { Search, ChevronRight, AlertTriangle, Download, RefreshCw } from "lucide-react";

export function CleanStructured() {
  const products = [
    {
      name: "HAND BAG 20KG",
      code: "HM011174",
      stock: 245,
      expected: 180,
      loaded: 215,
      balance: 30,
    },
    {
      name: "LADIES LEATHER BELTS MIX",
      code: "LB003421",
      stock: 89,
      expected: 100,
      loaded: 0,
      balance: -11,
    },
    {
      name: "MENS BAGS ASSORTED",
      code: "MB007892",
      stock: 0,
      expected: 45,
      loaded: 45,
      balance: 0,
    },
    {
      name: "SCHOOL BACKPACK 25L",
      code: "SB002156",
      stock: 312,
      expected: 280,
      loaded: 268,
      balance: 44,
    },
    {
      name: "WALLET LADIES PU LEATHER",
      code: "WL004567",
      stock: 156,
      expected: 180,
      loaded: 0,
      balance: -24,
    },
    {
      name: "TRAVEL DUFFLE BAG 60L",
      code: "TD001923",
      stock: 78,
      expected: 55,
      loaded: 62,
      balance: 16,
    },
    {
      name: "BELT MENS GENUINE LEATHER",
      code: "BM009834",
      stock: 45,
      expected: 60,
      loaded: 58,
      balance: -13,
    },
    {
      name: "CROSSBODY BAG CANVAS",
      code: "CB005612",
      stock: 203,
      expected: 150,
      loaded: 147,
      balance: 56,
    },
  ];

  const shortageCount = products.filter(p => p.balance < 0).length;
  const totalStock = products.reduce((sum, p) => sum + p.stock, 0);
  const totalExpected = products.reduce((sum, p) => sum + p.expected, 0);
  const totalLoaded = products.reduce((sum, p) => sum + p.loaded, 0);
  const totalBalance = products.reduce((sum, p) => sum + p.balance, 0);

  return (
    <div className="min-h-screen bg-[#0f1117] text-white font-sans">
      {/* Page Header */}
      <div className="border-b border-slate-800 bg-[#0f1117] px-8 py-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-[22px] font-bold text-white">Stock Allocation</h1>
            <span className="rounded-full bg-slate-700 px-2.5 py-0.5 text-xs font-medium text-slate-300">
              v5
            </span>
            <div className="flex items-center gap-1.5 rounded-md bg-red-950/40 px-2.5 py-1 border border-red-900/50">
              <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
              <span className="text-sm font-semibold text-red-300">{shortageCount * 3} shortages</span>
            </div>
          </div>
          <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">
            Create Proforma
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="border-b border-slate-800 bg-[#161b27] px-8 py-3">
        <div className="flex items-center justify-between">
          {/* Left Group */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Search product or code…"
                className="h-9 w-64 rounded-lg border border-slate-700 bg-[#0f1117] pl-9 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <select className="h-9 rounded-lg border border-slate-700 bg-[#0f1117] px-3 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
              <option>BAGS & BELTS</option>
              <option>CLOTHING</option>
              <option>FOOTWEAR</option>
              <option>ACCESSORIES</option>
            </select>
          </div>

          {/* Right Group */}
          <div className="flex items-center gap-2">
            <button className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 transition-colors">
              Show Zero Rows
            </button>
            <button className="rounded-lg border border-slate-700 bg-transparent px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 transition-colors">
              Negative Only
            </button>
            <button className="rounded-lg border border-slate-700 bg-transparent px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 transition-colors">
              Show Garbage/Wipers (10)
            </button>
            <div className="ml-2 h-6 w-px bg-slate-700" />
            <button className="rounded-lg border border-slate-700 bg-transparent p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors">
              <Download className="h-4 w-4" />
            </button>
            <button className="rounded-lg border border-slate-700 bg-transparent p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="px-8 py-6">
        <div className="overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="border-t-2 border-t-slate-600 pb-3 pr-6 text-left">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Product
                  </div>
                </th>
                <th className="border-t-2 border-t-green-500 pb-3 pr-6 text-right">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Stock Available
                  </div>
                </th>
                <th className="border-t-2 border-t-amber-500 pb-3 pr-6 text-right">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Expected to Load
                  </div>
                </th>
                <th className="border-t-2 border-t-blue-500 pb-3 pr-6 text-right">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Total Loaded
                  </div>
                </th>
                <th className="border-t-2 border-t-slate-600 pb-3 pr-6 text-right">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Available Balance
                  </div>
                </th>
                <th className="border-t-2 border-t-slate-600 pb-3 text-center">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Detail
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {products.map((product, idx) => {
                const isShortage = product.balance < 0;
                const bgClass = idx % 2 === 0 ? "bg-[#0f1117]" : "bg-[#13181f]";
                
                return (
                  <tr
                    key={product.code}
                    className={`border-b border-slate-800/50 ${bgClass} ${
                      isShortage ? "border-l-2 border-l-red-500 bg-red-950/10" : ""
                    }`}
                  >
                    <td className={`py-4 pr-6 ${isShortage ? "pl-4" : "pl-0"}`}>
                      <div className="font-semibold text-white">{product.name}</div>
                      <div className="font-mono text-xs text-slate-400">{product.code}</div>
                    </td>
                    <td className="py-4 pr-6 text-right">
                      <span className={`text-base font-semibold ${product.stock === 0 ? "text-slate-600" : "text-green-400"}`}>
                        {product.stock === 0 ? "0" : product.stock.toLocaleString()}
                      </span>
                    </td>
                    <td className="py-4 pr-6 text-right">
                      <span className="text-base font-semibold text-amber-400">
                        {product.expected.toLocaleString()}
                      </span>
                    </td>
                    <td className="py-4 pr-6 text-right">
                      <span className={`text-base font-semibold ${product.loaded === 0 ? "text-slate-600" : "text-blue-400"}`}>
                        {product.loaded === 0 ? "—" : product.loaded.toLocaleString()}
                      </span>
                    </td>
                    <td className="py-4 pr-6 text-right">
                      <div className="flex flex-col items-end gap-1">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-sm font-bold ${
                            product.balance < 0
                              ? "bg-red-600 text-white"
                              : product.balance === 0
                              ? "bg-slate-700 text-slate-300"
                              : "bg-green-600 text-white"
                          }`}
                        >
                          {product.balance > 0 ? "+" : ""}
                          {product.balance}
                        </span>
                        {product.balance < 0 && (
                          <span className="text-xs text-red-400">
                            need {Math.abs(product.balance)} more
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-4 text-center">
                      <button className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 text-slate-400 hover:border-slate-600 hover:bg-slate-800 hover:text-white transition-colors">
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}

              {/* Totals Row */}
              <tr className="border-t-2 border-slate-700 bg-[#1a1f2e] sticky bottom-0">
                <td className="py-4 pr-6 font-bold text-white">
                  <div className="flex items-center gap-2">
                    <span>Totals</span>
                    <span className="text-slate-500">·</span>
                    <span className="text-sm text-slate-400">{products.length} products</span>
                  </div>
                </td>
                <td className="py-4 pr-6 text-right text-base font-bold text-green-400">
                  {totalStock.toLocaleString()}
                </td>
                <td className="py-4 pr-6 text-right text-base font-bold text-amber-400">
                  {totalExpected.toLocaleString()}
                </td>
                <td className="py-4 pr-6 text-right text-base font-bold text-blue-400">
                  {totalLoaded.toLocaleString()}
                </td>
                <td className="py-4 pr-6 text-right">
                  <span
                    className={`inline-flex rounded-full px-3 py-1 text-base font-bold ${
                      totalBalance < 0
                        ? "bg-red-600 text-white"
                        : totalBalance === 0
                        ? "bg-slate-700 text-slate-300"
                        : "bg-green-600 text-white"
                    }`}
                  >
                    {totalBalance > 0 ? "+" : ""}
                    {totalBalance}
                  </span>
                </td>
                <td className="py-4"></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
