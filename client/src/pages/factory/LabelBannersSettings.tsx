import { useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { Loader2, Upload, RotateCcw, ImageIcon, CheckCircle } from "lucide-react";
import { A4_DESIGN_OPTIONS, A4DesignColor } from "@/lib/labelHtml";

interface SlotInfo {
  slot: string;
  hasCustom: boolean;
  lastModified: number | null;
}

export default function LabelBannersSettings() {
  const { toast } = useToast();
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [uploadingSlot, setUploadingSlot] = useState<string | null>(null);
  const [revertingSlot, setRevertingSlot] = useState<string | null>(null);

  const { data: slots = [], isLoading } = useQuery<SlotInfo[]>({
    queryKey: ["/api/factory/label-banners"],
    queryFn: () => fetch("/api/factory/label-banners", { credentials: "include" }).then(r => r.json()),
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ slot, file }: { slot: string; file: File }) => {
      setUploadingSlot(slot);
      const form = new FormData();
      form.append("image", file);
      const res = await fetch(`/api/factory/label-banners/${slot}`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!res.ok) throw new Error((await res.json()).message ?? "Upload failed");
      return res.json() as Promise<SlotInfo>;
    },
    onSuccess: () => {
      toast({ title: "Banner image updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/label-banners"] });
    },
    onError: (e: Error) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
    onSettled: () => setUploadingSlot(null),
  });

  const revertMutation = useMutation({
    mutationFn: async (slot: string) => {
      setRevertingSlot(slot);
      const res = await fetch(`/api/factory/label-banners/${slot}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).message ?? "Revert failed");
      return res.json() as Promise<SlotInfo>;
    },
    onSuccess: () => {
      toast({ title: "Banner reverted to default" });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/label-banners"] });
    },
    onError: (e: Error) => toast({ title: "Revert failed", description: e.message, variant: "destructive" }),
    onSettled: () => setRevertingSlot(null),
  });

  const handleFileChange = (slot: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadMutation.mutate({ slot, file });
    e.target.value = "";
  };

  const slotMap = new Map(slots.map(s => [s.slot, s]));

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
      <PageHeader
        title="Label Banner Images"
        description="Replace the colored header banners printed on A4 bale labels. Each slot maps to one of the 5 design colors. Uploading a new image takes effect immediately — no restart needed."
        backHref="/factory/settings"
      />

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      )}

      {!isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {A4_DESIGN_OPTIONS.map((opt) => {
            const info = slotMap.get(opt.value);
            const hasCustom = info?.hasCustom ?? false;
            const ts = info?.lastModified ?? 0;
            const isUploading = uploadingSlot === opt.value;
            const isReverting = revertingSlot === opt.value;
            const isBusy = isUploading || isReverting;
            // Cache-bust: append timestamp so browser reloads after upload
            const previewUrl = `/labels/hmd-${opt.value}.jpg?t=${ts}`;

            return (
              <Card key={opt.value} data-testid={`card-banner-${opt.value}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2 flex-wrap justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <span
                        className="inline-block h-3 w-3 rounded-full flex-shrink-0"
                        style={{ background: opt.color }}
                      />
                      {opt.label}
                    </CardTitle>
                    {hasCustom && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 font-medium flex items-center gap-1">
                        <CheckCircle className="h-3 w-3" />
                        Custom
                      </span>
                    )}
                  </div>
                  <CardDescription className="text-xs">
                    {hasCustom ? "Using your uploaded image" : "Using default HMD image"}
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-3">
                  {/* Preview */}
                  <div className="relative rounded-md overflow-hidden border bg-muted h-24 flex items-center justify-center">
                    <img
                      key={ts}
                      src={previewUrl}
                      alt={`${opt.label} banner`}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                      data-testid={`img-banner-preview-${opt.value}`}
                    />
                    {isBusy && (
                      <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 flex-wrap">
                    <input
                      ref={el => { fileInputRefs.current[opt.value] = el; }}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      onChange={(e) => handleFileChange(opt.value, e)}
                      data-testid={`input-banner-file-${opt.value}`}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isBusy}
                      onClick={() => fileInputRefs.current[opt.value]?.click()}
                      data-testid={`button-upload-banner-${opt.value}`}
                    >
                      {isUploading
                        ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        : <Upload className="h-3.5 w-3.5 mr-1.5" />}
                      {isUploading ? "Uploading…" : "Upload"}
                    </Button>

                    {hasCustom && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isBusy}
                        onClick={() => revertMutation.mutate(opt.value)}
                        data-testid={`button-revert-banner-${opt.value}`}
                      >
                        {isReverting
                          ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                          : <RotateCcw className="h-3.5 w-3.5 mr-1.5" />}
                        Revert to Default
                      </Button>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground">
                    JPG, PNG or WEBP · max 5 MB
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ImageIcon className="h-4 w-4 text-muted-foreground" />
            How this works
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Each color slot corresponds to one of the 5 design colors you can assign to a bale product.
            The banner image fills the top section of the A4 printed label.
          </p>
          <p>
            Uploaded images are stored persistently and served immediately — even existing prints in open
            browser tabs will pick up the new image on the next print. The default HMD images are kept
            as fallback in case you revert.
          </p>
          <p>
            Recommended size: <strong>1240 × 350 px</strong> or similar wide banner proportions (JPG works best for photos).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
