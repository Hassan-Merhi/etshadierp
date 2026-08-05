import fs from "node:fs";

const packagePath = "package.json";
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));

const productionVersions = {
  "@capacitor/android": "^8.4.2",
  "@capacitor/cli": "^8.4.2",
  "@capacitor/core": "^8.4.2",
  "@capacitor/ios": "^8.4.2",
  "@google/genai": "^2.15.0",
  "@radix-ui/react-accordion": "^1.2.20",
  "@radix-ui/react-alert-dialog": "^1.1.23",
  "@radix-ui/react-aspect-ratio": "^1.1.15",
  "@radix-ui/react-avatar": "^1.2.6",
  "@radix-ui/react-checkbox": "^1.3.11",
  "@radix-ui/react-collapsible": "^1.1.20",
  "@radix-ui/react-context-menu": "^2.3.7",
  "@radix-ui/react-dialog": "^1.1.23",
  "@radix-ui/react-dropdown-menu": "^2.1.24",
  "@radix-ui/react-hover-card": "^1.1.23",
  "@radix-ui/react-label": "^2.1.15",
  "@radix-ui/react-menubar": "^1.1.24",
  "@radix-ui/react-navigation-menu": "^1.2.22",
  "@radix-ui/react-popover": "^1.1.23",
  "@radix-ui/react-progress": "^1.1.16",
  "@radix-ui/react-radio-group": "^1.4.7",
  "@radix-ui/react-scroll-area": "^1.2.18",
  "@radix-ui/react-select": "^2.3.7",
  "@radix-ui/react-separator": "^1.1.15",
  "@radix-ui/react-slider": "^1.4.7",
  "@radix-ui/react-slot": "^1.3.3",
  "@radix-ui/react-switch": "^1.3.7",
  "@radix-ui/react-tabs": "^1.1.21",
  "@radix-ui/react-toast": "^1.2.23",
  "@radix-ui/react-toggle": "^1.1.18",
  "@radix-ui/react-toggle-group": "^1.1.19",
  "@radix-ui/react-tooltip": "^1.2.16",
  "@replit/vite-plugin-runtime-error-modal": "^0.0.6",
  "@simplewebauthn/server": "^13.3.2",
  "@tanstack/react-query": "^5.101.4",
  autoprefixer: "^10.5.4",
  "bwip-js": "^4.11.2",
  esbuild: "^0.28.1",
  openai: "^7.2.0",
  ws: "^8.21.1",
};

const developmentVersions = {
  "@tailwindcss/vite": "^4.3.3",
  "@types/node": "26.1.2",
  "@vitest/coverage-v8": "4.1.10",
  typescript: "6.0.3",
  "typescript-eslint": "^8.65.0",
  vitest: "^4.1.10",
};

for (const [name, version] of Object.entries(productionVersions)) {
  if (!(name in pkg.dependencies)) throw new Error(`Missing production dependency: ${name}`);
  pkg.dependencies[name] = version;
}

for (const [name, version] of Object.entries(developmentVersions)) {
  if (!(name in pkg.devDependencies)) throw new Error(`Missing development dependency: ${name}`);
  pkg.devDependencies[name] = version;
}

pkg.engines = { ...(pkg.engines ?? {}), node: ">=22.0.0" };
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
fs.writeFileSync(".nvmrc", "22\n");

const renderPath = "render.yaml";
const render = fs.readFileSync(renderPath, "utf8");
const updatedRender = render.replace(
  /(- key: NODE_VERSION\s*\n\s*value:)\s*["']?20["']?/m,
  "$1 22",
);
if (updatedRender === render) throw new Error("Render NODE_VERSION 20 declaration was not found");
fs.writeFileSync(renderPath, updatedRender);
