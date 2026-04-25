import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, BarChart3, ShoppingCart, Boxes, Factory } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useTheme } from "@/components/ThemeProvider";
import hmdLogo from "../assets/hmd-logo.jpeg";

const features = [
  { icon: Boxes,        title: "Inventory Management",  description: "Real-time stock tracking across all locations" },
  { icon: ShoppingCart, title: "Point of Sale",          description: "Fast, reliable checkout for every team" },
  { icon: Factory,      title: "Factory Production",     description: "Attendance, payroll, and batch output" },
  { icon: BarChart3,    title: "Business Analytics",     description: "Live reports to drive smarter decisions" },
];

const tk = {
  light: {
    /* left navy panel */
    leftBg:      "linear-gradient(150deg, hsl(222 72% 10%) 0%, hsl(221 68% 15%) 55%, hsl(218 62% 21%) 100%)",
    /* right — soft tinted, NOT white */
    rightBg:     "linear-gradient(145deg, hsl(210 45% 94%) 0%, hsl(196 35% 95%) 45%, hsl(200 25% 97%) 100%)",
    /* bridge: left-edge glow bleeding into the right panel */
    bridge:      "linear-gradient(to right, hsl(221 68% 20% / 0.35) 0%, transparent 100%)",
    /* cyan glow behind card */
    cardGlow:    "radial-gradient(ellipse 60% 50% at 50% 50%, hsl(185 80% 68% / 0.12) 0%, transparent 70%)",
    /* card glass */
    cardBg:      "rgba(255,255,255,0.72)",
    cardBorder:  "rgba(185,215,230,0.55)",
    cardShadow:  "0 8px 40px rgba(20,60,120,0.10), 0 1px 4px rgba(20,60,120,0.06)",
    /* blobs */
    blob:        "hsl(185 85% 55%)",
    /* text */
    headline:    "hsl(185 80% 70%)",
    body:        "hsl(220 18% 65%)",
    fTitle:      "hsl(185 60% 84%)",
    fDesc:       "hsl(220 14% 52%)",
    iconBg:      "rgba(32,210,200,0.11)",
    iconBorder:  "rgba(32,210,200,0.20)",
    iconColor:   "hsl(185 80% 68%)",
    footer:      "hsl(220 14% 32%)",
    stripe:      "linear-gradient(90deg, hsl(222 72% 18%) 0%, hsl(185 80% 48%) 100%)",
    brandLabel:  "hsl(200 65% 38%)",
    btnBg:       "linear-gradient(135deg, hsl(221 68% 22%) 0%, hsl(210 65% 32%) 100%)",
    btnShadow:   "0 4px 18px rgba(15,40,100,0.26)",
    /* mobile logo: on light tinted bg, show normally */
    mobileLogoFilter: "none",
  },
  dark: {
    leftBg:      "linear-gradient(150deg, hsl(222 72% 6%) 0%, hsl(221 68% 10%) 55%, hsl(218 62% 14%) 100%)",
    /* right dark: slightly lighter navy, distinct but harmonious */
    rightBg:     "linear-gradient(145deg, hsl(220 50% 9%) 0%, hsl(217 44% 11%) 50%, hsl(215 38% 13%) 100%)",
    bridge:      "linear-gradient(to right, hsl(185 72% 40% / 0.10) 0%, transparent 100%)",
    cardGlow:    "radial-gradient(ellipse 60% 50% at 50% 50%, hsl(185 70% 55% / 0.07) 0%, transparent 70%)",
    cardBg:      "rgba(255,255,255,0.04)",
    cardBorder:  "rgba(100,160,185,0.14)",
    cardShadow:  "0 8px 40px rgba(0,0,0,0.35), 0 1px 4px rgba(0,0,0,0.25)",
    blob:        "hsl(185 75% 45%)",
    headline:    "hsl(185 72% 62%)",
    body:        "hsl(220 14% 48%)",
    fTitle:      "hsl(185 55% 73%)",
    fDesc:       "hsl(220 12% 40%)",
    iconBg:      "rgba(32,190,185,0.09)",
    iconBorder:  "rgba(32,190,185,0.17)",
    iconColor:   "hsl(185 72% 60%)",
    footer:      "hsl(220 12% 24%)",
    stripe:      "linear-gradient(90deg, hsl(222 72% 12%) 0%, hsl(185 72% 38%) 100%)",
    brandLabel:  "hsl(185 60% 50%)",
    btnBg:       "linear-gradient(135deg, hsl(221 68% 16%) 0%, hsl(210 62% 24%) 100%)",
    btnShadow:   "0 4px 18px rgba(8,20,55,0.45)",
    mobileLogoFilter: "brightness(1.15)",
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

      {/* ═══════════════════════════════════════
          LEFT — Branding panel (desktop only)
      ═══════════════════════════════════════ */}
      <div
        className="hidden lg:flex lg:w-[48%] shrink-0 flex-col justify-between px-12 py-10 relative overflow-hidden"
        style={{ background: t.leftBg, transition: "background 0.4s ease" }}
      >
        {/* Teal glow blobs */}
        <div className="pointer-events-none absolute -top-24 -right-24 w-96 h-96 rounded-full opacity-[0.09]"
          style={{ background: t.blob, filter: "blur(4px)", transition: "background 0.4s ease" }} />
        <div className="pointer-events-none absolute -bottom-16 -left-12 w-72 h-72 rounded-full opacity-[0.07]"
          style={{ background: t.blob, filter: "blur(4px)", transition: "background 0.4s ease" }} />

        {/* Logo — glass container so the purple jpg bg feels intentional */}
        <div className="relative z-10 w-fit">
          <div
            className="rounded-2xl p-2 overflow-hidden"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(100,180,200,0.18)",
              boxShadow: "0 2px 16px rgba(0,0,0,0.30)",
              backdropFilter: "blur(6px)",
            }}
          >
            <img
              src={hmdLogo}
              alt="HMD International Group"
              className="w-40 h-auto object-contain rounded-xl"
              style={{ mixBlendMode: "screen" }}
            />
          </div>
        </div>

        {/* Headline + features */}
        <div className="relative z-10 space-y-7">
          <div className="space-y-3">
            <h2
              className="text-[2.2rem] font-extrabold leading-tight tracking-tight"
              style={{ color: t.headline, transition: "color 0.4s ease" }}
            >
              Run your business<br />with confidence.
            </h2>
            <div className="w-10 h-[3px] rounded-full opacity-60"
              style={{ background: t.headline, transition: "background 0.4s ease" }} />
            <p className="text-sm leading-relaxed max-w-xs"
              style={{ color: t.body, transition: "color 0.4s ease" }}>
              Production, inventory, payroll, invoices, and reporting — all in one unified platform.
            </p>
          </div>

          <div className="space-y-3.5">
            {features.map((f) => (
              <div key={f.title} className="flex items-center gap-3">
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: t.iconBg, border: `1px solid ${t.iconBorder}`, transition: "background 0.4s ease" }}
                >
                  <f.icon className="h-[15px] w-[15px]" style={{ color: t.iconColor, transition: "color 0.4s ease" }} />
                </div>
                <div>
                  <p className="font-semibold text-[0.8rem] leading-tight"
                    style={{ color: t.fTitle, transition: "color 0.4s ease" }}>{f.title}</p>
                  <p className="text-[0.72rem] leading-tight"
                    style={{ color: t.fDesc, transition: "color 0.4s ease" }}>{f.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <p className="relative z-10 text-[0.68rem]"
          style={{ color: t.footer, transition: "color 0.4s ease" }}>
          &copy; {new Date().getFullYear()} HMD International Group. All rights reserved.
        </p>
      </div>

      {/* ═══════════════════════════════════════
          RIGHT — Form panel (glass/tinted)
      ═══════════════════════════════════════ */}
      <div className="flex flex-1 flex-col lg:overflow-y-auto relative">

        {/* Bridge: left-edge glow bleeding from the navy */}
        <div
          className="hidden lg:block pointer-events-none absolute top-0 left-0 bottom-0 w-32 z-0"
          style={{ background: t.bridge, transition: "background 0.4s ease" }}
        />

        {/* Soft cyan radial glow centred behind the card */}
        <div
          className="pointer-events-none absolute inset-0 z-0"
          style={{ background: t.cardGlow, transition: "background 0.4s ease" }}
        />

        {/* Gradient accent stripe */}
        <div className="absolute top-0 left-0 right-0 h-[3px] z-10"
          style={{ background: t.stripe, transition: "background 0.4s ease" }} />

        {/* Top bar */}
        <div className="relative z-10 flex items-center justify-between px-6 pt-5 pb-2">
          {/* Mobile logo */}
          <div className="flex lg:hidden items-center gap-2">
            <img
              src={hmdLogo}
              alt="HMD International Group"
              className="h-8 w-auto object-contain rounded-md"
              style={{ mixBlendMode: "multiply", filter: t.mobileLogoFilter }}
            />
          </div>
          <div className="hidden lg:block" />

          {/* Theme toggle */}
          <div
            className="rounded-lg border p-0.5"
            style={{
              background: isLight ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.06)",
              borderColor: isLight ? "rgba(185,215,230,0.50)" : "rgba(100,160,185,0.18)",
              backdropFilter: "blur(8px)",
              transition: "background 0.4s ease, border-color 0.4s ease",
            }}
          >
            <ThemeToggle />
          </div>
        </div>

        {/* Centred form */}
        <div className="relative z-10 flex flex-1 items-center justify-center px-6 py-10">
          <div className="w-full max-w-[420px]">

            {/* Glass card */}
            <div
              className="rounded-2xl p-8 space-y-7"
              style={{
                background: t.cardBg,
                border: `1px solid ${t.cardBorder}`,
                boxShadow: t.cardShadow,
                backdropFilter: "blur(14px)",
                WebkitBackdropFilter: "blur(14px)",
                transition: "background 0.4s ease, border-color 0.4s ease, box-shadow 0.4s ease",
              }}
            >
              {/* Brand label */}
              <div className="space-y-0.5">
                <span
                  className="hidden lg:block text-[0.6rem] font-bold tracking-[0.3em] uppercase"
                  style={{ color: t.brandLabel, transition: "color 0.4s ease" }}
                >
                  HMD International Group
                </span>
                <h1 className="text-2xl font-bold tracking-tight text-foreground">Welcome back</h1>
                <p className="text-sm text-muted-foreground">Sign in to continue to your account</p>
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
                  className="w-full h-10 rounded-md font-semibold text-sm text-white hover:opacity-90 active:scale-[0.985] disabled:opacity-60 mt-1"
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
