import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

const LABEL_HTML_SUFFIX = "/client/src/lib/labelHtml.ts";
const EMBEDDED_LABEL_LOGO_RE = /const HMD_LOGO_BASE64\s*=\s*"data:image\/png;base64,[^"]+";/s;

export function labelAssetExtractionPlugin(): Plugin {
  const sourcePath = path.resolve(import.meta.dirname, "..", "server", "hmd-logo.png");
  let source: Buffer | null = null;
  let fileName = "";
  let publicUrl = "";

  const loadSource = () => {
    if (source) return source;
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Label logo source is missing: ${sourcePath}`);
    }
    source = fs.readFileSync(sourcePath);
    const hash = createHash("sha256").update(source).digest("hex").slice(0, 12);
    fileName = `assets/hmd-label-logo-${hash}.jpg`;
    publicUrl = `/${fileName}`;
    return source;
  };

  return {
    name: "erp-label-asset-extraction",
    enforce: "pre",

    buildStart() {
      const logo = loadSource();
      this.emitFile({
        type: "asset",
        fileName,
        source: logo,
      });
    },

    configureServer(server) {
      loadSource();
      server.middlewares.use((req, res, next) => {
        const pathname = String(req.url || "").split("?", 1)[0];
        if (pathname !== publicUrl) return next();
        res.statusCode = 200;
        res.setHeader("Content-Type", "image/jpeg");
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.end(source!);
      });
    },

    transform(code, id) {
      const normalizedId = id.replace(/\\/g, "/").split("?", 1)[0];
      if (!normalizedId.endsWith(LABEL_HTML_SUFFIX)) return null;

      loadSource();
      if (!EMBEDDED_LABEL_LOGO_RE.test(code)) {
        this.error("Expected embedded HMD label logo was not found in labelHtml.ts");
      }

      return {
        code: code.replace(EMBEDDED_LABEL_LOGO_RE, `const HMD_LOGO_BASE64 = "${publicUrl}";`),
        map: null,
      };
    },
  };
}
