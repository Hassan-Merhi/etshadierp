import React, { useState } from "react";
import { format } from "date-fns";
import {
  Calendar as CalendarIcon,
  ChevronDown,
  ChevronUp,
  Download,
  Printer,
  Save,
  Search,
  Check,
  Plus,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export function Clean() {
  const [date, setDate] = useState<Date>(new Date(2026, 4, 25)); // May 25, 2026
  const [accountOpen, setAccountOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(true);

  return (
    <div className="min-h-screen bg-background font-sans text-foreground p-6 sm:p-12">
      <div className="mx-auto max-w-4xl space-y-12">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 border-b border-border/40 pb-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-light tracking-tight">Payment Voucher</h1>
              <Badge variant="outline" className="font-mono text-xs text-muted-foreground uppercase border-border/50">
                #PV-2026-089
              </Badge>
              <Badge variant="secondary" className="text-xs bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 border-0">
                Editing
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
              <Printer className="mr-2 h-4 w-4" />
              Print
            </Button>
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
          </div>
        </header>

        {/* Primary Details */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
          {/* Account Selector */}
          <div className="space-y-3">
            <Label className="text-sm text-muted-foreground font-medium uppercase tracking-wider">Pay From</Label>
            <Popover open={accountOpen} onOpenChange={setAccountOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={accountOpen}
                  className="w-full justify-between h-12 text-base font-normal bg-transparent border-border/50 hover:bg-muted/30"
                >
                  HBL Main Account
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[400px] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search account..." />
                  <CommandList>
                    <CommandEmpty>No account found.</CommandEmpty>
                    <CommandGroup heading="Banks">
                      <CommandItem className="flex items-center justify-between">
                        <span>HBL Main Account</span>
                        <Check className="h-4 w-4" />
                      </CommandItem>
                      <CommandItem className="flex items-center justify-between">
                        <span>Meezan Bank</span>
                      </CommandItem>
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <div className="flex justify-between text-sm px-1">
              <span className="text-muted-foreground">Current Balance</span>
              <span className="font-mono text-emerald-600">PKR 1,200,000 CR</span>
            </div>
            <div className="flex justify-between text-sm px-1 pt-1 border-t border-border/40">
              <span className="text-muted-foreground">Projected After</span>
              <span className="font-mono text-emerald-600/70">PKR 950,000 CR</span>
            </div>
          </div>

          {/* Date Picker */}
          <div className="space-y-3">
            <Label className="text-sm text-muted-foreground font-medium uppercase tracking-wider">Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal h-12 text-base bg-transparent border-border/50 hover:bg-muted/30",
                    !date && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-3 h-4 w-4 opacity-50" />
                  {date ? format(date, "PPP") : <span>Pick a date</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(d) => d && setDate(d)}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
        </section>

        {/* Entries */}
        <section className="space-y-6 pt-4">
          <div className="flex items-center justify-between">
            <Label className="text-sm text-muted-foreground font-medium uppercase tracking-wider">Entries</Label>
          </div>
          
          <div className="rounded-lg overflow-hidden">
            <Table>
              <TableHeader className="bg-transparent">
                <TableRow className="border-b border-border/40 hover:bg-transparent">
                  <TableHead className="font-medium text-muted-foreground h-10 w-[40%]">Account</TableHead>
                  <TableHead className="font-medium text-muted-foreground h-10">Notes</TableHead>
                  <TableHead className="font-medium text-muted-foreground h-10 text-right w-[25%]">Amount</TableHead>
                  <TableHead className="h-10 w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="border-b border-border/20 hover:bg-muted/20 transition-colors group">
                  <TableCell className="py-4 align-top">
                    <div className="font-medium">Ahmad & Sons</div>
                  </TableCell>
                  <TableCell className="py-4 align-top">
                    <div className="text-muted-foreground">May invoice</div>
                  </TableCell>
                  <TableCell className="py-4 align-top text-right">
                    <div className="font-mono">PKR 150,000</div>
                  </TableCell>
                  <TableCell className="py-4 align-top opacity-0 group-hover:opacity-100 transition-opacity text-right">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
                
                <TableRow className="border-b border-border/20 hover:bg-muted/20 transition-colors group">
                  <TableCell className="py-4 align-top">
                    <div className="font-medium">Freight Charges</div>
                  </TableCell>
                  <TableCell className="py-4 align-top">
                    <div className="text-muted-foreground">Container #C-041</div>
                  </TableCell>
                  <TableCell className="py-4 align-top text-right">
                    <div className="font-mono">PKR 65,000</div>
                  </TableCell>
                  <TableCell className="py-4 align-top opacity-0 group-hover:opacity-100 transition-opacity text-right">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>

                <TableRow className="border-b border-transparent hover:bg-muted/20 transition-colors group">
                  <TableCell className="py-4 align-top">
                    <div className="font-medium">Bank Charges</div>
                  </TableCell>
                  <TableCell className="py-4 align-top">
                    <div className="text-muted-foreground italic opacity-50">Empty</div>
                  </TableCell>
                  <TableCell className="py-4 align-top text-right">
                    <div className="font-mono">PKR 35,000</div>
                  </TableCell>
                  <TableCell className="py-4 align-top opacity-0 group-hover:opacity-100 transition-opacity text-right">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>

            <div className="mt-2">
              <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
                <Plus className="mr-2 h-4 w-4" />
                Add row
              </Button>
            </div>
          </div>

          {/* Summary Strip */}
          <div className="flex items-center justify-between py-6 px-4 bg-muted/30 rounded-lg text-sm">
            <div className="text-muted-foreground tracking-wide uppercase font-medium">Lines: 3</div>
            <div className="flex items-center gap-4">
              <span className="text-muted-foreground uppercase tracking-wider font-medium">Total</span>
              <span className="text-2xl font-light font-mono">PKR 250,000</span>
            </div>
          </div>
        </section>

        {/* Footer Area */}
        <section className="pt-8 border-t border-border/40 grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
          <div className="space-y-6">
            <Collapsible
              open={notesOpen}
              onOpenChange={setNotesOpen}
              className="space-y-4"
            >
              <div className="flex items-center justify-between">
                <Label className="text-sm text-muted-foreground font-medium uppercase tracking-wider">Voucher Notes</Label>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 text-muted-foreground">
                    {notesOpen ? "Hide" : "Show"}
                    {notesOpen ? <ChevronUp className="ml-2 h-4 w-4" /> : <ChevronDown className="ml-2 h-4 w-4" />}
                  </Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                <Textarea 
                  placeholder="Add internal notes or external remarks here..." 
                  className="min-h-[120px] bg-transparent border-border/50 resize-none text-base p-4"
                />
              </CollapsibleContent>
            </Collapsible>

            <div className="flex items-center space-x-3 pt-2">
              <Switch id="optional" />
              <Label htmlFor="optional" className="font-normal text-muted-foreground">Mark as optional / draft</Label>
            </div>
          </div>

          <div className="flex flex-col items-end justify-start h-full pt-6">
            <Button size="lg" className="w-full sm:w-auto h-14 px-8 text-base rounded-full shadow-sm hover:shadow-md transition-all">
              <Save className="mr-3 h-5 w-5" />
              Save Voucher · PKR 250,000
            </Button>
          </div>
        </section>

      </div>
    </div>
  );
}
