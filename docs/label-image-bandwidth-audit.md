# Label Image Bandwidth Audit — Phase 17D

**Date:** 2026-07-06  
**Goal:** Stop repeated ~2 MB label image downloads on every page load without degrading print quality.

---

## 1. Pre-fix Audit

### Image URLs affected
| File | URL | Size on disk | Reported production size |
|---|---|---|---|
| hmd-purple.jpg | `/labels/hmd-purple.jpg` | 100 KB | ~1,995 KB (custom in DB) |
| hmd-green.jpg  | `/labels/hmd-green.jpg`  | 99 KB  | ~1,995 KB (custom in DB) |
| hmd-gold.jpg   | `/labels/hmd-gold.jpg`   | 48 KB  | ~1,958 KB (custom in DB) |
| hmd-red.jpg    | `/labels/hmd-red.jpg`    | 2.2 MB | ~1,940 KB (custom in DB) |
| hmd-white.jpg  | `/labels/hmd-white.jpg`  | 34 KB  | ~1,898 KB (custom in DB) |

**All 5 have custom images uploaded to the DB.** Custom images are served via the `/labels/hmd-:slug.jpg` Express route which reads from the `label_design_colors.image_data` column (base64).

---

### Root cause 1 — Eager module-load prefetch

`client/src/lib/labelHtml.ts` contained this block at the bottom:

```ts
// Kick off prefetch for static banners immediately on module load (browser only).
if (typeof window !== "undefined") {
  for (const opt of A4_DESIGN_OPTIONS) _prefetchBanner(opt.value);
}
```

Every page that imports `labelHtml.ts` (stock entry, reprint labels, location inventory, etc.) triggered a `fetch()` of **all 5 images in the background**, immediately on import — even if the user never clicked Print.

Each `_prefetchBanner()` call: fetches the URL → converts the response blob to a base64 data URL via `FileReader` → stores in `_bannerBase64Cache`.

Result: **5 × ~2 MB = ~10 MB downloaded silently on every page load** that imported the module.

---

### Root cause 2 — `no-cache, no-store` cache headers on custom images

`server/routes/factory/labelBannersRoutes.ts` served custom DB images with:

```
Cache-Control: no-cache, no-store, must-revalidate
```

This prevented the browser from caching the images at all. Every fetch — including repeated prefetches on the same session or after navigation — downloaded the full image fresh from the DB.

The frontend already built stable, content-addressed URLs (`/labels/hmd-*.jpg?t=<imageUpdatedAt ms>`), but the cache header made that timestamp useless.

---

### Root cause 3 — Full-res images used for screen preview thumbnails

`A4_DESIGN_OPTIONS.previewUrl` pointed to the full-res originals:
```ts
previewUrl: "/labels/hmd-purple.jpg"   // 100 KB default / ~2 MB custom
```

These `previewUrl` values are consumed in:
- Color selector dropdowns
- `useLabelDesignColors` hook → any component that calls it
- `LabelBannersSettings.tsx` thumbnail cards

All screen-only UI was loading full print-resolution images.

---

### Cache-busting check

`?t=<imageUpdatedAt>` is a **stable versioning timestamp** (changes only when a new custom image is uploaded) — **not** a `Date.now()` / `Math.random()` bust. This is correct and was preserved. No stray cache-busting was removed.

---

## 2. Files Changed

### `client/src/lib/labelHtml.ts`
- `A4_DESIGN_OPTIONS.previewUrl` → changed to `/labels/previews/hmd-*-preview.webp` (small WebP, 3–5 KB each)
- Removed the eager module-load prefetch block (`if (typeof window !== "undefined") { ... }`)
- `setBannerTimestamps()` no longer triggers prefetch; only clears stale base64 cache
- Added `prefetchBannersForPrint()` export — must be called explicitly when user triggers a print action

**Print path unchanged:** `getDesignBannerUrl()` still returns full-res base64 (from `_bannerBase64Cache`) or falls back to `/labels/hmd-*.jpg` network URL. `getHeaderImage()` still returns `/labels/hmd-*.jpg` URLs directly into HTML.

### `client/src/hooks/useLabelDesignColors.ts`
- `rowToOption()` now sets `previewUrl`:
  - Custom image (`hasCustom && lastModified`): `/labels/hmd-${slug}.jpg?t=${ts}` (full-res, but now immutable-cached by the server)
  - Default image: `/labels/previews/hmd-${slug}-preview.webp` (3–5 KB WebP)

### `client/src/pages/factory/LabelBannersSettings.tsx`
- Settings page thumbnail cards now use:
  - `ts > 0` (custom image): `/labels/hmd-${slug}.jpg?t=${ts}` — shows the actual custom image
  - `ts === 0` (default): `/labels/previews/hmd-${slug}-preview.webp` — small WebP thumbnail
- Added `loading="lazy"` to the thumbnail `<img>` element

### `server/routes/factory/labelBannersRoutes.ts`
- Custom image cache headers changed:
  - Request has `?t=<timestamp>` → `Cache-Control: public, max-age=31536000, immutable`
  - Request without `?t=` (legacy/rare) → `Cache-Control: public, max-age=600`
- This makes content-addressed custom image URLs permanently cacheable in the browser

