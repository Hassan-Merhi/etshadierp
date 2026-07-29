import { Search, Package, AlertTriangle, Layers, Download, RefreshCw, ChevronRight, ArrowUp } from "lucide-react";

export function ModernDashboard() {
  const products = [
    { name: "Premium Leather Tote", code: "PTB-2847", stock: 45, expected: 20, loaded: 65, balance: 19, shortage: false },
    { name: "Canvas Messenger Bag", code: "CMB-1923", stock: 0, expected: 30, loaded: 19, balance: -11, shortage: true },
    { name: "Suede Belt - Brown", code: "SBB-5612", stock: 89, expected: 0, loaded: 89, balance: 34, shortage: false },
    { name: "Woven Crossbody", code: "WCB-8471", stock: 12, expected: 25, loaded: 37, balance: -8, shortage: true },
    { name: "Leather Belt - Black", code: "LBB-3304", stock: 156, expected: 40, loaded: 196, balance: 71, shortage: false },
    { name: "Reversible Belt Kit", code: "RBK-7729", stock: 0, expected: 0, loaded: 0, balance: -15, shortage: true },
    { name: "Mini Bucket Bag", code: "MBB-4456", stock: 67, expected: 15, loaded: 82, balance: 22, shortage: false },
    { name: "Braided Leather Belt", code: "BLB-9183", stock: 0, expected: 48, loaded: 48, balance: -3, shortage: true },
    { name: "Structured Handbag", code: "SHB-2290", stock: 103, expected: 0, loaded: 103, balance: 58, shortage: false },
    { name: "Canvas Belt - Navy", code: "CBN-6651", stock: 41, expected: 12, loaded: 53, balance: 6, shortage: false },
  ];

  const totalStock = products.reduce((sum, p) => sum + p.stock, 0);
  const totalExpected = products.reduce((sum, p) => sum + p.expected, 0);
  const totalLoaded = products.reduce((sum, p) => sum + p.loaded, 0);

  return (
    <div className="min-h-screen bg-[#0c0e14] p-8">
      <div className="max-w-[1280px] mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-[22px] font-bold text-white">Stock Allocation</h1>
            <span className="px-2 py-0.5 text-xs font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded">
              v5
            </span>
          </div>
          
          <div className="flex items-center gap-3">
            {/* Stat Chips */}
            <div className="flex items-center gap-2 px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
              <Package className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-semibold text-emerald-400">311 products</span>
            </div>
            
            <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              <span className="text-sm font-semibold text-red-400">193 shortages</span>
            </div>
            
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <Layers className="w-4 h-4 text-blue-400" />
              <span className="text-sm font-semibold text-blue-400">4,892 units</span>
            </div>

            <button className="ml-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors">
              Create Proforma
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="bg-[#121520] rounded-xl border border-slate-700/50 p-4 mb-6">
          {/* Row 1 */}
          <div className="flex items-center gap-3 mb-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search products..."
                className="w-full pl-10 pr-4 py-2 bg-[#0c0e14] border border-slate-700/50 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
              />
            </div>
            
            <select className="px-4 py-2 bg-[#0c0e14] border border-slate-700/50 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50">
              <option>BAGS & BELTS</option>
              <option>ACCESSORIES</option>
              <option>FOOTWEAR</option>
            </select>

            <div className="w-px h-6 bg-slate-700/50" />

            <button className="p-2 hover:bg-slate-700/30 rounded-lg transition-colors">
              <Download className="w-4 h-4 text-slate-400" />
            </button>
            
            <button className="p-2 hover:bg-slate-700/30 rounded-lg transition-colors">
              <RefreshCw className="w-4 h-4 text-slate-400" />
            </button>
          </div>

          {/* Row 2 - Filters */}
          <div className="flex items-center gap-2">
            <button className="px-3 py-1.5 bg-slate-700/30 hover:bg-slate-700/50 border border-slate-600/30 rounded-full text-xs font-medium text-slate-300 transition-colors">
              Show Zero Rows
            </button>
            <button className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-full text-xs font-medium text-red-400 transition-colors">
              Negative Only
            </button>
            <button className="px-3 py-1.5 bg-slate-700/30 hover:bg-slate-700/50 border border-slate-600/30 rounded-full text-xs font-medium text-slate-300 transition-colors">
              Show Garbage/Wipers (10)
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="bg-[#121520] rounded-xl border border-slate-700/50 overflow-hidden">
          {/* Column Headers */}
          <div className="grid grid-cols-[2fr,1fr,1fr,1fr,1.2fr,80px] gap-4 px-6 py-4 border-b border-slate-700/50">
            <div className="text-xs font-semibold text-white uppercase tracking-wide">Product</div>
            <div className="text-xs font-semibold text-[#4ade80] uppercase tracking-wide">Stock Available</div>
            <div className="text-xs font-semibold text-[#fbbf24] uppercase tracking-wide">Expected to Load</div>
            <div className="text-xs font-semibold text-[#60a5fa] uppercase tracking-wide">Total Loaded</div>
            <div className="text-xs font-semibold text-white uppercase tracking-wide">Available Balance</div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Detail</div>
          </div>

          {/* Rows */}
          <div className="divide-y divide-slate-700/30">
            {products.map((product, idx) => (
              <div
                key={idx}
                className={`grid grid-cols-[2fr,1fr,1fr,1fr,1.2fr,80px] gap-4 px-6 py-4 hover:bg-slate-700/20 transition-colors relative group ${
                  product.shortage ? 'border-l-4 border-l-red-500 bg-red-900/5' : ''
                }`}
              >
                {/* Product */}
                <div>
                  <div className="font-semibold text-white mb-0.5">{product.name}</div>
                  <div className="text-xs font-mono text-slate-400">{product.code}</div>
                </div>

                {/* Stock Available */}
                <div className={`font-semibold ${product.stock > 0 ? 'text-[#4ade80]' : 'text-slate-500'}`}>
                  {product.stock > 0 ? product.stock : '0'}
                </div>

                {/* Expected to Load */}
                <div className={`font-semibold ${product.expected > 0 ? 'text-[#fbbf24]' : 'text-slate-500'}`}>
                  {product.expected > 0 ? product.expected : '—'}
                </div>

                {/* Total Loaded */}
                <div className={`font-semibold ${product.loaded > 0 ? 'text-[#60a5fa]' : 'text-slate-500'}`}>
                  {product.loaded > 0 ? product.loaded : '—'}
                </div>

                {/* Available Balance */}
                <div>
                  {product.balance < 0 ? (
                    <div>
                      <span className="inline-flex items-center px-2 py-0.5 bg-red-500/10 border border-red-500/20 rounded text-sm font-semibold text-red-400">
                        {product.balance}
                      </span>
                      <div className="text-xs text-red-500/60 mt-1">need {Math.abs(product.balance)} more</div>
                    </div>
                  ) : product.balance > 0 ? (
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-semibold text-emerald-400">+{product.balance}</span>
                      <ArrowUp className="w-3 h-3 text-emerald-400" />
                    </div>
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </div>

                {/* Detail */}
                <div>
                  <button className="p-1.5 hover:bg-slate-700/40 rounded transition-colors opacity-0 group-hover:opacity-100">
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Totals Row */}
          <div className="grid grid-cols-[2fr,1fr,1fr,1fr,1.2fr,80px] gap-4 px-6 py-4 bg-slate-800/80 backdrop-blur-sm border-t border-slate-700/50 sticky bottom-0">
            <div className="font-bold text-white">
              Totals <span className="text-slate-400 font-normal">({products.length} products)</span>
            </div>
            <div className="font-bold text-[#4ade80]">{totalStock}</div>
            <div className="font-bold text-[#fbbf24]">{totalExpected}</div>
            <div className="font-bold text-[#60a5fa]">{totalLoaded}</div>
            <div className="font-bold text-white">—</div>
            <div></div>
          </div>
        </div>
      </div>
    </div>
  );
}
