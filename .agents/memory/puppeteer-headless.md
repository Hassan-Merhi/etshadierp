---
name: Puppeteer headless API
description: Puppeteer 22+ dropped headless:"new"; the correct value is headless:true
---

## Rule
Use `headless: true` when launching Puppeteer. The string `"new"` was a transitional alias in Puppeteer 19–21 and is invalid in 22+.

**Why:** Puppeteer 24.x (installed) does not accept `headless: "new"` — it will throw or produce an unexpected browser state, causing image generation to fail silently (falls back to text-only WhatsApp messages).

**How to apply:**
```typescript
// BAD (Puppeteer 22+)
browser = await puppeteer.launch({ headless: "new", ... });

// GOOD
browser = await puppeteer.launch({ headless: true, ... });
```
Affected file: `server/helpers/generateTransferImage.ts` → `renderHtmlToPng()`.
