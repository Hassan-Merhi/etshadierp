import { TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function OtwContainerTableHeader() {
  return (
    <TableHeader className="sticky top-0 z-30 bg-background">
      <TableRow>
        <TableHead className="whitespace-nowrap">Container #</TableHead>
        <TableHead className="whitespace-nowrap">Supplier</TableHead>
        <TableHead className="whitespace-nowrap">Amount</TableHead>
        <TableHead className="whitespace-nowrap min-w-[100px]">Shop</TableHead>
        <TableHead className="whitespace-nowrap min-w-[130px]">ETA</TableHead>
        <TableHead className="whitespace-nowrap min-w-[120px]">Transporter</TableHead>
        <TableHead className="whitespace-nowrap min-w-[80px]">Fee</TableHead>
        <TableHead className="whitespace-nowrap min-w-[100px]">Plate</TableHead>
        <TableHead className="whitespace-nowrap min-w-[120px]">Location</TableHead>
        <TableHead className="whitespace-nowrap min-w-[130px]">Border</TableHead>
        <TableHead className="whitespace-nowrap min-w-[130px]">Offload</TableHead>
        <TableHead className="whitespace-nowrap min-w-[80px]">Agent</TableHead>
        <TableHead className="whitespace-nowrap min-w-[80px]">Duty</TableHead>
        <TableHead className="whitespace-nowrap">Doc</TableHead>
        <TableHead className="whitespace-nowrap">Freight</TableHead>
        <TableHead className="whitespace-nowrap min-w-[150px]">Description</TableHead>
        <TableHead className="whitespace-nowrap min-w-[130px]">Docs Sent</TableHead>
        <TableHead className="whitespace-nowrap min-w-[110px]">Freight (GIT)</TableHead>
        <TableHead className="whitespace-nowrap min-w-[160px]">Link</TableHead>
        <TableHead></TableHead>
      </TableRow>
    </TableHeader>
  );
}
