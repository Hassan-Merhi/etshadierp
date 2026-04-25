import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, BarChart3, ShoppingCart, Boxes } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useTheme } from "@/components/ThemeProvider";
import hmdLogoColor from "@assets/WhatsApp_Image_2026-04-07_at_11.07.16_1775633971273.jpeg";

const features = [
  { icon: Boxes,        title: "Inventory Management", description: "Real-time stock tracking across all locations" },
  { icon: ShoppingCart, title: "Point of Sale",         description: "Fast, reliable checkout for your team" },
  { icon: BarChart3,    title: "Business Analytics",    description: "Insights and reports to drive growth" },
];

/* ── Midnight Navy + Teal tokens ─────────────────────────── */
const tokens = {
  light: {
    panelBg:           "linear-gradient(150deg, hsl(222 72% 10%) 0%, hsl(221 68% 15%) 55%, hsl(218 62% 21%) 100%)",
    blob:              "hsl(185 85% 55%)",
    headlineColor:     "hsl(185 80% 68%)",
    bodyColor:         "hsl(220 18% 68%)",
    featureTitleColor: "hsl(185 65% 82%)",
    featureDescColor:  "hsl(220 14% 55%)",
    iconBg:            "rgba(32, 210, 200, 0.12)",
    iconBorder:        "rgba(32, 210, 200, 0.22)",
    iconColor:         "hsl(185 80% 68%)",
    footerColor:       "hsl(220 14% 34%)",
    accentStripe:      "linear-gradient(90deg, hsl(222 72% 18%) 0%, hsl(185 80% 48%) 100%)",
    brandLabel:        "hsl(200 75% 35%)",
    signInBg:          "linear-gradient(135deg, hsl(221 68% 22%) 0%, hsl(210 65% 32%) 100%)",
    signInShadow:      "0 4px 18px rgba(15, 40, 100, 0.28)",
  },
  dark: {
    panelBg:           "linear-gradient(150deg, hsl(222 72% 6%) 0%, hsl(221 68% 10%) 55%, hsl(218 62% 14%) 100%)",
    blob:              "hsl(185 75% 45%)",
    headlineColor:     "hsl(185 72% 60%)",
    bodyColor:         "hsl(220 14% 50%)",
    featureTitleColor: "hsl(185 58% 72%)",
    featureDescColor:  "hsl(220 12% 42%)",
    iconBg:            "rgba(32, 190, 185, 0.10)",
    iconBorder:        "rgba(32, 190, 185, 0.18)",
    iconColor:         "hsl(185 72% 60%)",
    footerColor:       "hsl(220 12% 26%)",
    accentStripe:      "linear-gradient(90deg, hsl(222 72% 12%) 0%, hsl(185 72% 38%) 100%)",
    brandLabel:        "hsl(185 60% 50%)",
    signInBg:          "linear-gradient(135deg, hsl(221 68% 16%) 0%, hsl(210 62% 24%) 100%)",
    signInShadow:      "0 4px 18px rgba(8, 20, 55, 0.45)",
  },
};

