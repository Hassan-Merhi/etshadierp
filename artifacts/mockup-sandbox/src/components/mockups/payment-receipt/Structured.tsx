import React, { useState } from "react";
import { 
  Printer, 
  Download, 
  CalendarIcon,
  ChevronsUpDown,
  Check,
  Plus,
  Trash2,
  ChevronDown,
  Info
} from "lucide-react";

export function Structured() {
  const [notesOpen, setNotesOpen] = useState(true);
  const [optionalStatus, setOptionalStatus] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-4 md:p-8 font-sans">
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* Header Area */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Payment Voucher</h1>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-sm font-medium bg-slate-200 text-slate-800">
                PV-2026-089
              </span>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-sm font-medium bg-amber-100 text-amber-800 border border-amber-200">
                Editing
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400 disabled:pointer-events-none disabled:opacity-50 border border-slate-200 bg-white shadow-sm hover:bg-slate-100 h-9 px-4 py-2">
              <Printer className="mr-2 h-4 w-4" />
              Print
            </button>
            <button className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400 disabled:pointer-events-none disabled:opacity-50 border border-slate-200 bg-white shadow-sm hover:bg-slate-100 h-9 px-4 py-2">
              <Download className="mr-2 h-4 w-4" />
              Export
            </button>
          </div>
        </div>

        {/* 1. Payment Source */}
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50/50 px-6 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">1. Payment Source</h2>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Pay From</label>
              <div className="relative">
                <button className="flex w-full items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-slate-400">
                  <span className="truncate font-medium">HBL Main Account</span>
                  <ChevronsUpDown className="h-4 w-4 opacity-50" />
                </button>
              </div>
              <div className="flex items-center text-sm text-slate-500 mt-1.5">
                <Info className="h-4 w-4 mr-1.5 text-slate-400" />
                <span>Current Balance: <span className="font-medium text-slate-700">PKR 1,200,000 CR</span></span>
                <span className="mx-2 text-slate-300">|</span>
                <span>Projected: <span className="font-medium text-slate-700">PKR 950,000 CR</span></span>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Date</label>
              <button className="flex w-full items-center justify-start rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-slate-400 text-left font-normal">
                <CalendarIcon className="mr-2 h-4 w-4 opacity-50" />
                <span>2026-05-25</span>
              </button>
            </div>
          </div>
        </section>

        {/* 2. Entries */}
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50/50 px-6 py-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">2. Entries</h2>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3 w-1/3">Account</th>
                  <th className="px-6 py-3">Notes / Description</th>
                  <th className="px-6 py-3 text-right w-48">Amount</th>
                  <th className="px-6 py-3 w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr className="group hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-3">
                    <div className="font-medium text-slate-900">Ahmad & Sons</div>
                  </td>
                  <td className="px-6 py-3 text-slate-600">May invoice</td>
                  <td className="px-6 py-3 text-right font-medium">PKR 150,000</td>
                  <td className="px-6 py-3 text-right">
                    <button className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
                <tr className="group hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-3">
                    <div className="font-medium text-slate-900">Freight Charges</div>
                  </td>
                  <td className="px-6 py-3 text-slate-600">Container #C-041</td>
                  <td className="px-6 py-3 text-right font-medium">PKR 65,000</td>
                  <td className="px-6 py-3 text-right">
                    <button className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
                <tr className="group hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-3">
                    <div className="font-medium text-slate-900">Bank Charges</div>
                  </td>
                  <td className="px-6 py-3 text-slate-400 italic">No notes</td>
                  <td className="px-6 py-3 text-right font-medium">PKR 35,000</td>
                  <td className="px-6 py-3 text-right">
                    <button className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          
          <div className="p-4 border-t border-slate-200">
            <button className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors text-blue-600 hover:text-blue-700 hover:bg-blue-50 px-4 py-2">
              <Plus className="mr-2 h-4 w-4" />
              Add Entry
            </button>
          </div>

          <div className="bg-slate-50 px-6 py-4 flex items-center justify-between border-t border-slate-200">
            <div className="text-sm font-medium text-slate-500">
              Lines: 3
            </div>
            <div className="text-xl font-bold text-slate-900">
              PKR 250,000
            </div>
          </div>
        </section>

        {/* 3. Summary & Submit */}
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50/50 px-6 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">3. Summary & Submit</h2>
          </div>
          <div className="p-6 space-y-6">
            
            <div className="space-y-4">
              <button 
                onClick={() => setNotesOpen(!notesOpen)}
                className="flex items-center text-sm font-medium text-slate-700 hover:text-slate-900 transition-colors"
              >
                <ChevronDown className={`mr-2 h-4 w-4 transition-transform ${notesOpen ? '' : '-rotate-90'}`} />
                Voucher Notes
              </button>
              
              {notesOpen && (
                <div className="pl-6 animate-in slide-in-from-top-2 duration-200">
                  <textarea 
                    className="flex min-h-[80px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
                    placeholder="Add internal notes or references here..."
                    defaultValue="Payment processed for May invoices and related shipping expenses."
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-100">
              <div className="flex items-center space-x-2">
                <button 
                  onClick={() => setOptionalStatus(!optionalStatus)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white ${optionalStatus ? 'bg-blue-600' : 'bg-slate-200'}`}
                >
                  <span className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform ${optionalStatus ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
                <label className="text-sm font-medium text-slate-700 cursor-pointer" onClick={() => setOptionalStatus(!optionalStatus)}>
                  Mark as Optional / Draft
                </label>
              </div>

              <button className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400 disabled:pointer-events-none disabled:opacity-50 bg-slate-900 text-white shadow hover:bg-slate-800 h-10 px-6 py-2">
                Save Voucher <span className="mx-2 opacity-50">·</span> PKR 250,000
              </button>
            </div>
            
          </div>
        </section>

      </div>
    </div>
  );
}
