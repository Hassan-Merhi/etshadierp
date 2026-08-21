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
page.write_text(text)
print("WAVE4_SALES_MOBILE_EXTRACTED")
