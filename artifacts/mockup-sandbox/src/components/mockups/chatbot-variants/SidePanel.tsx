import React, { useState } from 'react';
import { Send, X, Bot, User, Menu, Search, Bell, Home, Box, FileText, Settings, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';

export function SidePanel() {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: 'I see you\'re looking at the Inventory dashboard. I can help you check stock levels, initiate transfers, or forecast reorder dates. How can I assist?',
    },
    {
      role: 'user',
      content: 'Which products in warehouse A are below their minimum threshold?',
    },
    {
      role: 'assistant',
      content: 'Let me check that for you.\n\nCurrently, 3 products in Warehouse A are below their minimum threshold:\n- **Widget X1** (Current: 14, Min: 50)\n- **Thermal Paste Pro** (Current: 5, Min: 20)\n- **Copper Heatsink** (Current: 0, Min: 10)\n\nWould you like me to draft a purchase order for these items to our primary suppliers?',
    }
  ]);
  const [inputValue, setInputValue] = useState('');

  return (
    <div className="flex h-screen w-full bg-slate-50 overflow-hidden font-sans">
      {/* Fake App Background */}
      <div className="flex-1 flex flex-col overflow-hidden opacity-60">
        <header className="h-14 border-b bg-white flex items-center px-4 justify-between shrink-0">
          <div className="flex items-center gap-4">
            <Menu className="w-5 h-5 text-slate-500" />
            <div className="font-semibold text-slate-700">ERP System</div>
          </div>
          <div className="flex items-center gap-4">
            <Search className="w-5 h-5 text-slate-500" />
            <Bell className="w-5 h-5 text-slate-500" />
            <div className="w-8 h-8 rounded-full bg-slate-200"></div>
          </div>
        </header>
        <div className="flex flex-1 overflow-hidden">
          <aside className="w-64 border-r bg-white p-4 hidden md:block shrink-0">
            <nav className="space-y-2 text-sm text-slate-600">
              <div className="flex items-center gap-3 p-2 rounded-md hover:bg-slate-100"><Home className="w-4 h-4" /> Dashboard</div>
              <div className="flex items-center gap-3 p-2 rounded-md bg-blue-50 text-blue-700 font-medium"><Box className="w-4 h-4" /> Inventory</div>
              <div className="flex items-center gap-3 p-2 rounded-md hover:bg-slate-100"><FileText className="w-4 h-4" /> Orders</div>
              <div className="flex items-center gap-3 p-2 rounded-md hover:bg-slate-100"><Settings className="w-4 h-4" /> Settings</div>
            </nav>
          </aside>
          <main className="flex-1 p-6 overflow-auto">
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-slate-800">Inventory Dashboard</h1>
                <Button>New Transfer</Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-white rounded-lg shadow-sm border">
                  <div className="text-sm text-slate-500 mb-1">Total Items</div>
                  <div className="text-2xl font-bold">12,403</div>
                </div>
                <div className="p-4 bg-white rounded-lg shadow-sm border border-red-100">
                  <div className="text-sm text-red-500 mb-1">Low Stock Alerts</div>
                  <div className="text-2xl font-bold text-red-700">8</div>
                </div>
                <div className="p-4 bg-white rounded-lg shadow-sm border">
                  <div className="text-sm text-slate-500 mb-1">Pending Transfers</div>
                  <div className="text-2xl font-bold">3</div>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>

      {/* Side Panel Assistant */}
      <div className="w-[380px] bg-white border-l shadow-2xl flex flex-col h-full shrink-0 relative z-10 transition-transform duration-300 transform translate-x-0">
        
        {/* Header */}
        <div className="px-5 py-4 border-b shrink-0 flex items-center justify-between bg-white/80 backdrop-blur-sm sticky top-0 z-10">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-blue-600 text-white flex items-center justify-center shadow-sm">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-900 leading-none">Copilot</h2>
              <span className="text-xs text-slate-500">Always here to help</span>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-slate-800 rounded-full hover:bg-slate-100">
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Context Pill */}
        <div className="px-5 pt-3 pb-1 shrink-0 bg-slate-50/50">
          <Badge variant="secondary" className="bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-100 shadow-sm font-medium px-2 py-0.5 flex items-center gap-1.5 w-fit">
            <Box className="w-3 h-3" />
            Context: Inventory
          </Badge>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 p-5">
          <div className="flex flex-col gap-6 pb-4">
            <div className="text-center text-xs text-slate-400 my-2">Today at 10:24 AM</div>
            
            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <Avatar className="w-8 h-8 border shadow-sm">
                  {msg.role === 'assistant' ? (
                    <div className="w-full h-full bg-blue-600 text-white flex items-center justify-center">
                      <Sparkles className="w-4 h-4" />
                    </div>
                  ) : (
                    <div className="w-full h-full bg-slate-200 text-slate-600 flex items-center justify-center font-medium">
                      U
                    </div>
                  )}
                </Avatar>
                
                <div className={`flex flex-col gap-1 max-w-[80%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className="flex items-center gap-2 px-1">
                    <span className="text-xs font-medium text-slate-500">{msg.role === 'assistant' ? 'Copilot' : 'You'}</span>
                  </div>
                  <div className={`p-3.5 rounded-2xl text-[14px] leading-relaxed shadow-sm ${
                    msg.role === 'user' 
                      ? 'bg-slate-900 text-white rounded-tr-sm' 
                      : 'bg-white border text-slate-700 rounded-tl-sm'
                  }`}>
                    {msg.content.split('\n').map((line, j) => (
                      <React.Fragment key={j}>
                        {line.startsWith('- **') ? (
                          <div className="pl-2 relative my-1">
                            <span className="absolute left-0 top-1.5 w-1 h-1 rounded-full bg-slate-400"></span>
                            <span className="ml-2 font-medium">{line.match(/\*\*(.*?)\*\*/)?.[1]}</span>
                            <span>{line.replace(/- \*\*(.*?)\*\*/, '')}</span>
                          </div>
                        ) : (
                          <span>{line}</span>
                        )}
                        {j < msg.content.split('\n').length - 1 && <br />}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              </div>
            ))}
            
            {/* Suggestion Chips */}
            <div className="flex flex-col gap-2 pl-11 pt-2">
              <button className="text-left px-4 py-2.5 rounded-xl border border-blue-100 bg-blue-50/50 hover:bg-blue-50 text-blue-700 text-sm font-medium transition-colors w-fit shadow-sm">
                Draft PO for Warehouse A
              </button>
              <button className="text-left px-4 py-2.5 rounded-xl border hover:bg-slate-50 text-slate-700 text-sm font-medium transition-colors w-fit shadow-sm">
                View supplier lead times
              </button>
            </div>
          </div>
        </ScrollArea>

        {/* Input Area */}
        <div className="p-4 border-t bg-white shrink-0">
          <div className="relative flex items-end gap-2 bg-slate-50 border rounded-xl focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-500 transition-all shadow-sm">
            <Textarea 
              placeholder="Ask a question..."
              className="min-h-[52px] max-h-32 resize-none border-0 focus-visible:ring-0 bg-transparent py-3.5 px-4 scrollbar-thin leading-relaxed"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
            />
            <div className="p-2 shrink-0">
              <Button 
                size="icon" 
                className={`h-9 w-9 rounded-lg transition-all ${inputValue.trim() ? 'bg-blue-600 text-white shadow-md' : 'bg-slate-200 text-slate-400'}`}
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <div className="text-center mt-3">
            <span className="text-[10px] text-slate-400 font-medium tracking-wide uppercase">AI responses may be inaccurate</span>
          </div>
        </div>
        
      </div>
    </div>
  );
}
