const fs = require("fs");

function replaceExact(path, before, after) {
  const source = fs.readFileSync(path, "utf8");
  if (!source.includes(before)) {
    throw new Error(`Expected block not found in ${path}`);
  }
  fs.writeFileSync(path, source.replace(before, after));
}

replaceExact(
  "server/routes/vouchers/immutableStockTransferRevisionRoutes.ts",
  `const revisionSchema = z.object({\n  note: z.string().optional().nullable(),\n  optional: z.boolean().optional().default(false),`,
  `const revisionSchema = z.object({\n  note: z.string().optional().nullable(),\n  optional: z.boolean().optional().default(false),\n  baseline: z.enum(["before", "after"]).optional().default("before"),`
);

replaceExact(
  "server/routes/vouchers/immutableStockTransferRevisionRoutes.ts",
  `        pending: parsed.optional,\n        sourceLocationIdLimit: assignedLocationId,`,
  `        pending: parsed.optional,\n        baseline: parsed.baseline,\n        sourceLocationIdLimit: assignedLocationId,`
);

replaceExact(
  "server/services/immutableStockTransferRevisionLifecycle.ts",
  `  pending: boolean;\n  sourceLocationIdLimit?: number | null;`,
  `  pending: boolean;\n  baseline?: "before" | "after";\n  sourceLocationIdLimit?: number | null;`
);

replaceExact(
  "server/services/immutableStockTransferRevisionLifecycle.ts",
  `async function assertSubmittedBaseline(tx: any, transferId: number, items: NormalizedImmutableRevisionItem[]) {\n  const current = await tx.select().from(stockTransferItems).where(eq(stockTransferItems.transferId, transferId));\n  for (const item of items) {\n    const row = current.find(\n      (candidate: typeof stockTransferItems.$inferSelect) =>\n        candidate.stockItemId === item.stockItemId && candidate.sourceLocationId === item.sourceLocationId\n    );\n    const currentQuantity = Number(row?.quantity ?? 0);\n    if (Math.abs(currentQuantity - item.originalQuantity) > 0.001) {\n      const error: any = lifecycleError(\n        \`Revision is stale for item \${item.stockItemId} at source \${item.sourceLocationId}. Expected \${item.originalQuantity}, current transfer quantity is \${currentQuantity}.\`,\n        "STOCK_TRANSFER_REVISION_STALE"\n      );\n      error.stockItemId = item.stockItemId;\n      error.sourceLocationId = item.sourceLocationId;\n      throw error;\n    }\n  }\n}`,
  `async function assertSubmittedBaseline(\n  tx: any,\n  transferId: number,\n  items: NormalizedImmutableRevisionItem[],\n  baseline: "before" | "after" = "before"\n) {\n  const current = await tx.select().from(stockTransferItems).where(eq(stockTransferItems.transferId, transferId));\n  for (const item of items) {\n    const row = current.find(\n      (candidate: typeof stockTransferItems.$inferSelect) =>\n        candidate.stockItemId === item.stockItemId && candidate.sourceLocationId === item.sourceLocationId\n    );\n    const currentQuantity = Number(row?.quantity ?? 0);\n    const expectedQuantity = baseline === "after" ? item.newQuantity : item.originalQuantity;\n    if (Math.abs(currentQuantity - expectedQuantity) > 0.001) {\n      const error: any = lifecycleError(\n        \`Revision is stale for item \${item.stockItemId} at source \${item.sourceLocationId}. Expected \${expectedQuantity}, current transfer quantity is \${currentQuantity}.\`,\n        "STOCK_TRANSFER_REVISION_STALE"\n      );\n      error.stockItemId = item.stockItemId;\n      error.sourceLocationId = item.sourceLocationId;\n      throw error;\n    }\n  }\n}`
);

replaceExact(
  "server/services/immutableStockTransferRevisionLifecycle.ts",
  `    await assertCompanyScope(tx, companyId, destinationLocationId, normalized);\n    await assertSubmittedBaseline(tx, transferId, normalized);`,
  `    await assertCompanyScope(tx, companyId, destinationLocationId, normalized);\n    await assertSubmittedBaseline(tx, transferId, normalized, input.baseline);`
);

replaceExact(
  "client/src/pages/vouchers/StockTransferForm.tsx",
  `    setIsTransferSavingRevision(true);\n    savingTransferRevisionRef.current = true;\n    try {\n      await stockTransferForm.handleSubmit(async (data) => {\n        await onStockTransferSubmit(data);\n      })();\n      await modeApiRequest("POST", \`/api/stock-transfers/\${stockTransferToEdit!.id}/revisions\`, {\n        note: transferRevisionNote.trim() || null,\n        items: revisionItems,\n      });\n      queryClient.invalidateQueries({\n        queryKey: ["/api/stock-transfers", lastKnownTransferIdRef.current, "revisions"],\n      });\n      setTransferRevisionNote("");\n      setTransferRevisionDialogOpen(false);\n      setTransferRevisionsExpanded(true);\n      const nextRevNum = transferRevisions.length + 1;\n      toast({ title: "Revision Saved", description: \`Rev \${nextRevNum} recorded and transfer updated\` });\n    } catch (error: any) {\n      toast({ title: "Error", description: error.message || "Failed to save revision", variant: "destructive" });\n    } finally {`,
  `    const transferId = stableTransferId;\n    if (!transferId || !voucherIdToEdit) {\n      toast({ title: "Error", description: "Stock transfer is not ready yet. Please reopen it and try again.", variant: "destructive" });\n      return;\n    }\n    setIsTransferSavingRevision(true);\n    savingTransferRevisionRef.current = true;\n    let transferUpdated = false;\n    try {\n      const isValid = await stockTransferForm.trigger();\n      if (!isValid) return;\n      await onStockTransferSubmit(stockTransferForm.getValues());\n      transferUpdated = true;\n      const revisionResponse = await modeApiRequest("POST", \`/api/stock-transfers/\${transferId}/revisions\`, {\n        note: transferRevisionNote.trim() || null,\n        baseline: "after",\n        items: revisionItems,\n      });\n      const savedRevision = await revisionResponse.json();\n      await Promise.all([\n        queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers", transferId, "revisions"] }),\n        queryClient.invalidateQueries({\n          queryKey: [\`/api/stock-transfers/by-voucher/\${voucherIdToEdit}/revisions\`],\n        }),\n        queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers", voucherIdToEdit] }),\n      ]);\n      setTransferRevisionNote("");\n      setTransferRevisionDialogOpen(false);\n      setTransferRevisionsExpanded(true);\n      toast({\n        title: "Revision Saved",\n        description: \`Rev \${savedRevision.revisionNumber ?? transferRevisions.length + 1} recorded and transfer updated\`,\n      });\n    } catch (error: any) {\n      toast({\n        title: transferUpdated ? "Revision history was not saved" : "Transfer was not updated",\n        description: transferUpdated\n          ? \`The transfer update succeeded, but the revision record failed: \${error.message || "Unknown error"}. Keep this dialog open and try Save as Revision again.\`\n          : error.message || "Failed to save revision",\n        variant: "destructive",\n      });\n    } finally {`
);

replaceExact(
  "client/src/pages/vouchers/StockTransferForm.tsx",
  `      toast({ title: "Success", description: \`Stock transfer \${isEditMode ? "updated" : "created"} successfully\` });`,
  `      if (!savingTransferRevisionRef.current) {\n        toast({ title: "Success", description: \`Stock transfer \${isEditMode ? "updated" : "created"} successfully\` });\n      }`
);

console.log("Applied stock transfer revision save fix");
