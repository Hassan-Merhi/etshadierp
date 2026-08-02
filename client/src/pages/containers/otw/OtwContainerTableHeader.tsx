import { TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useErpText } from "@/i18n/modules/erp";

export function OtwContainerTableHeader() {
  const tUi = useErpText();
  return (
    <TableHeader className="sticky top-0 z-30 bg-background">
      <TableRow>
        <TableHead className="whitespace-nowrap">{tUi("container.2")}</TableHead>
        <TableHead className="whitespace-nowrap">{tUi("supplier")}</TableHead>
        <TableHead className="whitespace-nowrap">{tUi("amount")}</TableHead>
        <TableHead className="whitespace-nowrap min-w-[100px]">{tUi("shop")}</TableHead>
        <TableHead className="whitespace-nowrap min-w-[130px]">ETA</TableHead>
        <TableHead className="whitespace-nowrap min-w-[120px]">{tUi("transporter")}</TableHead>
        <TableHead className="whitespace-nowrap min-w-[80px]">Fee</TableHead>
        <TableHead className="whitespace-nowrap min-w-[100px]">{tUi("plate")}</TableHead>
        <TableHead className="whitespace-nowrap min-w-[120px]">{tUi("location")}</TableHead>
        <TableHead className="whitespace-nowrap min-w-[130px]">{tUi("border")}</TableHead>
        <TableHead className="whitespace-nowrap min-w-[130px]">{tUi("offload")}</TableHead>
        <TableHead className="whitespace-nowrap min-w-[80px]">{tUi("agent")}</TableHead>
        <TableHead className="whitespace-nowrap min-w-[80px]">{tUi("duty")}</TableHead>
        <TableHead className="whitespace-nowrap">Doc</TableHead>
        <TableHead className="whitespace-nowrap">{tUi("freight")}</TableHead>
        <TableHead className="whitespace-nowrap min-w-[150px]">{tUi("description")}</TableHead>
        <TableHead className="whitespace-nowrap min-w-[130px]">{tUi("docs.sent")}</TableHead>
        <TableHead className="whitespace-nowrap min-w-[110px]">{tUi("freight.git")}</TableHead>
        <TableHead className="whitespace-nowrap min-w-[160px]">{tUi("link")}</TableHead>
        <TableHead></TableHead>
      </TableRow>
    </TableHeader>
  );
}
