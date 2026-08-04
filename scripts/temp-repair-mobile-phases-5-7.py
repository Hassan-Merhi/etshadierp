from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text()
    if old in text:
        file_path.write_text(text.replace(old, new, 1))
        return
    if new in text:
        return
    raise SystemExit(f"Expected source text not found in {path}: {old[:100]!r}")


replace_once(
    "client/src/components/ui/responsive-accessibility.tsx",
    '      data-horizontal-scroll-region="true"\n      role="region"',
    '      role="region"',
)
replace_once(
    "client/src/hooks/use-mobile-performance-lifecycle.ts",
    "      focusManager.setFocused(undefined);\n      onlineManager.setOnline(undefined);",
    "      focusManager.setFocused(undefined);",
)
replace_once(
    "server/routes/sp/spOffloadLifecycleRoutes.ts",
    "  spOffloadCharges,\n  spOffloads,\n  spPrepaidCharges,\n  spStockMovements,",
    "  spOffloadCharges,\n  spStockMovements,",
)

for path in [
    "client/src/components/ui/core-erp-mobile.tsx",
    "client/src/components/ui/factory-mobile.tsx",
    "client/src/components/ui/responsive-data-list.tsx",
]:
    replace_once(
        path,
        'import * as React from "react";\n\nimport { cn } from "@/lib/utils";',
        'import * as React from "react";\n\nimport { useApplicationLanguage } from "@/contexts/ApplicationLanguageContext";\nimport { cn } from "@/lib/utils";',
    )

