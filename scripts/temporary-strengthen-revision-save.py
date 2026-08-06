from pathlib import Path

path = Path("client/src/pages/vouchers/StockTransferForm.tsx")
text = path.read_text()

old_success = '''    onSuccess: () => {
      const isEditMode = !!voucherIdToEdit;
      toast({ title: "Success", description: `Stock transfer ${isEditMode ? "updated" : "created"} successfully` });'''
new_success = '''    onSuccess: () => {
      const isEditMode = !!voucherIdToEdit;
      if (!savingTransferRevisionRef.current) {
        toast({ title: "Success", description: `Stock transfer ${isEditMode ? "updated" : "created"} successfully` });
      }'''
if old_success not in text:
    raise SystemExit("Stock-transfer success block was not found")
text = text.replace(old_success, new_success, 1)

start = text.index("  const confirmTransferSaveAsRevision = async () => {")
end = text.index("\n  const onStockTransferSubmit = async", start)
replacement = '''  const confirmTransferSaveAsRevision = async () => {
    const transferId = stockTransferToEdit?.id ?? lastKnownTransferIdRef.current;
    if (!voucherIdToEdit || !transferId) {
      toast({
        title: "Revision Not Saved",
        description: "The saved stock transfer could not be identified. Reload the transfer and try again.",
        variant: "destructive",
      });
      return;
    }

    const revisionItems = computeTransferRevisionItems();
    if (revisionItems.length === 0) {
      toast({
        title: "No Changes",
        description: "No differences found compared to the saved order",
        variant: "destructive",
      });
      setTransferRevisionDialogOpen(false);
      return;
    }

    setIsTransferSavingRevision(true);
    savingTransferRevisionRef.current = true;
    try {
      let submitted = false;
      await stockTransferForm.handleSubmit(async (data) => {
        submitted = true;
        await onStockTransferSubmit(data);
      })();
      if (!submitted) return;

      const revisionResponse = await modeApiRequest("POST", `/api/stock-transfers/${transferId}/revisions`, {
        note: transferRevisionNote.trim() || null,
        items: revisionItems,
      });
      if (!revisionResponse.ok) {
        let message = "The transfer was updated, but its revision record could not be saved.";
        try {
          const body = await revisionResponse.json();
          message = body?.message || body?.error || message;
        } catch {}
        throw new Error(message);
      }

      const transferRevisionPath = `/api/stock-transfers/${transferId}/revisions`;
      const voucherRevisionPath = `/api/stock-transfers/by-voucher/${voucherIdToEdit}/revisions`;
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["/api/stock-transfers", transferId, "revisions"] }),
        queryClient.refetchQueries({ queryKey: [transferRevisionPath] }),
        queryClient.refetchQueries({ queryKey: [voucherRevisionPath] }),
      ]);

      setTransferRevisionNote("");
      setTransferRevisionDialogOpen(false);
      setTransferRevisionsExpanded(true);
      const refreshedRevisions = queryClient.getQueryData<any[]>([
        "/api/stock-transfers",
        transferId,
        "revisions",
      ]);
      const nextRevNum = refreshedRevisions?.length ?? transferRevisions.length + 1;
      toast({ title: "Revision Saved", description: `Rev ${nextRevNum} recorded and transfer updated` });
    } catch (error: any) {
      toast({
        title: "Revision Not Saved",
        description: error.message || "The transfer was updated, but the revision record failed to save. Please try again.",
        variant: "destructive",
      });
    } finally {
      savingTransferRevisionRef.current = false;
      setIsTransferSavingRevision(false);
    }
  };
'''
text = text[:start] + replacement + text[end:]
path.write_text(text)
