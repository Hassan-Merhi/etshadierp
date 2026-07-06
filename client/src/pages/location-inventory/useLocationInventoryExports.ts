interface Location {
  id: number;
  name: string;
  [key: string]: any;
}

export function useLocationInventoryExports(
  selectedLocationLocal: Location | null,
  toast: (opts: any) => void,
) {
  const handlePrintWithOption = async (withCost: boolean) => {
    if (!selectedLocationLocal) return;
    try {
      const includeCost = withCost ? "1" : "0";
      const response = await fetch(
        `/api/locations/${selectedLocationLocal.id}/inventory/pdf?includeCost=${includeCost}`,
        { credentials: "include" }
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: "PDF generation failed" }));
        toast({ title: "Export Failed", description: err.message, variant: "destructive" });
        return;
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName = selectedLocationLocal.name.replace(/\s+/g, "_");
      const date = new Date().toLocaleDateString("en-CA");
      a.download = `${safeName}_Godown_${date}${withCost ? "_with_cost" : "_no_cost"}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast({ title: "PDF Downloaded" });
    } catch (error: any) {
      toast({ title: "Export Failed", description: error.message, variant: "destructive" });
    }
  };

  const handleExportInventory = async () => {
    if (!selectedLocationLocal) return;
    try {
      const response = await fetch(`/api/locations/${selectedLocationLocal.id}/inventory/export`, {
        credentials: "include",
      });
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selectedLocationLocal.name}_inventory_${new Date().toLocaleDateString("en-CA")}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      toast({ title: "Export Successful" });
    } catch (error: any) {
      toast({ title: "Export Failed", description: error.message, variant: "destructive" });
    }
  };

  return { handlePrintWithOption, handleExportInventory };
}
