import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, BarChart3, ShoppingCart, Boxes, Factory } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useTheme } from "@/components/ThemeProvider";
import { PageHeader } from "@/components/PageHeader";

const features = [
  { icon: Boxes,        title: "Inventory Management",  description: "Real-time stock tracking across all locations" },
  { icon: ShoppingCart, title: "Point of Sale",          description: "Fast, reliable checkout for every team" },
  { icon: Factory,      title: "Factory Production",     description: "Attendance, payroll, and batch output" },
  { icon: BarChart3,    title: "Business Analytics",     description: "Live reports to drive smarter decisions" },
];

const GOLD       = "#C9A84C";
const GOLD_LIGHT = "#F0C547";
const GOLD_DARK  = "#8A6E20";

const tk = {
  light: {
    leftBg:    "linear-gradient(160deg, #0D0D0D 0%, #111118 55%, #0A0A16 100%)",
    rightBg:   "linear-gradient(145deg, hsl(210 45% 94%) 0%, hsl(196 35% 95%) 45%, hsl(200 25% 97%) 100%)",
    bridge:    "linear-gradient(to right, rgba(201,168,76,0.14) 0%, transparent 100%)",
    cardGlow:  "radial-gradient(ellipse 65% 55% at 50% 50%, rgba(201,168,76,0.09) 0%, transparent 70%)",
    cardBg:    "rgba(255,255,255,0.76)",
    cardBorder:"rgba(201,168,76,0.30)",
    cardShadow:"0 8px 48px rgba(10,8,0,0.12), 0 1px 4px rgba(10,8,0,0.08)",
    headline:  GOLD_LIGHT,
    body:      "rgba(201,168,76,0.55)",
    fTitle:    "#F5E8B0",
    fDesc:     "rgba(201,168,76,0.42)",
    iconBg:    "rgba(201,168,76,0.10)",
    iconBorder:"rgba(201,168,76,0.24)",
    iconColor: GOLD,
    footer:    "rgba(201,168,76,0.22)",
    stripe:    `linear-gradient(90deg, ${GOLD_DARK} 0%, ${GOLD_LIGHT} 45%, ${GOLD_DARK} 100%)`,
    brandLabel:"hsl(200 55% 36%)",
    btnBg:     `linear-gradient(135deg, ${GOLD_DARK} 0%, ${GOLD_LIGHT} 50%, ${GOLD_DARK} 100%)`,
    btnShadow: "0 4px 22px rgba(201,168,76,0.38)",
    mobileLogoFilter: "none",
  },
  dark: {
    leftBg:    "linear-gradient(160deg, #080808 0%, #0D0D12 55%, #080812 100%)",
    rightBg:   "linear-gradient(145deg, hsl(220 50% 9%) 0%, hsl(217 44% 11%) 50%, hsl(215 38% 13%) 100%)",
    bridge:    "linear-gradient(to right, rgba(201,168,76,0.10) 0%, transparent 100%)",
    cardGlow:  "radial-gradient(ellipse 65% 55% at 50% 50%, rgba(201,168,76,0.06) 0%, transparent 70%)",
    cardBg:    "rgba(255,255,255,0.04)",
    cardBorder:"rgba(201,168,76,0.20)",
    cardShadow:"0 8px 48px rgba(0,0,0,0.55), 0 1px 4px rgba(0,0,0,0.35)",
    headline:  GOLD_LIGHT,
    body:      "rgba(201,168,76,0.45)",
    fTitle:    "#E8D080",
    fDesc:     "rgba(201,168,76,0.35)",
    iconBg:    "rgba(201,168,76,0.09)",
    iconBorder:"rgba(201,168,76,0.18)",
    iconColor: GOLD,
    footer:    "rgba(201,168,76,0.16)",
    stripe:    `linear-gradient(90deg, ${GOLD_DARK} 0%, ${GOLD_LIGHT} 45%, ${GOLD_DARK} 100%)`,
    brandLabel:"#8A7030",
    btnBg:     `linear-gradient(135deg, ${GOLD_DARK} 0%, ${GOLD} 50%, ${GOLD_DARK} 100%)`,
    btnShadow: "0 4px 22px rgba(201,168,76,0.28)",
    mobileLogoFilter: "brightness(1.1)",
  },
};

