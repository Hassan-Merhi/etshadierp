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
      "@typescript-eslint/no-unused-vars": "off",
      "unused-imports/no-unused-imports": "error",
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
      "preserve-caught-error": "warn",
      "no-useless-assignment": "warn",
      "no-control-regex": "warn",
      "no-extra-boolean-cast": "warn",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
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
    files: [
      "client/src/pages/factory/DailyProductionReport.tsx",
      "client/src/pages/factory/FactoryBaleProductHistory.tsx",
      "client/src/pages/factory/FactoryPayrollTab.tsx",
      "server/routes/payroll/workerStatsAdvancesRoutes.ts",
      "server/routes/sp/spOffloadLifecycleRoutes.ts",
    ],
    rules: {
      "unused-imports/no-unused-imports": "off",
    },
  },
  configPrettier
);
