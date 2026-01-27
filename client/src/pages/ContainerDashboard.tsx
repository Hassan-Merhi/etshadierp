ta]) => (
                          <div
                            key={location}
                            className="flex items-center justify-between py-1 rounded text-xs"
                            data-testid={`card-location-${location}`}
                          >
                            <span>{location}</span>
                            <Badge variant="secondary" className="text-[10px] py-0 px-1">{locationData.count}</Badge>
                          </div>
                        ))}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="py-2 px-3">
                      <CardTitle className="text-xs font-medium flex items-center gap-1">
                        <Truck className="h-3 w-3" />
                        Summary
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="py-1 px-3">
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Total Containers</span>
                          <span className="font-bold">{filteredData?.totals.count || 0}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Total Value</span>
                          <span className="font-bold">${formatNumber(filteredData?.totals.amount || 0)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Docs Received</span>
                          <span className="font-bold text-green-600">
                            {filteredData?.containers.filter(c => c.docReceived).length || 0}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Pending Docs</span>
                          <span className="font-bold text-yellow-600">
                            {filteredData?.containers.filter(c => !c.docReceived).length || 0}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </ScrollArea>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="statements" className="mt-3">
          <ScrollArea className="h-[calc(100vh-180px)]">
            {renderAgentStatement()}
          </ScrollArea>
        </TabsContent>
      </Tabs>

      <Dialog open={poDialogOpen} onOpenChange={setPoDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Container Details: {poData?.container.containerNumber}
            </DialogTitle>
          </DialogHeader>

          {loadingPO ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : poData ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Status:</span>
                  <Badge variant={poData.container.status === "OFFLOADED" ? "default" : "secondary"} className="ml-2">
                    {poData.container.status}
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Import Date:</span>
                  <span className="ml-2 font-medium">{formatDate(poData.container.importDate)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Supplier:</span>
                  <span className="ml-2 font-medium">{poData.supplier?.legalName || "-"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Total:</span>
                  <span className="ml-2 font-bold">${formatNumber(parseFloat(poData.container.grandTotal || "0"))}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Total Qty:</span>
                  <span className="ml-2 font-bold" data-testid="text-total-qty">
                    {poData.purchaseOrders.reduce((sum, po) => 
                      sum + po.lineItems.reduce((itemSum, item) => 
                        itemSum + parseFloat(item.quantity || "0"), 0), 0).toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Items:</span>
                  <span className="ml-2 font-medium">
                    {poData.purchaseOrders.reduce((sum, po) => sum + po.lineItems.length, 0)} line items
                  </span>
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="text-sm font-semibold mb-3">Purchase Orders ({poData.purchaseOrders.length})</h4>
                {poData.purchaseOrders.map((po) => (
                  <Card key={po.id} className="mb-3">
                    <CardHeader className="py-2 px-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm font-medium">PO #{po.poNumber}</CardTitle>
                        <Badge variant={po.status === "OFFLOADED" ? "default" : "secondary"} className="text-xs">
                          {po.status}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="py-2 px-3">
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-muted/50">
                            <tr>
                              <th className="text-left py-1 px-2">Item</th>
                              <th className="text-right py-1 px-2">Qty</th>
                              <th className="text-right py-1 px-2">Rate</th>
                              <th className="text-right py-1 px-2">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {po.lineItems.map((item, idx) => (
                              <tr key={idx} className="border-t">
                                <td className="py-1 px-2">
                                  <span className="font-mono text-[10px] text-muted-foreground">{item.stockItemCode}</span>
                                  <span className="ml-1">{item.stockItemName}</span>
                                </td>
                                <td className="py-1 px-2 text-right">{formatNumber(parseFloat(item.quantity || "0"))}</td>
                                <td className="py-1 px-2 text-right">{formatNumber(parseFloat(item.rate || "0"))}</td>
                                <td className="py-1 px-2 text-right font-medium">${formatNumber(parseFloat(item.lineTotal || "0"))}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot className="bg-muted/30">
                            <tr className="border-t font-medium">
                              <td colSpan={3} className="py-1 px-2 text-right">Items Total:</td>
                              <td className="py-1 px-2 text-right">${formatNumber(parseFloat(po.itemsTotal || "0"))}</td>
                            </tr>
                            {parseFloat(po.freight || "0") > 0 && (
                              <tr>
                                <td colSpan={3} className="py-0.5 px-2 text-right text-muted-foreground">Freight:</td>
                                <td className="py-0.5 px-2 text-right">${formatNumber(parseFloat(po.freight || "0"))}</td>
                              </tr>
                            )}
                            {parseFloat(po.surcharge || "0") > 0 && (
                              <tr>
                                <td colSpan={3} className="py-0.5 px-2 text-right text-muted-foreground">Surcharge:</td>
                                <td className="py-0.5 px-2 text-right">${formatNumber(parseFloat(po.surcharge || "0"))}</td>
                              </tr>
                            )}
                            {parseFloat(po.otherCharges || "0") > 0 && (
                              <tr>
                                <td colSpan={3} className="py-0.5 px-2 text-right text-muted-foreground">Other Charges:</td>
                                <td className="py-0.5 px-2 text-right">${formatNumber(parseFloat(po.otherCharges || "0"))}</td>
                              </tr>
                            )}
                            {parseFloat(po.discount || "0") > 0 && (
                              <tr>
                                <td colSpan={3} className="py-0.5 px-2 text-right text-muted-foreground">Discount:</td>
                                <td className="py-0.5 px-2 text-right">-${formatNumber(parseFloat(po.discount || "0"))}</td>
                              </tr>
                            )}
                          </tfoot>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground py-4">No data available</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

