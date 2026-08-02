import "@/styles/rtl-hardening.css";
import { useEffect, useRef } from "react";
import { Redirect, Switch, Route } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChatWidget } from "@/components/ChatWidget";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ConnectivityProvider } from "@/contexts/ConnectivityContext";
import { CompanyProvider } from "@/contexts/CompanyContext";
import { LocationProvider } from "@/contexts/LocationContext";
import { DateFormatProvider } from "@/contexts/DateFormatContext";
import { CurrencyProvider } from "@/contexts/CurrencyContext";
import { CursorNavProvider } from "@/contexts/CursorNavContext";
import { ApplicationLanguageProvider } from "@/contexts/ApplicationLanguageContext";
import { GlobalLanguageSwitch } from "@/components/GlobalLanguageSwitch";
import { DateJumpDialog } from "@/components/DateJumpDialog";
import { KeyboardShortcuts } from "@/components/KeyboardShortcuts";
import { UserNotesPanel } from "@/components/UserNotesPanel";
import { useUserPreferences } from "@/hooks/use-user-preferences";
import { useServerRestart } from "@/hooks/use-server-restart";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import Login from "@/pages/Login";
import { AuthenticatedApp } from "@/app/AuthenticatedApp";
import { AppLoadingState } from "@/app/AppLoadingState";
import { useAuthenticatedUser } from "@/app/useAuthenticatedUser";

function UpdateBanner() {
  const { toast } = useToast();
  const notifiedRef = useRef(false);
  const initialVersionRef = useRef<string | null>(null);

  useEffect(() => {
    if (import.meta.env.DEV) return;

    async function checkVersion() {
      try {
        const res = await fetch("/api/build-info", { credentials: "same-origin" });
        if (!res.ok) return;
