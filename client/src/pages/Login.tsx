import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, BarChart3, ShoppingCart, Boxes, Factory, ScanFace, Fingerprint } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, resetCsrfToken } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useTheme } from "@/components/ThemeProvider";
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { BiometricAuth, BiometryType } from "@aparajita/capacitor-biometric-auth";

const CRED_KEY = "biometric_creds";

export async function saveBiometricCredentials(username: string, password: string) {
  await Preferences.set({ key: CRED_KEY, value: JSON.stringify({ username, password }) });
}

export async function clearBiometricCredentials() {
  await Preferences.remove({ key: CRED_KEY });
}

async function loadBiometricCredentials(): Promise<{ username: string; password: string } | null> {
  const { value } = await Preferences.get({ key: CRED_KEY });
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

const features = [
  { icon: Boxes,        title: "Inventory Management",  description: "Real-time stock tracking across all locations" },
  { icon: ShoppingCart, title: "Point of Sale",          description: "Fast, reliable checkout for every team" },
  { icon: Factory,      title: "Factory Production",     description: "Attendance, payroll, and batch output" },
  { icon: BarChart3,    title: "Business Analytics",     description: "Live reports to drive smarter decisions" },
];

const GOLD       = "#C9A84C";
const GOLD_LIGHT = "#F0C547";
const GOLD_DARK  = "#8A6E20";

const DARK_BG = "linear-gradient(160deg, #0D0D0D 0%, #111118 55%, #0A0A16 100%)";

const tk = {
  light: {
    leftBg:     DARK_BG,
    rightBg:    "linear-gradient(150deg, hsl(222 28% 82%) 0%, hsl(215 24% 86%) 40%, hsl(220 20% 89%) 100%)",
    bridge:     "linear-gradient(to right, rgba(201,168,76,0.18) 0%, transparent 100%)",
    cardGlow:   "radial-gradient(ellipse 70% 60% at 50% 50%, rgba(201,168,76,0.10) 0%, transparent 70%)",
    cardBg:     "rgba(255,255,255,0.96)",
    cardBorder: "rgba(201,168,76,0.40)",
    cardShadow: "0 20px 60px rgba(10,8,30,0.22), 0 4px 12px rgba(10,8,30,0.12)",
    headline:   GOLD_LIGHT,
    body:       "rgba(240,197,71,0.52)",
    fTitle:     "#F5E8B0",
    fDesc:      "rgba(201,168,76,0.42)",
    iconBg:     "rgba(201,168,76,0.10)",
    iconBorder: "rgba(201,168,76,0.24)",
    iconColor:  GOLD,
    footer:     "rgba(201,168,76,0.25)",
    stripe:     `linear-gradient(90deg, ${GOLD_DARK} 0%, ${GOLD_LIGHT} 45%, ${GOLD_DARK} 100%)`,
    btnBg:      `linear-gradient(135deg, ${GOLD_DARK} 0%, ${GOLD_LIGHT} 50%, ${GOLD_DARK} 100%)`,
    btnShadow:  "0 4px 22px rgba(201,168,76,0.40)",
    formHeading: "#12122a",
    formSub:    "#4a4a6a",
    labelColor: "#1e1e38",
  },
  dark: {
    leftBg:     "linear-gradient(160deg, #080808 0%, #0D0D12 55%, #080812 100%)",
    rightBg:    "linear-gradient(145deg, hsl(220 50% 8%) 0%, hsl(217 44% 10%) 50%, hsl(215 38% 12%) 100%)",
    bridge:     "linear-gradient(to right, rgba(201,168,76,0.10) 0%, transparent 100%)",
    cardGlow:   "radial-gradient(ellipse 65% 55% at 50% 50%, rgba(201,168,76,0.07) 0%, transparent 70%)",
    cardBg:     "rgba(18,18,26,0.90)",
    cardBorder: "rgba(201,168,76,0.22)",
    cardShadow: "0 12px 56px rgba(0,0,0,0.60), 0 2px 6px rgba(0,0,0,0.40)",
    headline:   GOLD_LIGHT,
    body:       "rgba(201,168,76,0.45)",
    fTitle:     "#E8D080",
    fDesc:      "rgba(201,168,76,0.35)",
    iconBg:     "rgba(201,168,76,0.09)",
    iconBorder: "rgba(201,168,76,0.18)",
    iconColor:  GOLD,
    footer:     "rgba(201,168,76,0.20)",
    stripe:     `linear-gradient(90deg, ${GOLD_DARK} 0%, ${GOLD_LIGHT} 45%, ${GOLD_DARK} 100%)`,
    btnBg:      `linear-gradient(135deg, ${GOLD_DARK} 0%, ${GOLD} 50%, ${GOLD_DARK} 100%)`,
    btnShadow:  "0 4px 22px rgba(201,168,76,0.28)",
    formHeading: "#f0e6c8",
    formSub:    "rgba(240,197,71,0.55)",
    labelColor: "#d4c090",
  },
};

export default function Login() {
  const { toast }                       = useToast();
  const { theme }                       = useTheme();
  const [username, setUsername]         = useState("");
  const [password, setPassword]         = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isMobile, setIsMobile]         = useState(() => typeof window !== "undefined" && window.innerWidth < 1024);

  const [biometryAvailable, setBiometryAvailable]   = useState(false);
  const [biometryType, setBiometryType]             = useState<BiometryType | null>(null);
  const [hasSavedCreds, setHasSavedCreds]           = useState(false);
  const [biometryPending, setBiometryPending]       = useState(false);

  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(!e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    if (!isNative) return;
    (async () => {
      try {
        const info = await BiometricAuth.checkBiometry();
        if (info.isAvailable) {
          setBiometryAvailable(true);
          setBiometryType(info.biometryTypes?.[0] ?? null);
          const creds = await loadBiometricCredentials();
          setHasSavedCreds(!!creds);
        }
      } catch {
        // biometrics not available
      }
    })();
  }, [isNative]);

  const t = tk[theme as "light" | "dark"] ?? tk.light;
  const isLight = (theme as string) !== "dark";
  const ft = isMobile ? tk.dark : t;

  const [, navigate] = useLocation();

  const loginMutation = useMutation({
    mutationFn: async (credentials: { username: string; password: string }) => {
      const res = await apiRequest("POST", "/api/auth/login", credentials);
      return await res.json();
    },
    onSuccess: async (userData, credentials) => {
      queryClient.setQueryData(["/api/auth/me"], userData);
      resetCsrfToken();
      if (isNative && biometryAvailable) {
        try { await saveBiometricCredentials(credentials.username, credentials.password); } catch {}
        setHasSavedCreds(true);
      }
      navigate("/");
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Login Failed", description: error.message || "Invalid username or password", variant: "destructive" });
    },
  });

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      toast({ title: "Error", description: "Please enter both username and password", variant: "destructive" });
      return;
    }
    loginMutation.mutate({ username, password });
  };

  const handleBiometricLogin = async () => {
    setBiometryPending(true);
    try {
      await BiometricAuth.authenticate({
        reason: "Sign in to HMD ERP",
        cancelTitle: "Use Password",
        allowDeviceCredential: false,
      });
      const creds = await loadBiometricCredentials();
      if (!creds) {
        toast({ title: "No saved credentials", description: "Please sign in with your password first.", variant: "destructive" });
        return;
      }
      loginMutation.mutate(creds);
    } catch (err: any) {
      if (err?.code !== "userCancel" && err?.code !== "systemCancel" && err?.code !== "appCancel") {
        toast({ title: "Biometric failed", description: "Please sign in with your password.", variant: "destructive" });
      }
    } finally {
      setBiometryPending(false);
    }
  };

  const showBiometricButton = isNative && biometryAvailable && hasSavedCreds;

  const biometricLabel = (() => {
    if (biometryType === BiometryType.faceId) return "Face ID";
    if (biometryType === BiometryType.touchId) return "Touch ID";
    if (biometryType === BiometryType.faceAuthentication) return "Face Unlock";
    if (biometryType === BiometryType.fingerprintAuthentication) return "Fingerprint";
    return "Biometrics";
  })();

  const BiometricIcon = biometryType === BiometryType.faceId || biometryType === BiometryType.faceAuthentication
    ? ScanFace
    : Fingerprint;

  return (
    <div className="flex flex-col lg:flex-row lg:h-full lg:overflow-hidden">

      {/* ══════════════════════════════════════════
          LEFT — Branding panel (desktop only)
      ══════════════════════════════════════════ */}
      <div
        className="hidden lg:flex lg:w-[46%] shrink-0 flex-col justify-between px-12 py-10 relative overflow-hidden"
        style={{ background: t.leftBg }}
      >
        <div className="pointer-events-none absolute top-0 left-0 right-0 h-[55%]"
          style={{ background: `radial-gradient(ellipse 80% 60% at 50% 10%, rgba(201,168,76,0.14) 0%, transparent 70%)` }} />
        <div className="pointer-events-none absolute -top-32 -right-20 w-80 h-80 rounded-full opacity-[0.06]"
          style={{ background: GOLD_LIGHT, filter: "blur(40px)" }} />
        <div className="pointer-events-none absolute -bottom-20 -left-16 w-64 h-64 rounded-full opacity-[0.04]"
          style={{ background: GOLD, filter: "blur(40px)" }} />

        <div className="relative z-10 flex flex-col items-start gap-4">
          <div className="relative">
            <div className="absolute inset-0 rounded-full"
              style={{ background: `radial-gradient(circle, rgba(201,168,76,0.20) 0%, transparent 70%)`, transform: "scale(1.2)", filter: "blur(14px)" }} />
            <img src="/hmd-logo-new.jpeg" alt="HMD International Group"
              className="relative w-44 h-auto object-contain rounded-full"
              style={{ mixBlendMode: "screen" }} />
          </div>
          <div className="w-28 h-px"
            style={{ background: `linear-gradient(90deg, ${GOLD} 0%, transparent 100%)`, opacity: 0.45 }} />
        </div>

        <div className="relative z-10 space-y-8">
          <div className="space-y-3">
            <h2 className="text-[2.1rem] font-extrabold leading-tight tracking-tight"
              style={{ color: t.headline }}>
              Run your business<br />with confidence.
            </h2>
            <div className="w-8 h-[2px] rounded-full"
              style={{ background: `linear-gradient(90deg, ${GOLD} 0%, transparent 100%)`, opacity: 0.7 }} />
            <p className="text-sm leading-relaxed max-w-xs" style={{ color: t.body }}>
              Production, inventory, payroll, invoices, and reporting — all in one unified platform.
            </p>
          </div>
          <div className="space-y-4">
            {features.map((f) => (
              <div key={f.title} className="flex items-center gap-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: t.iconBg, border: `1px solid ${t.iconBorder}` }}>
                  <f.icon className="h-[15px] w-[15px]" style={{ color: t.iconColor }} />
                </div>
                <div>
                  <p className="font-semibold text-[0.8rem] leading-tight" style={{ color: t.fTitle }}>{f.title}</p>
                  <p className="text-[0.71rem] leading-tight mt-0.5" style={{ color: t.fDesc }}>{f.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="relative z-10 text-[0.67rem]" style={{ color: t.footer }}>
          &copy; {new Date().getFullYear()} HMD International Group. All rights reserved.
        </p>
      </div>

      {/* ══════════════════════════════════════════
          RIGHT — Form panel (desktop) + full page (mobile)
      ══════════════════════════════════════════ */}
      <div
        className="flex flex-1 flex-col lg:overflow-y-auto relative"
        style={{ background: isMobile ? DARK_BG : t.rightBg }}
      >
        <div className="hidden lg:block pointer-events-none absolute top-0 left-0 bottom-0 w-32 z-0"
          style={{ background: t.bridge }} />
        <div className="pointer-events-none absolute inset-0 z-0"
          style={{ background: isMobile ? "radial-gradient(ellipse 80% 50% at 50% 100%, rgba(201,168,76,0.08) 0%, transparent 70%)" : t.cardGlow }} />
        <div className="absolute top-0 left-0 right-0 h-[3px] z-10"
          style={{ background: t.stripe }} />

        {/* ── MOBILE HERO ── */}
        <div className="lg:hidden relative overflow-hidden flex flex-col items-center pb-8 pt-14 px-6">
          <div className="pointer-events-none absolute top-0 left-0 right-0 h-64"
            style={{ background: `radial-gradient(ellipse 90% 70% at 50% 0%, rgba(201,168,76,0.18) 0%, transparent 70%)` }} />
          <div className="pointer-events-none absolute -top-20 -right-10 w-56 h-56 rounded-full opacity-[0.07]"
            style={{ background: GOLD_LIGHT, filter: "blur(32px)" }} />
          <div className="pointer-events-none absolute -bottom-10 -left-10 w-40 h-40 rounded-full opacity-[0.05]"
            style={{ background: GOLD, filter: "blur(28px)" }} />

          <div className="absolute top-5 right-5 z-10">
            <div className="rounded-lg border p-0.5"
              style={{ background: "rgba(255,255,255,0.06)", borderColor: "rgba(201,168,76,0.20)", backdropFilter: "blur(8px)" }}>
              <ThemeToggle />
            </div>
          </div>

          <div className="relative z-10 mb-5">
            <div className="absolute inset-0 rounded-full"
              style={{ background: `radial-gradient(circle, rgba(201,168,76,0.22) 0%, transparent 70%)`, transform: "scale(1.25)", filter: "blur(16px)" }} />
            <img src="/hmd-logo-new.jpeg" alt="HMD International Group"
              className="relative w-28 h-28 object-contain rounded-full"
              style={{ mixBlendMode: "screen" }} />
          </div>

          <div className="relative z-10 text-center space-y-1">
            <h1 className="text-[1.45rem] font-extrabold leading-tight tracking-tight"
              style={{ color: GOLD_LIGHT }}>
              HMD International Group
            </h1>
            <p className="text-[0.73rem] tracking-widest uppercase font-medium"
              style={{ color: "rgba(201,168,76,0.50)" }}>
              ERP &amp; POS Platform
            </p>
          </div>

          <div className="relative z-10 mt-6 w-20 h-px"
            style={{ background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)`, opacity: 0.5 }} />
        </div>

        {/* Desktop: theme toggle */}
        <div className="hidden lg:flex relative z-10 items-center justify-end px-6 pt-5 pb-2">
          <div className="rounded-lg border p-0.5"
            style={{
              background: isLight ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.06)",
              borderColor: isLight ? "rgba(201,168,76,0.30)" : "rgba(201,168,76,0.16)",
              backdropFilter: "blur(8px)",
            }}>
            <ThemeToggle />
          </div>
        </div>

        {/* ── FORM ── */}
        <div className="relative z-10 flex flex-1 items-center justify-center px-6 py-8 lg:py-10">
          <div className="w-full max-w-[400px]">
            <div
              className="rounded-2xl p-7 sm:p-8 space-y-6"
              style={{
                background: ft.cardBg,
                border: `1px solid ${ft.cardBorder}`,
                boxShadow: ft.cardShadow,
                backdropFilter: "blur(18px)",
                WebkitBackdropFilter: "blur(18px)",
              }}
            >
              <div className="space-y-1">
                <p className="text-[0.6rem] font-bold tracking-[0.3em] uppercase hidden lg:block"
                  style={{ color: isLight ? "rgba(138,110,32,0.75)" : "rgba(201,168,76,0.45)" }}>
                  HMD International Group
                </p>
                <h2 className="text-2xl font-bold leading-tight" style={{ color: ft.formHeading }}>
                  Welcome back
                </h2>
                <p className="text-sm" style={{ color: ft.formSub }}>
                  Sign in to continue to your account
                </p>
              </div>

              <div className="h-px w-full"
                style={{ background: `linear-gradient(90deg, ${GOLD}44, ${GOLD}22, transparent)` }} />

              {/* Biometric quick-sign-in button */}
              {showBiometricButton && (
                <button
                  type="button"
                  onClick={handleBiometricLogin}
                  disabled={biometryPending || loginMutation.isPending}
                  data-testid="button-biometric-login"
                  className="w-full h-11 rounded-xl font-semibold text-sm flex items-center justify-center gap-2.5 disabled:opacity-60 transition-opacity"
                  style={{
                    background: "rgba(201,168,76,0.12)",
                    border: `1px solid rgba(201,168,76,0.30)`,
                    color: GOLD_LIGHT,
                  }}
                >
                  <BiometricIcon className="h-5 w-5" />
                  {biometryPending ? "Verifying…" : `Sign in with ${biometricLabel}`}
                </button>
              )}

              <form onSubmit={handleLogin} className="space-y-4" noValidate>
                <div className="space-y-1.5">
                  <Label htmlFor="username" style={{ color: ft.labelColor }}>Username</Label>
                  <Input
                    id="username"
                    type="text"
                    placeholder="Enter your username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    data-testid="input-username"
                    autoComplete="username"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="password" style={{ color: ft.labelColor }}>Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      data-testid="input-password"
                      autoComplete="current-password"
                      className="pr-9"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      data-testid="button-toggle-password"
                      tabIndex={-1}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="absolute inset-y-0 right-0 flex items-center px-2.5 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showPassword ? <EyeOff className="h-[15px] w-[15px]" /> : <Eye className="h-[15px] w-[15px]" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  data-testid="button-login"
                  disabled={loginMutation.isPending || biometryPending}
                  className="w-full h-10 rounded-md font-bold text-sm text-black hover:opacity-90 active:scale-[0.985] disabled:opacity-60 mt-1"
                  style={{
                    background: ft.btnBg,
                    boxShadow: ft.btnShadow,
                    transition: "opacity 0.15s, transform 0.1s",
                  }}
                >
                  {loginMutation.isPending ? "Signing in…" : "Sign In"}
                </button>
              </form>
            </div>

            <p className="text-center text-[0.67rem] mt-4"
              style={{ color: isMobile ? "rgba(201,168,76,0.28)" : (isLight ? "rgba(0,0,0,0.25)" : "rgba(201,168,76,0.22)") }}>
              HMD International Group &mdash; ERP &amp; POS Platform
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