replace_once(
    "client/src/components/ui/core-erp-mobile.tsx",
    '''const CoreErpHeaderActions = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(\n  ({ className, ...props }, ref) => (\n    <div\n      ref={ref}\n      role="group"\n      aria-label="Page actions"\n      data-core-erp-actions="true"\n      className={cn(\n        "grid w-full grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end [&>*]:min-h-11 [&>*]:w-full sm:[&>*]:min-h-9 sm:[&>*]:w-auto",\n        className\n      )}\n      {...props}\n    />\n  )\n);''',
    '''const CoreErpHeaderActions = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(\n  ({ className, ...props }, ref) => {\n    const { t } = useApplicationLanguage();\n\n    return (\n      <div\n        ref={ref}\n        role="group"\n        aria-label={t("accessibility.pageActions")}\n        data-core-erp-actions="true"\n        className={cn(\n          "grid w-full grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end [&>*]:min-h-11 [&>*]:w-full sm:[&>*]:min-h-9 sm:[&>*]:w-auto",\n          className\n        )}\n        {...props}\n      />\n    );\n  }\n);''',
)
replace_once(
    "client/src/components/ui/responsive-data-list.tsx",
    '''const ResponsiveDataListActions = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(\n  ({ className, ...props }, ref) => (\n    <div\n      ref={ref}\n      role="group"\n      aria-label="Row actions"\n      className={cn(\n        "mt-3 grid grid-cols-1 gap-2 border-t pt-3 min-[360px]:grid-cols-2 sm:flex sm:flex-wrap sm:justify-end [&>*]:min-h-11 [&>*]:w-full sm:[&>*]:min-h-9 sm:[&>*]:w-auto",\n        className\n      )}\n      {...props}\n    />\n  )\n);''',
    '''const ResponsiveDataListActions = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(\n  ({ className, ...props }, ref) => {\n    const { t } = useApplicationLanguage();\n\n    return (\n      <div\n        ref={ref}\n        role="group"\n        aria-label={t("accessibility.rowActions")}\n        className={cn(\n          "mt-3 grid grid-cols-1 gap-2 border-t pt-3 min-[360px]:grid-cols-2 sm:flex sm:flex-wrap sm:justify-end [&>*]:min-h-11 [&>*]:w-full sm:[&>*]:min-h-9 sm:[&>*]:w-auto",\n          className\n        )}\n        {...props}\n      />\n    );\n  }\n);''',
)
replace_once(
    "client/src/components/ui/factory-mobile.tsx",
    '''const FactoryMobileHeaderActions = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(\n  ({ className, ...props }, ref) => (\n    <div\n      ref={ref}\n      role="group"\n      aria-label="Factory page actions"\n      data-factory-mobile-actions="true"\n      className={cn(\n        "grid w-full min-w-0 grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end [&>*]:min-h-11 [&>*]:w-full sm:[&>*]:min-h-9 sm:[&>*]:w-auto",\n        className\n      )}\n      {...props}\n    />\n  )\n);''',
    '''const FactoryMobileHeaderActions = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(\n  ({ className, ...props }, ref) => {\n    const { t } = useApplicationLanguage();\n\n    return (\n      <div\n        ref={ref}\n        role="group"\n        aria-label={t("factory.pageActions")}\n        data-factory-mobile-actions="true"\n        className={cn(\n          "grid w-full min-w-0 grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end [&>*]:min-h-11 [&>*]:w-full sm:[&>*]:min-h-9 sm:[&>*]:w-auto",\n          className\n        )}\n        {...props}\n      />\n    );\n  }\n);''',
)
replace_once(
    "client/src/components/ui/factory-mobile.tsx",
    '''const FactoryMobileActionBar = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(\n  ({ className, ...props }, ref) => (\n    <div\n      ref={ref}\n      role="group"\n      aria-label="Factory workflow actions"\n      data-factory-mobile-action-bar="true"\n      className={cn(\n        "fixed inset-x-0 bottom-0 z-40 grid min-w-0 grid-cols-1 gap-2 border-t bg-background/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur min-[360px]:grid-cols-2 sm:static sm:flex sm:flex-wrap sm:justify-end sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none [&>*]:min-h-11 [&>*]:w-full sm:[&>*]:min-h-9 sm:[&>*]:w-auto",\n        className\n      )}\n      {...props}\n    />\n  )\n);''',
    '''const FactoryMobileActionBar = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(\n  ({ className, ...props }, ref) => {\n    const { t } = useApplicationLanguage();\n\n    return (\n      <div\n        ref={ref}\n        role="group"\n        aria-label={t("factory.workflowActions")}\n        data-factory-mobile-action-bar="true"\n        className={cn(\n          "fixed inset-x-0 bottom-0 z-40 grid min-w-0 grid-cols-1 gap-2 border-t bg-background/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur min-[360px]:grid-cols-2 sm:static sm:flex sm:flex-wrap sm:justify-end sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none [&>*]:min-h-11 [&>*]:w-full sm:[&>*]:min-h-9 sm:[&>*]:w-auto",\n          className\n        )}\n        {...props}\n      />\n    );\n  }\n);''',
)
replace_once(
    "client/src/i18n/applicationTranslations.ts",
    '  "accessibility.openSearch": { en: "Open search", ar: "فتح البحث", fr: "Ouvrir la recherche" },',
    '''  "accessibility.openSearch": { en: "Open search", ar: "فتح البحث", fr: "Ouvrir la recherche" },\n  "accessibility.pageActions": { en: "Page actions", ar: "إجراءات الصفحة", fr: "Actions de la page" },\n  "accessibility.rowActions": { en: "Row actions", ar: "إجراءات الصف", fr: "Actions de la ligne" },''',
)
replace_once(
    "client/src/i18n/applicationTranslations.ts",
    '  "factory.overview": { en: "Overview", ar: "نظرة عامة", fr: "Aperçu" },',
    '''  "factory.overview": { en: "Overview", ar: "نظرة عامة", fr: "Aperçu" },\n  "factory.pageActions": { en: "Factory page actions", ar: "إجراءات صفحة المصنع", fr: "Actions de la page de l’usine" },\n  "factory.workflowActions": { en: "Factory workflow actions", ar: "إجراءات سير عمل المصنع", fr: "Actions du flux de l’usine" },''',
)
