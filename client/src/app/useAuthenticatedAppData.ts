import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { companyQueryKey } from "@/lib/companyQueryScope";
import { setAppTimezone } from "@/lib/queryClient";
import { accessQueryPolicy, liveCountQueryPolicy, stableSettingsQueryPolicy } from "@/lib/queryPolicies";
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
}

export function useAuthenticatedAppData({ selectedCompanyId, userPresent, isPOS }: UseAuthenticatedAppDataOptions) {
  const { toast } = useToast();
  const prevUnreadRef = useRef<number>(-1);

  const { data: chatUnread } = useQuery<{ count: number }>({
    queryKey: companyQueryKey("/api/chat/unread-count", selectedCompanyId),
    ...liveCountQueryPolicy(60_000),
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
    ...stableSettingsQueryPolicy,
    enabled: userPresent && !!selectedCompanyId,
  });

  useEffect(() => {
    setAppTimezone(companySettings?.timezone);
  }, [companySettings?.timezone]);

  const {
    data: myAccess,
    isLoading: myAccessLoading,
    isError: myAccessError,
  } = useQuery<FactoryAccess>({
    queryKey: companyQueryKey("/api/factory/my-access", selectedCompanyId),
    ...accessQueryPolicy,
    enabled: userPresent && !isPOS && !!selectedCompanyId,
    retry: 2,
  });

  const { data: factorySettings } = useQuery<Record<string, any>>({
    queryKey: companyQueryKey("/api/factory/settings", selectedCompanyId),
    queryFn: async () => {
      const response = await fetch("/api/factory/settings");
      return response.ok ? response.json() : {};
    },
    ...stableSettingsQueryPolicy,
    enabled: userPresent && !isPOS && !!selectedCompanyId,
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
