import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function write(path, source) {
  fs.writeFileSync(path, source);
}

function replaceOnce(source, oldText, newText, label) {
  const count = source.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  return source.replace(oldText, newText);
}

const mergePath = "server/routes/stock/stockMergeRoutes.ts";
let merge = read(mergePath);
merge = replaceOnce(
  merge,
  `  // Execute: POST /api/stock-items/:id/merge
  app.post("/api/stock-items/:id/merge", requireAuth, requireNonPOS, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const userId = String(req.user?.id ?? req.session.userId ?? "");`,
  `  // Execute: POST /api/stock-items/:id/merge
  app.post("/api/stock-items/:id/merge", requireAuth, requireNonPOS, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const userId: number = req.user?.id ?? req.session.userId;`,
  "restore numeric merge user ID"
);
merge = replaceOnce(
  merge,
  `  app.post("/api/stock-items/merge-logs/:logId/unmerge", requireAuth, requireNonPOS, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const userId: number = req.user?.id ?? req.session.userId;`,
  `  app.post("/api/stock-items/merge-logs/:logId/unmerge", requireAuth, requireNonPOS, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const userId = String(req.user?.id ?? req.session.userId ?? "");`,
  "use string unmerge audit user ID"
);
write(mergePath, merge);

const locationPath = "server/routes/location/locationCrudRoutes.ts";
let location = read(locationPath);
location = replaceOnce(
  location,
  `      const locationData = {
        ...parsed,
        city: parsed.city || "",
        state: parsed.state || "",
        country: parsed.country || "",
      };`,
  `      const locationData = {
        ...parsed,
        code: parsed.code!,
        city: parsed.city || "",
        state: parsed.state || "",
        country: parsed.country || "",
      };`,
  "assert generated location code"
);
write(locationPath, location);

console.log("Combo 4D validation regressions corrected.");
