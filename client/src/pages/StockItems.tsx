 => {
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    deleteMutation.mutate(selectedIds);
    setDeleteDialogOpen(false);
  };

  const handleStockItemClick = (stockItemId: number, stockItemName: string) => {
    setSelectedStockItemId(stockItemId);
    setSelectedStockItemName(stockItemName);
    setDetailsDialogOpen(true);
  };

  const handleEditClick = (stockItemId: number, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent row click from firing
    setEditStockItemId(stockItemId);
    setEditDialogOpen(true);
  };

  const filteredStockItems = stockItems.filter((item) =>
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (item.barcode && item.barcode.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const getStockGroupName = (stockGroupId: number | null) => {
    if (!stockGroupId) return "Uncategorized";
    const group = stockGroups.find(g => g.id === stockGroupId);
    return group ? `${group.code} - ${group.name}` : "Unknown";
  };

  const allFilteredSelected = filteredStockItems.length > 0 && 
    filteredStockItems.every(item => selectedIds.includes(item.id));

  const exportToExcel = () => {
    const data = stockItems.map(item => ({
      Code: item.code,
      Name: item.name,
      Barcode: item.barcode || "",
      UOM: item.uom,
      "Stock Group": getStockGroupName(item.stockGroupId),
      "Selling Price": item.sellingPrice,
      Active: item.active ? "Yes" : "No",
    }));
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Stock Items");
    XLSX.writeFile(workbook, "stock-items.xlsx");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Stock Items</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage all stock items in your company
          </p>
        </div>
        <div className="flex gap-2">
          {selectedIds.length > 0 && (
            <Button 
              variant="destructive" 
              className="gap-2" 
              onClick={handleDeleteClick}
              data-testid="button-delete-selected"
            >
              <Trash2 className="h-4 w-4" />
              Delete {selectedIds.length} {selectedIds.length === 1 ? 'Item' : 'Items'}
            </Button>
          )}
          <Button
            variant="outline"
            className="gap-2"
            onClick={exportToExcel}
            data-testid="button-export-items"
          >
            <Download className="h-4 w-4" />
            Export
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => setImportDialogOpen(true)}
            data-testid="button-import-data"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Import
          </Button>
          <Button 
            className="gap-2" 
            onClick={() => setCreateDialogOpen(true)}
            data-testid="button-add-item"
          >
            <Plus className="h-4 w-4" />
            Add Item
          </Button>
        </div>
      </div>

      <Card className="p-4">
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            placeholder="Search by name, code, or barcode..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
            data-testid="input-search"
          />
        </div>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (
          <div className="rounded-md border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="h-12">
                  <th className="w-12 px-3">
                    <Checkbox
                      checked={allFilteredSelected}
                      onCheckedChange={handleSelectAll}
                      data-testid="checkbox-select-all"
                    />
                  </th>
                  <th className="text-left px-3 font-medium">Name</th>
                  <th className="text-right px-3 font-medium">Selling Price</th>
                  <th className="text-left px-3 font-medium">Status</th>
                  <th className="text-center px-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredStockItems.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-muted-foreground">
                      {searchTerm ? "No items found matching your search" : "No stock items found"}
                    </td>
                  </tr>
                ) : (
                  filteredStockItems.map((item) => {
                    const sellingPrice = parseFloat(item.sellingPrice || "0");
                    const isSelected = selectedIds.includes(item.id);
                    
                    return (
                      <tr
                        key={item.id}
                        className="border-t hover-elevate h-12"
                        data-testid={`row-stock-item-${item.id}`}
                      >
                        <td className="px-3" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={(checked) => handleSelectItem(item.id, checked as boolean)}
                            data-testid={`checkbox-${item.id}`}
                          />
                        </td>
                        <td 
                          className="px-3 font-medium cursor-pointer" 
                          onClick={() => handleStockItemClick(item.id, item.name)}
                          data-testid={`name-${item.id}`}
                        >
                          <div className="flex items-center gap-2">
                            <Package className="h-4 w-4 text-muted-foreground" />
                            {item.name}
                          </div>
                        </td>
                        <td 
                          className="px-3 text-right font-mono cursor-pointer" 
                          onClick={() => handleStockItemClick(item.id, item.name)}
                          data-testid={`price-${item.id}`}
                        >
                          ${sellingPrice.toFixed(2)}
                        </td>
                        <td 
                          className="px-3 cursor-pointer" 
                          onClick={() => handleStockItemClick(item.id, item.name)}
                          data-testid={`status-${item.id}`}
                        >
                          <Badge variant={item.active ? "default" : "secondary"}>
                            {item.active ? "Active" : "Inactive"}
                          </Badge>
                        </td>
                        <td className="px-3 text-center">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => handleEditClick(item.id, e)}
                            data-testid={`button-edit-${item.id}`}
                            className="gap-2"
                          >
                            <Edit className="h-4 w-4" />
                            Edit
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {!isLoading && filteredStockItems.length > 0 && (
          <div className="mt-4 text-sm text-muted-foreground">
            Showing {filteredStockItems.length} of {stockItems.length} items
          </div>
        )}
      </Card>

      {selectedStockItemId && (
        <StockItemDetailsDialog
          open={detailsDialogOpen}
          onOpenChange={setDetailsDialogOpen}
          stockItemId={selectedStockItemId}
          stockItemName={selectedStockItemName}
        />
      )}

      <StockItemEditDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        stockItemId={editStockItemId}
      />

      <StockItemCreateDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
      />

      <CombinedImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent data-testid="dialog-confirm-delete">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Deletion</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedIds.length} stock {selectedIds.length === 1 ? 'item' : 'items'}? 
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleConfirmDelete}
              className="bg-destructive hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
