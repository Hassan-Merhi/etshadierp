#!/usr/bin/env python3
from pathlib import Path


def patch(path: str, replacements: list[tuple[str, str]]) -> None:
    file_path = Path(path)
    source = file_path.read_text()
    for old, new in replacements:
        if new in source:
            continue
        if old not in source:
            raise RuntimeError(f"Missing Phase 9 target in {path}: {old[:120]}")
        source = source.replace(old, new, 1)
    file_path.write_text(source)


patch(
    "client/src/contracts/sessionContracts.ts",
    [
        (
            '''    currentRole: z.string().min(1).nullable().optional(),
    active: z.boolean().optional(),
    assignedLocationId: optionalPositiveInteger,''',
            '''    currentRole: z.string().min(1).nullable().optional(),
    currentCompanyId: optionalPositiveInteger,
    currentLocationId: optionalPositiveInteger,
    currentPOSStation: optionalPositiveInteger,
    active: z.boolean().optional(),
    assignedLocationId: optionalPositiveInteger,''',
        ),
    ],
)

patch(
    "client/src/pages/GITContainers.tsx",
    [
        (
            'import { useToast } from "@/hooks/use-toast";\n',
            '''import { useToast } from "@/hooks/use-toast";
import { useCompany } from "@/contexts/CompanyContext";
import { authenticatedUserQueryOptions } from "@/contracts/sessionQueryContracts";
''',
        ),
        (
            '''  EnrichedContainerRow,
  AuthUser,
  OTW_COLS,''',
            '''  EnrichedContainerRow,
  OTW_COLS,''',
        ),
        (
            '''export default function GITContainers({ embedded = false }: { embedded?: boolean } = {}) {
  const { data: user, isLoading: userLoading } = useQuery<AuthUser>({ queryKey: ["/api/auth/me"] });
  const { toast } = useToast();''',
            '''export default function GITContainers({ embedded = false }: { embedded?: boolean } = {}) {
  const { data: user, isLoading: userLoading } = useQuery(authenticatedUserQueryOptions());
  const { selectedCompany } = useCompany();
  const { toast } = useToast();''',
        ),
        (
            '''      companyIdentity: allCompanies ? `all:${user?.id ?? "unknown"}` : user?.companyId ?? "no-company",''',
            '''      companyIdentity: allCompanies ? `all:${user?.id ?? "unknown"}` : selectedCompany?.id ?? "no-company",''',
        ),
        (
            '''      enabled: !!isAllowed,''',
            '''      enabled: !!isAllowed && !!selectedCompany,''',
        ),
        (
            '''    } catch (err: any) {
      toast({ title: "Failed to send", description: err.message, variant: "destructive" });''',
            '''    } catch (error: unknown) {
      toast({
        title: "Failed to send",
        description: error instanceof Error ? error.message : "Unable to send the container report.",
        variant: "destructive",
      });''',
        ),
        (
            '''            <p className="text-xs text-muted-foreground">{(error as any)?.message ?? "Unknown error"}</p>''',
            '''            <p className="text-xs text-muted-foreground">
              {error instanceof Error ? error.message : "Unknown error"}
            </p>''',
        ),
    ],
)

path = Path("client/src/pages/git-containers/gitContainerTypes.ts")
source = path.read_text()
start = source.find("export interface AuthUser {")
if start >= 0:
    end = source.find("\n}\n", start)
    if end < 0:
        raise RuntimeError("Could not find AuthUser interface end")
    source = source[:start] + source[end + 3 :]
path.write_text(source)

patch(
    "client/src/components/CompanySelector.tsx",
    [
        (
            'import { ChevronDown, Layers, WifiOff } from "lucide-react";\n',
            'import { AlertTriangle, ChevronDown, Layers, WifiOff } from "lucide-react";\n',
        ),
        (
            '''  const { selectedCompany, companies, isLoading, selectCompany } = useCompany();''',
            '''  const { selectedCompany, companies, isLoading, error: companyError, selectCompany } = useCompany();''',
        ),
        (
            '''  if (isLoading || !selectedCompany) {
    return (
      <Button''',
            '''  if (companyError) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled
        data-testid="button-company-selector-error"
        aria-label="Company data unavailable"
        title={companyError.message}
        className="h-10 gap-1.5 px-2 text-destructive sm:h-8"
      >
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="hidden sm:inline">Company unavailable</span>
      </Button>
    );
  }

  if (isLoading || !selectedCompany) {
    return (
      <Button''',
        ),
    ],
)

patch(
    "server/routes/auth/coreAuthRoutes.ts",
    [
        (
            '''    const { password: _password, ...userWithoutPassword } = req.user as any;
    res.json({ ...userWithoutPassword, username, currentRole: req.session.currentRole ?? null });''',
            '''    const { password: _password, ...userWithoutPassword } = req.user as any;
    res.json({
      ...userWithoutPassword,
      username,
      currentRole: req.session.currentRole ?? null,
      currentCompanyId: req.session.currentCompanyId ?? null,
      currentLocationId: req.session.currentLocationId ?? null,
      currentPOSStation: req.session.currentPOSStation ?? null,
      assignedLocationId: req.session.currentLocationId ?? req.user.assignedLocationId ?? null,
      posStation: req.session.currentPOSStation ?? req.user.posStation ?? null,
      cashAccountId: req.session.cashAccountId ?? req.user.cashAccountId ?? null,
      canSellNegativeStock: req.session.canSellNegativeStock ?? req.user.canSellNegativeStock ?? false,
      posViewOnly: Boolean((req.session as any).posViewOnly ?? false),
      daybookEditDays: req.session.daybookEditDays ?? req.user.daybookEditDays ?? null,
      canAccessCustomers: req.session.canAccessCustomers ?? req.user.canAccessCustomers ?? false,
      canDeleteRecords: req.session.canDeleteRecords ?? false,
    });''',
        ),
    ],
)

print("Bandwidth Phase 9 completion applied.")
