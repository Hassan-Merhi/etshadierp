import fs from "node:fs";
import { describe, it } from "vitest";
import { format } from "prettier";

const files = [
  "server/routes/screenFeedRoutes.ts",
  "server/services/remoteSupportRuntime.ts",
];

describe("remote support formatter helper", () => {
  it("emits exact Prettier output for the phase sources", async () => {
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      const formatted = await format(source, { filepath: file });
      const encoded = Buffer.from(formatted, "utf8").toString("base64");
      console.log(`REMOTE_SUPPORT_FORMATTED_BEGIN:${file}:${encoded}:REMOTE_SUPPORT_FORMATTED_END`);
    }
  });
});
