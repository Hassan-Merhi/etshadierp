import { Link } from "wouter";
import { BarChart3, Building2, Layers, Link2, Wrench } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const dailyWork = [
  {
    title: "Reports",
    description: "Review supplier payable, profit and loss, and export the Supplier Partner sales form.",
    href: "/sp/reports",
    icon: BarChart3,
  },
  {
    title: "Opening Stock",
    description: "Review and maintain the Supplier Partner opening-stock position.",
    href: "/sp/opening-stock",
    icon: Layers,
  },
  {
    title: "Aliases",
    description: "Maintain item aliases used by Supplier Partner workflows.",
    href: "/sp/aliases",
    icon: Link2,
  },
];

const administration = [
  {
    title: "Setup",
    description: "Initialize or repair Supplier Partner accounts, warehouse, and supplier-ledger links.",
    href: "/sp/setup",
    icon: Wrench,
  },
  {
    title: "Migration",
    description: "Open the staged GC Lshi migration workflow.",
    href: "/sp/gc-migration",
    icon: Building2,
  },
];

function NavigationCard({ item, testId }: { item: (typeof dailyWork)[number]; testId: string }) {
  const Icon = item.icon;

  return (
    <Link href={item.href}>
      <a data-testid={testId} className="block h-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Card className="h-full transition-colors hover:bg-muted/40">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-3">
              <div className="rounded-md bg-muted p-2">
                <Icon className="h-5 w-5" />
              </div>
              <CardTitle className="text-base">{item.title}</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <CardDescription>{item.description}</CardDescription>
          </CardContent>
        </Card>
      </a>
    </Link>
  );
}

export default function SpOverview() {
  return (
    <div className="mx-auto max-w-5xl space-y-6" data-testid="sp-overview">
      <div>
        <h1 className="text-2xl font-semibold">Supplier Partner</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Daily Supplier Partner work, reporting, stock setup, aliases, and administration.
        </p>
      </div>

      <section className="space-y-3" aria-labelledby="sp-daily-work-heading">
        <div>
          <h2 id="sp-daily-work-heading" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Daily work
          </h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {dailyWork.map((item) => (
            <NavigationCard key={item.href} item={item} testId={`link-sp-overview-${item.title.toLowerCase().replace(/\s+/g, "-")}`} />
          ))}
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="sp-administration-heading">
        <div>
          <h2 id="sp-administration-heading" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Administration
          </h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {administration.map((item) => (
            <NavigationCard key={item.href} item={item} testId={`link-sp-overview-${item.title.toLowerCase().replace(/\s+/g, "-")}`} />
          ))}
        </div>
      </section>
    </div>
  );
}