export default function Login() {
  const { toast }                       = useToast();
  const { theme }                       = useTheme();
  const [username, setUsername]         = useState("");
  const [password, setPassword]         = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const t = tk[theme as "light" | "dark"] ?? tk.light;
  const isLight = (theme as string) !== "dark";

  const loginMutation = useMutation({
    mutationFn: async (credentials: { username: string; password: string }) => {
      const res = await apiRequest("POST", "/api/auth/login", credentials);
      return await res.json();
    },
    onSuccess: () => { window.location.href = "/"; },
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

  return (
    <div
      className="flex flex-col lg:flex-row lg:h-screen lg:overflow-hidden"
      style={{ background: t.rightBg, transition: "background 0.4s ease" }}
    >

      {/* ══════════════════════════════════════════
          LEFT — Branding panel (desktop only)
      ══════════════════════════════════════════ */}
      <div
        className="hidden lg:flex lg:w-[46%] shrink-0 flex-col justify-between px-12 py-10 relative overflow-hidden"
        style={{ background: t.leftBg, transition: "background 0.4s ease" }}
      >
        {/* Gold radial glow behind logo */}
        <div
          className="pointer-events-none absolute top-0 left-0 right-0 h-[55%]"
          style={{
            background: `radial-gradient(ellipse 80% 60% at 50% 10%, rgba(201,168,76,0.13) 0%, transparent 70%)`,
          }}
        />

        {/* Subtle corner glows */}
        <div className="pointer-events-none absolute -top-32 -right-20 w-80 h-80 rounded-full opacity-[0.06]"
          style={{ background: GOLD_LIGHT, filter: "blur(40px)" }} />
        <div className="pointer-events-none absolute -bottom-20 -left-16 w-64 h-64 rounded-full opacity-[0.04]"
          style={{ background: GOLD, filter: "blur(40px)" }} />

        {/* Logo — large, screen-blended so black bg disappears */}
        <div className="relative z-10 flex flex-col items-start gap-5">
          <div className="relative">
            {/* Gold ring glow behind logo */}
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: `radial-gradient(circle, rgba(201,168,76,0.18) 0%, transparent 70%)`,
                transform: "scale(1.15)",
                filter: "blur(12px)",
              }}
            />
            <img
              src="/hmd-logo-new.jpeg"
              alt="HMD International Group"
              className="relative w-44 h-auto object-contain rounded-full"
              style={{ mixBlendMode: "screen" }}
            />
          </div>

          {/* Gold divider under logo */}
          <div
            className="w-28 h-[1px]"
            style={{ background: `linear-gradient(90deg, ${GOLD} 0%, transparent 100%)`, opacity: 0.45 }}
          />
        </div>

        {/* Headline + features */}
        <div className="relative z-10 space-y-8">
          <div className="space-y-3">
            <h2
              className="text-[2.1rem] font-extrabold leading-tight tracking-tight"
              style={{ color: t.headline, transition: "color 0.4s ease" }}
            >
              Run your business<br />with confidence.
            </h2>
            <div
              className="w-8 h-[2px] rounded-full"
              style={{ background: `linear-gradient(90deg, ${GOLD} 0%, transparent 100%)`, opacity: 0.7 }}
            />
            <p className="text-sm leading-relaxed max-w-xs"
              style={{ color: t.body, transition: "color 0.4s ease" }}>
              Production, inventory, payroll, invoices, and reporting — all in one unified platform.
            </p>
          </div>

          <div className="space-y-4">
            {features.map((f) => (
              <div key={f.title} className="flex items-center gap-3.5">
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                  style={{
                    background: t.iconBg,
                    border: `1px solid ${t.iconBorder}`,
                    transition: "background 0.4s ease",
                  }}
                >
                  <f.icon className="h-[15px] w-[15px]" style={{ color: t.iconColor }} />
                </div>
                <div>
                  <p className="font-semibold text-[0.8rem] leading-tight"
                    style={{ color: t.fTitle }}>{f.title}</p>
                  <p className="text-[0.71rem] leading-tight mt-0.5"
                    style={{ color: t.fDesc }}>{f.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <p className="relative z-10 text-[0.67rem]"
          style={{ color: t.footer, transition: "color 0.4s ease" }}>
          &copy; {new Date().getFullYear()} HMD International Group. All rights reserved.
        </p>
      </div>

      {/* ══════════════════════════════════════════
          RIGHT — Form panel
      ══════════════════════════════════════════ */}
      <div className="flex flex-1 flex-col lg:overflow-y-auto relative">

        {/* Left-edge gold bleed from the dark panel */}
        <div
          className="hidden lg:block pointer-events-none absolute top-0 left-0 bottom-0 w-32 z-0"
          style={{ background: t.bridge, transition: "background 0.4s ease" }}
        />

        {/* Soft gold radial glow behind the card */}
        <div
          className="pointer-events-none absolute inset-0 z-0"
          style={{ background: t.cardGlow, transition: "background 0.4s ease" }}
        />

        {/* Gold gradient accent stripe at the very top */}
        <div
          className="absolute top-0 left-0 right-0 h-[3px] z-10"
          style={{ background: t.stripe, transition: "background 0.4s ease" }}
        />

        {/* Top bar */}
        <div className="relative z-10 flex items-center justify-between px-6 pt-5 pb-2">
          {/* Mobile logo */}
          <div className="flex lg:hidden items-center gap-2">
            <img
              src="/hmd-logo-new.jpeg"
              alt="HMD International Group"
              className="h-9 w-9 object-contain rounded-full"
              style={{ filter: t.mobileLogoFilter, mixBlendMode: isLight ? "multiply" : "screen" }}
            />
          </div>
          <div className="hidden lg:block" />

          {/* Theme toggle */}
          <div
            className="rounded-lg border p-0.5"
            style={{
              background: isLight ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.06)",
              borderColor: isLight ? "rgba(201,168,76,0.30)" : "rgba(201,168,76,0.16)",
              backdropFilter: "blur(8px)",
              transition: "background 0.4s ease, border-color 0.4s ease",
            }}
          >
            <ThemeToggle />
          </div>
        </div>

        {/* Centred form */}
        <div className="relative z-10 flex flex-1 items-center justify-center px-6 py-10">
          <div className="w-full max-w-[400px]">

            {/* Glass card */}
            <div
              className="rounded-2xl p-8 space-y-7"
              style={{
                background: t.cardBg,
                border: `1px solid ${t.cardBorder}`,
                boxShadow: t.cardShadow,
                backdropFilter: "blur(16px)",
                WebkitBackdropFilter: "blur(16px)",
                transition: "background 0.4s ease, border-color 0.4s ease, box-shadow 0.4s ease",
              }}
            >
              {/* Brand + greeting */}
              <div className="space-y-0.5">
                <span
                  className="hidden lg:block text-[0.6rem] font-bold tracking-[0.3em] uppercase"
                  style={{ color: t.brandLabel, transition: "color 0.4s ease" }}
                >
                  HMD International Group
                </span>
                <PageHeader
                  title="Welcome back"
                  subtitle="Sign in to continue to your account"
                  showBackButton={false}
                  showHomeButton={false}
                  showCursorNavButtons={false}
                />
              </div>

              {/* Form */}
              <form onSubmit={handleLogin} className="space-y-4" noValidate>
                <div className="space-y-1.5">
                  <Label htmlFor="username">Username</Label>
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
                  <Label htmlFor="password">Password</Label>
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
                  disabled={loginMutation.isPending}
                  className="w-full h-10 rounded-md font-semibold text-sm text-black hover:opacity-90 active:scale-[0.985] disabled:opacity-60 mt-1"
                  style={{
                    background: t.btnBg,
                    boxShadow: t.btnShadow,
                    transition: "background 0.4s ease, box-shadow 0.4s ease, opacity 0.15s",
                  }}
                >
                  {loginMutation.isPending ? "Signing in…" : "Sign In"}
                </button>
              </form>
            </div>

            <p className="text-center text-[0.67rem] text-muted-foreground/40 mt-4">
              HMD International Group &mdash; ERP &amp; POS Platform
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
