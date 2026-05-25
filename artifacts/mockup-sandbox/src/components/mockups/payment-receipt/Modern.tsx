import React from "react";
import { ChevronDown, Printer, Download, Plus, Trash2, CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export function Modern() {
  return (
    <div className="min-h-screen bg-slate-50 flex justify-center py-10 px-4 font-sans text-slate-900">
      <div className="w-full max-w-4xl bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col border border-slate-200">
        
        {/* Header - Rich Dark */}
        <div className="bg-slate-900 text-white px-8 py-6 flex items-center justify-between">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">Payment Voucher</h1>
              <Badge className="bg-emerald-500 hover:bg-emerald-600 text-white border-none text-xs font-semibold px-2 py-0.5 rounded-full">
                #PV-2026-0042
              </Badge>
              <Badge variant="outline" className="text-amber-300 border-amber-300/30 bg-amber-300/10 text-xs font-medium px-2 py-0.5 rounded-full">
                Editing
              </Badge>
            </div>
            <p className="text-slate-400 text-sm">Record a payment from your bank or cash account</p>
          </div>
          
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="text-slate-300 hover:text-white hover:bg-slate-800">
              <Printer className="w-4 h-4 mr-2" />
              Print
            </Button>
            <Button variant="ghost" size="sm" className="text-slate-300 hover:text-white hover:bg-slate-800">
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
          </div>
        </div>

        {/* Top Form Section */}
        <div className="p-8 pb-6 border-b border-slate-100 bg-white">
          <div className="grid grid-cols-2 gap-8">
            {/* Pay From Field */}
            <div className="relative group">
              <label className="absolute -top-2.5 left-3 bg-white px-1 text-xs font-medium text-slate-500 z-10 transition-colors group-focus-within:text-blue-600">
                Pay From
              </label>
              <div className="relative flex items-center border border-slate-300 rounded-lg focus-within:border-blue-600 focus-within:ring-1 focus-within:ring-blue-600 transition-all bg-white overflow-hidden">
                <input 
                  type="text" 
                  defaultValue="HBL Main Account"
                  className="w-full pl-4 pr-10 py-3 text-slate-900 font-medium outline-none bg-transparent"
                />
                <div className="absolute right-3 flex items-center pointer-events-none text-slate-400">
                  <ChevronDown className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2 text-sm">
                <span className="text-slate-500">Current Balance:</span>
                <span className="font-semibold text-slate-700">PKR 1,200,000 CR</span>
                <span className="text-slate-300 px-1">→</span>
                <span className="text-slate-500">Projected:</span>
                <span className="font-semibold text-emerald-600">PKR 950,000 CR</span>
              </div>
            </div>

            {/* Date Field */}
            <div className="relative group">
              <label className="absolute -top-2.5 left-3 bg-white px-1 text-xs font-medium text-slate-500 z-10 transition-colors group-focus-within:text-blue-600">
                Date
              </label>
              <div className="relative flex items-center border border-slate-300 rounded-lg focus-within:border-blue-600 focus-within:ring-1 focus-within:ring-blue-600 transition-all bg-white overflow-hidden">
                <input 
                  type="date" 
                  defaultValue="2026-05-25"
                  className="w-full pl-4 pr-10 py-3 text-slate-900 font-medium outline-none bg-transparent appearance-none"
                />
                <div className="absolute right-3 flex items-center pointer-events-none text-slate-400">
                  <CalendarIcon className="w-4 h-4" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Entries Table - Full Bleed */}
        <div className="flex-1 overflow-auto bg-slate-50/50">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-slate-100/80 backdrop-blur-md z-10 border-y border-slate-200">
              <tr>
                <th className="px-8 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider w-1/3">Account</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Notes</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right w-48">Amount</th>
                <th className="px-8 py-3 w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {/* Row 1 */}
              <tr className="group hover:bg-slate-50 transition-colors">
                <td className="px-8 py-4">
                  <div className="font-medium text-slate-900">Ahmad & Sons</div>
                </td>
                <td className="px-4 py-4">
                  <input type="text" defaultValue="May invoice" className="w-full bg-transparent border-0 border-b border-transparent group-hover:border-slate-200 focus:border-blue-500 focus:ring-0 px-0 py-1 text-sm outline-none transition-colors text-slate-600" />
                </td>
                <td className="px-4 py-4 text-right">
                  <input type="text" defaultValue="PKR 150,000" className="w-full bg-transparent border-0 border-b border-transparent group-hover:border-slate-200 focus:border-blue-500 focus:ring-0 px-0 py-1 text-sm outline-none transition-colors text-slate-900 font-medium text-right" />
                </td>
                <td className="px-8 py-4 text-right opacity-0 group-hover:opacity-100 transition-opacity">
                  <button className="text-slate-400 hover:text-red-500 transition-colors p-1 rounded-md hover:bg-red-50">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
              
              {/* Row 2 */}
              <tr className="group hover:bg-slate-50 transition-colors">
                <td className="px-8 py-4">
                  <div className="font-medium text-slate-900">Freight Charges</div>
                </td>
                <td className="px-4 py-4">
                  <input type="text" defaultValue="Container #C-041" className="w-full bg-transparent border-0 border-b border-transparent group-hover:border-slate-200 focus:border-blue-500 focus:ring-0 px-0 py-1 text-sm outline-none transition-colors text-slate-600" />
                </td>
                <td className="px-4 py-4 text-right">
                  <input type="text" defaultValue="PKR 65,000" className="w-full bg-transparent border-0 border-b border-transparent group-hover:border-slate-200 focus:border-blue-500 focus:ring-0 px-0 py-1 text-sm outline-none transition-colors text-slate-900 font-medium text-right" />
                </td>
                <td className="px-8 py-4 text-right opacity-0 group-hover:opacity-100 transition-opacity">
                  <button className="text-slate-400 hover:text-red-500 transition-colors p-1 rounded-md hover:bg-red-50">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
              
              {/* Row 3 */}
              <tr className="group hover:bg-slate-50 transition-colors">
                <td className="px-8 py-4">
                  <div className="font-medium text-slate-900">Bank Charges</div>
                </td>
                <td className="px-4 py-4">
                  <input type="text" placeholder="Add a note..." className="w-full bg-transparent border-0 border-b border-transparent group-hover:border-slate-200 focus:border-blue-500 focus:ring-0 px-0 py-1 text-sm outline-none transition-colors text-slate-600 placeholder:text-slate-300" />
                </td>
                <td className="px-4 py-4 text-right">
                  <input type="text" defaultValue="PKR 35,000" className="w-full bg-transparent border-0 border-b border-transparent group-hover:border-slate-200 focus:border-blue-500 focus:ring-0 px-0 py-1 text-sm outline-none transition-colors text-slate-900 font-medium text-right" />
                </td>
                <td className="px-8 py-4 text-right opacity-0 group-hover:opacity-100 transition-opacity">
                  <button className="text-slate-400 hover:text-red-500 transition-colors p-1 rounded-md hover:bg-red-50">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          
          <div className="px-8 py-4 bg-white">
            <Button variant="outline" size="sm" className="text-blue-600 border-blue-200 bg-blue-50 hover:bg-blue-100 hover:text-blue-700">
              <Plus className="w-4 h-4 mr-1" />
              Add Line
            </Button>
          </div>
        </div>

        {/* Summary Footer */}
        <div className="bg-slate-50 border-t border-slate-200 px-8 py-6">
          <div className="flex items-center justify-between mb-8">
            <div className="text-sm font-medium text-slate-500 bg-slate-200/50 px-3 py-1 rounded-md">
              Lines: 3
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-sm font-medium text-slate-500 uppercase tracking-widest">Total Payment</span>
              <span className="text-4xl font-extrabold text-slate-900 tracking-tight text-right">PKR 250,000</span>
            </div>
          </div>
          
          {/* Bottom Controls */}
          <div className="grid grid-cols-12 gap-8 items-end">
            <div className="col-span-8 flex flex-col gap-4">
              <div className="space-y-3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between cursor-pointer">
                  <Label htmlFor="notes" className="text-sm font-medium text-slate-700 flex items-center gap-2 cursor-pointer">
                    Voucher Notes
                  </Label>
                  <ChevronDown className="w-4 h-4 text-slate-400 transform rotate-180 transition-transform" />
                </div>
                <Textarea 
                  id="notes" 
                  placeholder="Internal notes or description for this voucher..." 
                  className="min-h-[80px] resize-none border-slate-200 focus-visible:ring-blue-500"
                  defaultValue="Settling balances for May containers."
                />
              </div>
              
              <div className="flex items-center space-x-2">
                <Switch id="optional" />
                <Label htmlFor="optional" className="text-sm text-slate-600 cursor-pointer">
                  Mark as Optional / Draft
                </Label>
              </div>
            </div>
            
            <div className="col-span-4">
              <Button className="w-full h-14 text-lg font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-lg shadow-blue-600/20 transition-all active:scale-[0.98]">
                Save Voucher
                <span className="mx-2 opacity-50 font-normal">·</span>
                PKR 250K
              </Button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
