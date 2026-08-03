import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import unusedImports from "eslint-plugin-unused-imports";
import configPrettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "artifacts/**",
      "drizzle.config.ts",
      "vite.config.ts",
      "server/vite.ts",
      "postcss.config.js",
      "tailwind.config.ts",
      "capacitor.config.ts",
      "scripts/**",
      "*.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      "react-hooks": reactHooks,
      "unused-imports": unusedImports,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      "@typescript-eslint/no-explicit-any": "off",

      // Unused imports were 5,566 of the repository's 6,424 lint warnings —
      // enough that nothing else in the output was readable. They are also the
      // one category a fixer can remove safely, which is why they get their own
      // rule: unused-imports/no-unused-imports carries an autofixer, while
      // @typescript-eslint/no-unused-vars has none (it reported 7 of 6,424 as
      // fixable). An error rather than a warning, since `npm run lint:fix`
      // clears it and letting them accumulate is what created the backlog.
      "@typescript-eslint/no-unused-vars": "off",
      "unused-imports/no-unused-imports": "error",

      // Everything else unused — locals, parameters, destructured bindings —
      // still needs a human to decide whether the right fix is deleting it or
      // using it, so it stays a warning. Prefix with _ to mark one deliberate.
      "unused-imports/no-unused-vars": [
        "warn",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/no-empty-interface": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-wrapper-object-types": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "@typescript-eslint/no-namespace": ["error", { allowDeclarations: true }],
      "@typescript-eslint/no-unused-expressions": ["error", { allowShortCircuit: true, allowTernary: true }],

      "no-console": "off",
      "no-undef": "off",
      "no-case-declarations": "warn",
      "no-empty": "warn",
      "no-useless-escape": "warn",
      "prefer-const": "warn",
      "no-var": "warn",

      // ESLint 10 promoted these rules into the recommended baseline. Keep them
      // visible while the legacy code is repaired incrementally, without turning
      // a toolchain upgrade into a repository-wide CI outage.
      "preserve-caught-error": "warn",
      "no-useless-assignment": "warn",
      "no-control-regex": "warn",
      "no-extra-boolean-cast": "warn",

      // A violation here is a crash, not a style opinion: React fails the render
      // outright when the hook count changes between renders. The repository was
      // carrying 36 of these as warnings, including a dispatch on `?view=` that
      // reshaped a page's hook list whenever the query string changed. All are
      // fixed, so this is an error now — the rule has no false positives worth
      // tolerating a silent regression for.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    // The four Vite plugins under build/ rewrite these files by matching exact
    // source strings — `replaceExactly` throws "Missing transform target" and
    // fails the production build when the text it expects has moved. Removing an
    // import shifts the file; running Prettier over it rewrites whole regions.
    // Either is enough to break the build, and it breaks at bundle time rather
    // than anywhere a test would catch it.
    //
    // So the autofix must not run here, and the rule has to be off rather than
    // merely a warning: `eslint --fix` applies fixes at every severity, so
    // downgrading still let `npm run lint:fix` rewrite these files and arm a
    // broken deploy. Verified — it did.
    //
    // The unused imports left in these files are therefore known and deliberate.
    // Clearing them means teaching build/vite*Plugin.ts to match on something
    // more durable than source text first.
    //
    // Keep this list in step with the literals in build/vite*Plugin.ts.
    files: [
      "client/src/lib/labelHtml.ts",
      "client/src/main.tsx",
      "client/src/pages/Daybook.tsx",
      "client/src/pages/StockEntryHistory.tsx",
      "client/src/pages/StockInSalesReport.tsx",
      "client/src/pages/StockInSalesReportDetail.tsx",
      "client/src/pages/accounts/AccountStatementView.tsx",
      "client/src/pages/factory/FactoryDaybook.tsx",
      "client/src/pages/factory/FactoryStockAllocationV5.tsx",
    ],
    rules: {
      "unused-imports/no-unused-imports": "off",
    },
  },
  {
    // These four sit within a bucket of their frozen size in
    // config/god-file-boundaries.json, and almost every file in this repository
    // is non-Prettier-conforming. CI checks formatting on *changed* files, so
    // touching one forces a full Prettier pass over it — which wraps its long
    // lines and adds 7 to 66 lines, pushing it past its cap and failing
    // tests/god-file-boundaries.test.ts.
    //
    // Removing an unused import here therefore costs an inflated architectural
    // baseline, which is a far worse trade than 25 unused imports. Left off
    // until either the file is split or the repository is formatted in one pass
    // and the god-file baselines are re-cut against the formatted sizes.
    files: [
      "client/src/pages/factory/DailyProductionReport.tsx",
      "client/src/pages/factory/FactoryBaleProductHistory.tsx",
      "client/src/pages/factory/FactoryPayrollTab.tsx",
      "server/routes/payroll/workerStatsAdvancesRoutes.ts",
    ],
    rules: {
      "unused-imports/no-unused-imports": "off",
    },
  },
  configPrettier
);
