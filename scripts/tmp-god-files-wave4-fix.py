from pathlib import Path

page = Path("client/src/pages/SalesReportDetail.tsx")
text = page.read_text()
start_marker = '                {/* Mobile view — item-grouped cards */}'
start = text.find(start_marker)
end_marker = '              </CardContent>\n            </Card>\n          )}\n        </div>'
end = text.rfind(end_marker)
if start < 0 or end < 0 or end <= start:
    raise RuntimeError(f"Could not isolate SalesReportDetail mobile item view: start={start} end={end}")
block = text[start:end].rstrip()
component = '''import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatNumber } from "@/lib/formatNumber";
import type { ItemGroup } from "../types";
import { formatNumericValue, profitColor } from "../utils";

type LocationColor = { dot: string; text: string; badge: string };

interface SalesReportItemMobileViewProps {
  itemGroups: ItemGroup[];
  expandedItems: Set<string>;
  toggleItem: (key: string) => void;
  multipleLocations: boolean;
  locationColorMap: Map<string, LocationColor>;
  formatAmount: (amount: number | string | null | undefined) => string;
  expandedLocations: Set<string>;
  toggleLocation: (key: string) => void;
}

export function SalesReportItemMobileView(props: SalesReportItemMobileViewProps) {
  const {
    itemGroups,
    expandedItems,
    toggleItem,
    multipleLocations,
    locationColorMap,
    formatAmount,
    expandedLocations,
    toggleLocation,
  } = props;
  return (
<>
''' + block + '''
</>
  );
}
'''
component_path = Path("client/src/pages/salesreportdetail/components/SalesReportItemMobileView.tsx")
component_path.parent.mkdir(parents=True, exist_ok=True)
component_path.write_text(component)
call = '''                <SalesReportItemMobileView
                  itemGroups={itemGroups}
                  expandedItems={expandedItems}
                  toggleItem={toggleItem}
                  multipleLocations={multipleLocations}
                  locationColorMap={locationColorMap}
                  formatAmount={formatAmount}
                  expandedLocations={expandedLocations}
                  toggleLocation={toggleLocation}
                />\n'''
text = text[:start] + call + text[end:]
anchor = 'import { SalesReportSummaryCards } from "./salesreportdetail/components/SalesReportSummaryCards";\n'
if anchor not in text:
    raise RuntimeError("Missing SalesReportSummaryCards import anchor")
text = text.replace(anchor, anchor + 'import { SalesReportItemMobileView } from "./salesreportdetail/components/SalesReportItemMobileView";\n', 1)
if 'import { Badge } from "@/components/ui/badge";' not in text:
    card_import = 'import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";\n'
    if card_import not in text:
        raise RuntimeError("Missing SalesReportDetail card import anchor")
    text = text.replace(card_import, card_import + 'import { Badge } from "@/components/ui/badge";\n', 1)
page.write_text(text)

page = Path("client/src/pages/factory/FactoryProformas.tsx")
text = page.read_text()
if '  Users,\n' not in text:
    icon_anchor = '  ChevronRight,\n'
    if icon_anchor not in text:
        raise RuntimeError("Missing FactoryProformas lucide import anchor")
    text = text.replace(icon_anchor, icon_anchor + '  Users,\n', 1)
page.write_text(text)

page = Path("client/src/pages/factory/createproformav5drawer/useCreateProformaV5Model.ts")
text = page.read_text()
type_import = 'import type { ArticleRow, BaleProduct, Draft, Props } from "./types";'
if type_import in text:
    text = text.replace(type_import, 'import type { ArticleRow, BaleProduct, Draft, FactoryCustomer, Props } from "./types";', 1)
elif 'FactoryCustomer' not in text:
    raise RuntimeError("Missing CreateProformaV5 model type import anchor")
page.write_text(text)

print("WAVE4_SALES_MOBILE_AND_IMPORT_FIXES_APPLIED")
