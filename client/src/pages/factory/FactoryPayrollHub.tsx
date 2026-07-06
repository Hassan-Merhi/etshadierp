import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { HardHat, Users, Shield } from "lucide-react";
import FactoryWorkersHub from "@/pages/factory/FactoryWorkersHub";
import FactoryEmployeesHub from "@/pages/factory/FactoryEmployeesHub";
import FactoryInsurance from "@/pages/factory/FactoryInsurance";

type Section = "workers" | "employees" | "insurance";

function getSection(search: string, hasInsurance: boolean): Section {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const s = params.get("section");
  if (s === "employees") return "employees";
  if (s === "insurance" && hasInsurance) return "insurance";
  return "workers";
}

export default function FactoryPayrollHub() {
  const [, navigate] = useLocation();
  const search = useSearch();

  const { data: myAccess } = useQuery<any>({ queryKey: ["/api/factory/my-access"], staleTime: 60000 });

  // Insurance tab mirrors the sidebar pageKeys guard for factory/insurance
  const hasInsuranceAccess =
    !myAccess ||
    myAccess.fullAccess ||
    !(myAccess.pageKeys?.length > 0) ||
    myAccess.pageKeys.includes("factory/insurance");

  const activeSection = getSection(search, hasInsuranceAccess);

  const goTo = (s: Section) => navigate(`/factory/payroll-hub?section=${s}`);

  type TabDef = { key: Section; label: string; Icon: React.ElementType };
  const allTabs: TabDef[] = [
    { key: "workers",   label: "Workers",   Icon: HardHat },
    { key: "employees", label: "Employees", Icon: Users   },
    { key: "insurance", label: "Insurance", Icon: Shield  },
  ];
  const tabs = allTabs.filter((t) => t.key !== "insurance" || hasInsuranceAccess);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Branded header + tab strip ─────────────────────────────────── */}
      <div className="border-b bg-background shrink-0">
        <div className="flex items-center gap-3 px-5 pt-4 pb-3">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Users className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h1 className="text-base font-semibold leading-tight">Payroll & Benefits</h1>
            <p className="text-xs text-muted-foreground">
              Workers, employees and insurance management
            </p>
          </div>
        </div>

        <div className="flex gap-0 px-4" role="tablist">
          {tabs.map(({ key, label, Icon }) => {
            const active = activeSection === key;
            return (
              <button
                key={key}
                role="tab"
                aria-selected={active}
                data-testid={`tab-people-${key}`}
                onClick={() => goTo(key)}
                className={[
                  "flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Content ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto min-h-0">
        {activeSection === "workers" && (
          <div className="p-4">
            <FactoryWorkersHub />
          </div>
        )}
        {activeSection === "employees" && (
          <div className="p-4">
            <FactoryEmployeesHub />
          </div>
        )}
        {activeSection === "insurance" && hasInsuranceAccess && <FactoryInsurance />}
      </div>
    </div>
  );
}
