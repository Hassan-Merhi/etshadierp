import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Search, Package, Tag, Clock, User, Scale, Hash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import type { BaleProduct, BaleLabelPrint } from "@shared/schema";

type LookupTab = "article" | "reference";

export default function BarcodeLookup() {
  const [activeTab, setActiveTab] = useState<LookupTab>("article");
  const [searchValue, setSearchValue] = useState("");
  const { toast } = useToast();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);

  const [articleResult, setArticleResult] = useState<{
    product: BaleProduct | null;
    labelPrints: BaleLabelPrint[];
  } | null>(null);

  const [referenceResult, setReferenceResult] = useState<{
    labelPrint: BaleLabelPrint | null;
    product: BaleProduct | null;
  } | null>(null);

  const articleLookup = useMutation({
    mutationFn: async (code: string) => {
      const response = await modeApiRequest("GET", `/api/lookup/article/${encodeURIComponent(code)}`);
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Lookup failed");
      }
      return response.json();
    },
    onSuccess: (data) => {
      setArticleResult(data);
      setReferenceResult(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Not Found",
        description: error.message,
        variant: "destructive",
      });
      setArticleResult(null);
    },
  });

  const referenceLookup = useMutation({
    mutationFn: async (refNum: string) => {
      const response = await modeApiRequest("GET", `/api/lookup/reference/${encodeURIComponent(refNum)}`);
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Lookup failed");
      }
      return response.json();
    },
    onSuccess: (data) => {
      setReferenceResult(data);
      setArticleResult(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Not Found",
        description: error.message,
        variant: "destructive",
      });
      setReferenceResult(null);
    },
  });

  const markScanned = useMutation({
    mutationFn: async (refNum: string) => {
      const response = await modeApiRequest("POST", `/api/lookup/reference/${encodeURIComponent(refNum)}/scan`, {});
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to mark as scanned");
      }
      return response.json();
    },
    onSuccess: (data) => {
      setReferenceResult((prev) =>
        prev ? { ...prev, labelPrint: { ...prev.labelPrint!, scannedAt: data.scannedAt, scannedByUserId: data.scannedByUserId, scannedByName: data.scannedByName } } : prev
      );
      toast({ title: "Scanned", description: "Label marked as scanned" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleSearch = () => {
    if (!searchValue.trim()) return;
    if (activeTab === "article") {
      articleLookup.mutate(searchValue.trim());
    } else {
      referenceLookup.mutate(searchValue.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  const handleTabChange = (tab: LookupTab) => {
    setActiveTab(tab);
    setSearchValue("");
    setArticleResult(null);
    setReferenceResult(null);
  };

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return "N/A";
    return new Date(dateStr).toLocaleString();
  };

  const isLoading = articleLookup.isPending || referenceLookup.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 border-b pb-3">
        <Button
          variant={activeTab === "article" ? "default" : "ghost"}
          onClick={() => handleTabChange("article")}
          data-testid="tab-lookup-article"
        >
          <Tag className="h-4 w-4 mr-2" />
          Search by ARTICLE
        </Button>
        <Button
          variant={activeTab === "reference" ? "default" : "ghost"}
          onClick={() => handleTabChange("reference")}
          data-testid="tab-lookup-reference"
        >
          <Hash className="h-4 w-4 mr-2" />
          Search by REFERENCE
        </Button>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder={activeTab === "article" ? "Enter article code (e.g. HMD01000)" : "Enter reference number (e.g. REF0000001)"}
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          onKeyDown={handleKeyDown}
          data-testid="input-lookup-search"
        />
        <Button
          onClick={handleSearch}
          disabled={isLoading || !searchValue.trim()}
          data-testid="button-lookup-search"
        >
          <Search className="h-4 w-4 mr-2" />
          {isLoading ? "Searching..." : "Search"}
        </Button>
      </div>

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}

      {activeTab === "article" && articleResult && (
        <div className="space-y-4">
          {articleResult.product ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 flex-wrap">
                  <Package className="h-5 w-5" />
                  Product Details
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Article Code</p>
                    <p className="font-medium" data-testid="text-article-code">{articleResult.product.articleCode || articleResult.product.code}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Product Name</p>
                    <p className="font-medium" data-testid="text-product-name">{articleResult.product.name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Status</p>
                    <Badge variant={articleResult.product.active ? "default" : "secondary"} data-testid="badge-product-status">
                      {articleResult.product.active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  {articleResult.product.description && (
                    <div className="col-span-2">
                      <p className="text-sm text-muted-foreground">Description</p>
                      <p className="font-medium">{articleResult.product.description}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-6">
                <p className="text-center text-muted-foreground">No product found for article code "{searchValue}"</p>
              </CardContent>
            </Card>
          )}

          {articleResult.labelPrints.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 flex-wrap">
                  <Clock className="h-5 w-5" />
                  Label Print History ({articleResult.labelPrints.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead>
                      <TableHead>Pieces</TableHead>
                      <TableHead>Weight (kg)</TableHead>
                      <TableHead>Printed At</TableHead>
                      <TableHead>Scanned At</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {articleResult.labelPrints.map((lp) => (
                      <TableRow key={lp.id} data-testid={`row-label-print-${lp.id}`}>
                        <TableCell className="font-mono font-medium">{lp.referenceNumber}</TableCell>
                        <TableCell>{lp.pieces}</TableCell>
                        <TableCell>{lp.approxWeightKg}</TableCell>
                        <TableCell>{formatDate(lp.printedAt as any)}</TableCell>
                        <TableCell>{lp.scannedAt ? formatDate(lp.scannedAt as any) : <Badge variant="outline">Not scanned</Badge>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : articleResult.product ? (
            <Card>
              <CardContent className="py-6">
                <p className="text-center text-muted-foreground">No labels printed yet for this article code</p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}

      {activeTab === "reference" && referenceResult && (
        <div className="space-y-4">
          {referenceResult.labelPrint ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 flex-wrap">
                  <Hash className="h-5 w-5" />
                  Label Print Record
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Reference Number</p>
                    <p className="font-mono font-medium text-lg" data-testid="text-reference-number">{referenceResult.labelPrint.referenceNumber}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Article Code</p>
                    <p className="font-medium" data-testid="text-ref-article-code">{referenceResult.labelPrint.articleCode}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Pieces</p>
                    <p className="font-medium" data-testid="text-ref-pieces">{referenceResult.labelPrint.pieces}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Approx Weight</p>
                    <p className="font-medium" data-testid="text-ref-weight">{referenceResult.labelPrint.approxWeightKg} KGS</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Printed At</p>
                    <p className="font-medium" data-testid="text-ref-printed-at">{formatDate(referenceResult.labelPrint.printedAt as any)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground flex items-center gap-1 flex-wrap"><User className="h-3 w-3" /> Printed By</p>
                    <p className="font-medium" data-testid="text-ref-printed-by">{referenceResult.labelPrint.printedByName || referenceResult.labelPrint.printedByUserId || "Unknown"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Scanned At</p>
                    <p className="font-medium" data-testid="text-ref-scanned-at">
                      {referenceResult.labelPrint.scannedAt
                        ? formatDate(referenceResult.labelPrint.scannedAt as any)
                        : <Badge variant="outline">Not scanned yet</Badge>
                      }
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground flex items-center gap-1 flex-wrap"><User className="h-3 w-3" /> Scanned By</p>
                    <p className="font-medium" data-testid="text-ref-scanned-by">{referenceResult.labelPrint.scannedByName || referenceResult.labelPrint.scannedByUserId || "N/A"}</p>
                    {!referenceResult.labelPrint.scannedAt && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        disabled={markScanned.isPending}
                        onClick={() => markScanned.mutate(referenceResult.labelPrint!.referenceNumber)}
                        data-testid="button-mark-scanned"
                      >
                        {markScanned.isPending ? "Scanning..." : "Mark as Scanned"}
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-6">
                <p className="text-center text-muted-foreground">No record found for reference "{searchValue}"</p>
              </CardContent>
            </Card>
          )}

          {referenceResult.product && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 flex-wrap">
                  <Package className="h-5 w-5" />
                  Linked Product
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Article Code</p>
                    <p className="font-medium">{referenceResult.product.articleCode || referenceResult.product.code}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Product Name</p>
                    <p className="font-medium">{referenceResult.product.name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Status</p>
                    <Badge variant={referenceResult.product.active ? "default" : "secondary"}>
                      {referenceResult.product.active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
