import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { companyQueryKey } from "@/lib/companyQueryScope";
import { setAppTimezone } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface FactoryAccess {
  fullAccess: boolean;
  pageKeys: string[];
  hasErpAccess: boolean;
  hasFactoryAccess: boolean;
  companyId?: number;
  companyName?: string;
  hiddenCostFields?: string[];
}

interface UseAuthenticatedAppDataOptions {
  selectedCompanyId?: number;
  userPresent: boolean;
  isPOS: boolean;
  needsFactorySettings: boolean;
}

export function useAuthenticatedAppData({
  selectedCompanyId,
  userPresent,
  isPOS,
  needsFactorySettings,
}: UseAuthenticatedAppDataOptions) {
  const { toast } = useToast();
  const prevUnreadRef = useRef<number>(-1);

  const { data: chatUnread } = useQuery<{ count: number }>({
    queryKey: companyQueryKey("/api/chat/unread-count", selectedCompanyId),
    refetchInterval: 60000,
    enabled: isPOS && userPresent && !!selectedCompanyId,
  });

  useEffect(() => {
    if (!isPOS) return;
    const count = chatUnread?.count || 0;
    if (prevUnreadRef.current === -1) {
      prevUnreadRef.current = count;
      return;
    }
    if (count > prevUnreadRef.current) {
      toast({ title: "New message", description: `You have ${count} unread message${count > 1 ? "s" : ""}.` });
    }
    prevUnreadRef.current = count;
  }, [chatUnread?.count, isPOS, toast]);

  const { data: companySettings } = useQuery<any>({
    queryKey: companyQueryKey("/api/company-settings", selectedCompanyId),
    enabled: userPresent && !!selectedCompanyId,
  });

  useEffect(() => {
    setAppTimezone(companySettings?.timezone);
  }, [companySettings?.timezone]);

  // Access is still resolved for every non-POS user because the route guard uses
  // it to distinguish ERP-only, factory-only, and dual-access accounts.
  const {
    data: myAccess,
    isLoading: myAccessLoading,
    isError: myAccessError,
  } = useQuery<FactoryAccess>({
    queryKey: companyQueryKey("/api/factory/my-access", selectedCompanyId),
    enabled: userPresent && !isPOS && !!selectedCompanyId,
    staleTime: 30000,
    retry: 2,
  });

  // Factory settings are only used by the factory route guard. Regular ERP and
  // Properties sessions no longer download this payload on every app bootstrap.
  const { data: factorySettings } = useQuery<Record<string, any>>({
    queryKey: companyQueryKey("/api/factory/settings", selectedCompanyId),
    queryFn: async () => {
      const response = await fetch("/api/factory/settings");
      return response.ok ? response.json() : {};
    },
    enabled: userPresent && !isPOS && !!selectedCompanyId && needsFactorySettings,
    staleTime: 60000,
  });

  return {
    chatUnread,
    posImportEnabled: companySettings?.posExcelImportEnabled === true,
    myAccess,
    myAccessLoading,
    myAccessError,
    factorySettings,
  };
}
