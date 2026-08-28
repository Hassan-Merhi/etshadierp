/**
 * Golden Coast operations — overview cards.
 *
 * Phase 6 stays on the existing POS workflow, so its card links out to /pos
 * rather than introducing a second sale path. Every other card opens the tab
 * that owns the flow.
 */
import { ArrowRightLeft, CalendarCheck2, CircleDollarSign, ShoppingCart, WalletCards } from "lucide-react";
import { useMemo } from "react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { releaseDebtEnglish } from "@/i18n/finalCloseoutTranslations";
import type { GoldenCoastTab } from "./contracts";

export function GoldenCoastOverview({ onOpenTab }: { onOpenTab: (tab: GoldenCoastTab) => void }) {
  const overviewCards = useMemo(
    () => [
      {
        phase: "Phase 6",
        title: releaseDebtEnglish("POS sales"),
        description: releaseDebtEnglish(
          "Use the existing POS sale flow. Phase 6 owns Golden Coast sale, FIFO, and COGS posting."
        ),
        icon: ShoppingCart,
        href: "/pos",
        tab: null,
      },
      {
        phase: "Phase 7",
        title: releaseDebtEnglish("HADI cash routing"),
        description: releaseDebtEnglish(
          "Collect Golden Coast sales cash through HADI or remit collected cash back to Golden Coast."
        ),
        icon: ArrowRightLeft,
        href: null,
        tab: "hadi" as GoldenCoastTab,
      },
      {
        phase: "Phase 9",
        title: releaseDebtEnglish("Hassan Savings withdrawal"),
        description: releaseDebtEnglish(
          "Withdraw only from the live Hassan Savings balance into an approved Golden Coast cash or bank account."
        ),
        icon: WalletCards,
        href: null,
        tab: "savings" as GoldenCoastTab,
      },
      {
        phase: "Phase 10",
        title: releaseDebtEnglish("GC Sales Cash settlement"),
        description: releaseDebtEnglish(
          "Settle all or part of the current collectible GC Sales Cash balance directly into Golden Coast cash or bank."
        ),
        icon: CircleDollarSign,
        href: null,
        tab: "sales-cash" as GoldenCoastTab,
      },
      {
        phase: "Phase 11",
        title: releaseDebtEnglish("Monthly 50/50 close"),
        description: releaseDebtEnglish(
          "Review server-derived monthly results and finalize the protected 50/50 profit or loss close."
        ),
        icon: CalendarCheck2,
        href: null,
        tab: "monthly-close" as GoldenCoastTab,
      },
    ],
    []
  );

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {overviewCards.map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.phase} className="h-full">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="rounded-md bg-muted p-2">
                    <Icon className="h-5 w-5" />
                  </div>
                  <Badge variant="secondary">{item.phase}</Badge>
                </div>
                <CardTitle className="pt-2 text-base">{item.title}</CardTitle>
                <CardDescription>{item.description}</CardDescription>
              </CardHeader>
              <CardContent>
                {item.href ? (
                  <Link
                    href={item.href}
                    className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
                    data-testid="link-gc-pos"
                  >
                    {releaseDebtEnglish("Open POS")}
                  </Link>
                ) : (
                  <Button onClick={() => item.tab && onOpenTab(item.tab)} data-testid={`button-gc-open-${item.tab}`}>
                    {releaseDebtEnglish("Open workflow")}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <Card>
        <CardContent className="p-5 text-sm text-muted-foreground">
          {releaseDebtEnglish(
            "Phase 8 container funding and offload remains on its existing workflow. This page does not change container reserve, landed-cost, FIFO, account provisioning, or setup behavior."
          )}
        </CardContent>
      </Card>{" "}
    </>
  );
}