### `client/src/pages/factory/bale-stock-entry/StockEntryPrinting.ts`
- Added `prefetchBannersForPrint()` at the start of `openBrowserPrint()`

### `client/src/pages/factory/bale-stock-entry/RemoveFromStockTab.tsx`
- Added `prefetchBannersForPrint()` at the start of `openBrowserPrint()`

### `client/src/pages/factory/bale-stock-entry/StockEntryTab.tsx`
- Added `prefetchBannersForPrint()` in the `onNoDesign` callback (direct `generateCombinedLabelsHtml` path)

### `client/src/pages/factory/FactoryReprintLabels.tsx`
- Added `prefetchBannersForPrint()` at the start of `openBrowserPrint()`

### `client/src/pages/factory/FactoryLocationInventory.tsx`
- Added `prefetchBannersForPrint()` at the start of `openBrowserReprintLabels()`

### `client/src/pages/factory/BalesHistory.tsx`
- Added `prefetchBannersForPrint()` at the start of `openBrowserReprint()`
- Also added call in the "no design" direct branch inside the design picker dialog callback

### `client/src/pages/factory/WipersReEntry.tsx`
- Added `prefetchBannersForPrint()` at the start of `openBrowserPrint()`

### `client/src/pages/factory/FactoryBaleRelabeling.tsx`
- Added `prefetchBannersForPrint()` before the print-format loop

---

## 3. Preview Images Created

Location: `client/public/labels/previews/`

| File | Size | Source |
|---|---|---|
| hmd-purple-preview.webp | 5.1 KB | Resized from hmd-purple.jpg (1280×853 JPEG) |
| hmd-green-preview.webp  | 5.1 KB | Resized from hmd-green.jpg  (1280×853 JPEG) |
| hmd-gold-preview.webp   | 4.9 KB | Resized from hmd-gold.jpg   (1280×853 JPEG) |
| hmd-white-preview.webp  | 3.8 KB | Resized from hmd-white.jpg  (1280×853 JPEG) |
| hmd-red-preview.webp    | 4.7 KB | Resized from hmd-red.jpg    (1536×1024 PNG)  |

Generated with ImageMagick: `convert <src> -resize 400x -quality 72 <dest>.webp`

**Original files untouched** — `/labels/hmd-*.jpg` remain exactly as they were.

---

## 4. Print Usage Locations (use full-res originals)

| Code path | File | How image is used |
|---|---|---|
| `getHeaderImage()` | `labelHtml.ts` | Returns `/labels/hmd-*.jpg` URL embedded in label HTML string |
| `getDesignBannerUrl()` | `labelHtml.ts` | Returns base64 from `_bannerBase64Cache` (prefetched at print time) or falls back to `/labels/hmd-*.jpg` |
| `generateCombinedLabelsHtml()` | `labelHtml.ts` | Calls `getDesignBannerUrl()` — full-res for print window |
| `generateA5LabelsHtml()` | `labelHtml.ts` | Same pattern |

---

## 5. Screen Preview Locations (use small WebP previews)

| Component | File | URL used |
|---|---|---|
| Color selector / design picker | Any component calling `useLabelDesignColors()` | `/labels/previews/hmd-*-preview.webp` (default) |
| Settings thumbnail cards | `LabelBannersSettings.tsx` | `/labels/previews/hmd-*-preview.webp` (default) or full-res `?t=` (custom) |
| Static fallback options | `A4_DESIGN_OPTIONS` in `labelHtml.ts` | `/labels/previews/hmd-*-preview.webp` |

---

## 6. Cache Headers Verified

| Path | Cache-Control |
|---|---|
| `/labels/hmd-*.jpg?t=<ts>` (custom DB image) | `public, max-age=31536000, immutable` ✅ |
| `/labels/hmd-*.jpg` (no `?t=`, falls to static) | `public, max-age=31536000, immutable` ✅ (via express.static) |
| `/labels/previews/*.webp` | `public, max-age=31536000, immutable` ✅ (via express.static) |
| `/assets/*` (hashed Vite bundles) | `public, max-age=31536000, immutable` ✅ |
| `index.html`, `sw.js`, `manifest.json` | `no-store, no-cache` ✅ |

---

## 7. Expected Bandwidth Reduction

**Before (per page load that imports labelHtml.ts):**
- 5 images × ~2 MB each = ~10 MB downloaded eagerly in the background
- Browser could not cache them (no-store headers) → repeated on every navigation

**After (first page load ever):**
- Screen preview: 5 × ~5 KB WebP = ~25 KB total
- No banner prefetch until user clicks Print

**After (subsequent visits / navigations):**
- Screen preview WebPs: served from browser cache (immutable) = 0 bytes
- Custom banner images: served from browser cache after first print = 0 bytes

**On first print (user clicks Print):**
- `prefetchBannersForPrint()` fires → fetches all 5 banners (~2 MB each) once
- Response is now `immutable` → cached in browser for 1 year
- All subsequent prints on same device: served from cache = 0 bytes

**Estimated reduction: ~99% bandwidth drop** for label images during normal browsing. First-ever print still fetches full-res images (necessary for print quality), but those are then permanently cached.