export default function Login() {
  const { toast }                       = useToast();
  const { theme }                       = useTheme();
  const [username, setUsername]         = useState("");
  const [password, setPassword]         = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const t = tokens[theme as "light" | "dark"] ?? tokens.light;

  const loginMutation = useMutation({
    mutationFn: async (credentials: { username: string; password: string }) => {
      const res = await apiRequest("POST", "/api/auth/login", credentials);
      return await res.json();
    },
    onSuccess: () => { window.location.href = "/"; },
    onError:   (error: any) => {
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
    <div className="min-h-screen flex bg-background">

      {/* ══════════ LEFT — Branding panel ══════════ */}
      <div
        className="hidden lg:flex lg:w-[52%] shrink-0 flex-col justify-between p-14 relative overflow-hidden"
        style={{ background: t.panelBg, transition: "background 0.4s ease" }}
      >
        {/* Teal glow blobs */}
        <div
          className="pointer-events-none absolute -top-28 -right-28 w-[420px] h-[420px] rounded-full opacity-[0.08]"
          style={{ background: t.blob, filter: "blur(2px)", transition: "background 0.4s ease" }}
        />
        <div
          className="pointer-events-none absolute -bottom-20 -left-16 w-80 h-80 rounded-full opacity-[0.06]"
          style={{ background: t.blob, filter: "blur(2px)", transition: "background 0.4s ease" }}
        />
        {/* Extra small accent dot top-left */}
        <div
          className="pointer-events-none absolute top-1/2 left-1/3 w-40 h-40 rounded-full opacity-[0.04]"
          style={{ background: t.blob, transition: "background 0.4s ease" }}
        />

        {/* Logo */}
        <div className="relative z-10">
          <img
            src={hmdLogoColor}
            alt="HMD International Group"
            className="w-52 h-auto object-contain"
          />
        </div>

        {/* Headline + features */}
        <div className="relative z-10 space-y-10">
          <div className="space-y-4">
            <h2
              className="text-[2.6rem] font-extrabold leading-tight tracking-tight"
              style={{ color: t.headlineColor, transition: "color 0.4s ease" }}
            >
              Run your business<br />with confidence.
            </h2>
            {/* Teal underline accent */}
            <div
              className="w-14 h-[3px] rounded-full"
              style={{ background: t.headlineColor, opacity: 0.6, transition: "background 0.4s ease" }}
            />
            <p
              className="text-[0.95rem] leading-relaxed max-w-xs"
              style={{ color: t.bodyColor, transition: "color 0.4s ease" }}
            >
              Everything your team needs — from the stockroom to the checkout — in one unified platform.
            </p>
          </div>

          <div className="space-y-5">
            {features.map((f) => (
              <div key={f.title} className="flex items-start gap-4">
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                  style={{
                    background: t.iconBg,
                    border: `1px solid ${t.iconBorder}`,
                    transition: "background 0.4s ease",
                  }}
                >
                  <f.icon className="h-4 w-4" style={{ color: t.iconColor, transition: "color 0.4s ease" }} />
                </div>
                <div>
                  <p className="font-semibold text-sm" style={{ color: t.featureTitleColor, transition: "color 0.4s ease" }}>
                    {f.title}
                  </p>
                  <p className="text-sm mt-0.5" style={{ color: t.featureDescColor, transition: "color 0.4s ease" }}>
                    {f.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <p className="relative z-10 text-xs" style={{ color: t.footerColor, transition: "color 0.4s ease" }}>
          &copy; {new Date().getFullYear()} HMD International Group. All rights reserved.
        </p>
      </div>

      {/* ══════════ RIGHT — Form panel ══════════ */}
      <div className="flex flex-1 flex-col min-h-screen relative">

        {/* Gradient accent stripe */}
        <div
          className="absolute top-0 left-0 right-0 h-[3px]"
          style={{ background: t.accentStripe, transition: "background 0.4s ease" }}
        />

        {/* Top bar */}
        <div className="flex items-center justify-between px-8 pt-6 pb-2">
          <div className="flex lg:hidden items-center">
            <span
              className="text-sm font-extrabold tracking-[0.2em] uppercase"
              style={{ color: t.brandLabel, transition: "color 0.4s ease" }}
            >
              HMD
            </span>
          </div>
          <div className="hidden lg:block" />
          <ThemeToggle />
        </div>

        {/* Centered form */}
        <div className="flex flex-1 items-center justify-center px-8 pb-10">
          <div className="w-full max-w-[360px] space-y-8">

            {/* Brand label */}
            <div className="hidden lg:block">
              <span
                className="text-[0.65rem] font-bold tracking-[0.28em] uppercase"
                style={{ color: t.brandLabel, transition: "color 0.4s ease" }}
              >
                HMD International Group
              </span>
            </div>

            {/* Heading */}
            <div className="space-y-1.5">
              <h1 className="text-[1.8rem] font-bold tracking-tight">Welcome back</h1>
              <p className="text-sm text-muted-foreground">Sign in to continue to your account</p>
            </div>

            {/* Form */}
            <form onSubmit={handleLogin} className="space-y-5" noValidate>
              <div className="space-y-2">
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

              <div className="space-y-2">
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
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    data-testid="button-toggle-password"
                    tabIndex={-1}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                data-testid="button-login"
                disabled={loginMutation.isPending}
                className="w-full h-10 rounded-md font-semibold text-sm text-white transition-all disabled:opacity-60 hover:opacity-90 active:scale-[0.98]"
                style={{
                  background: t.signInBg,
                  boxShadow: t.signInShadow,
                  transition: "background 0.4s ease, box-shadow 0.4s ease",
                }}
              >
                {loginMutation.isPending ? "Signing in…" : "Sign In"}
              </button>
            </form>

            <p className="text-center text-[0.7rem] text-muted-foreground/50 pt-1">
              HMD International Group &mdash; ERP &amp; POS Platform
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
