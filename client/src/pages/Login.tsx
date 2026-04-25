import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, BarChart3, ShoppingCart, Boxes } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from "@/components/ThemeToggle";
import hmdLogoColor from "@assets/WhatsApp_Image_2026-04-07_at_11.07.16_1775633971273.jpeg";

const BRAND_PURPLE = "hsl(278 65% 26%)";
const BRAND_GOLD   = "hsl(45 85% 62%)";

const features = [
  { icon: Boxes,        title: "Inventory Management", description: "Real-time stock tracking across all locations" },
  { icon: ShoppingCart, title: "Point of Sale",         description: "Fast, reliable checkout for your team" },
  { icon: BarChart3,    title: "Business Analytics",    description: "Insights and reports to drive growth" },
];

export default function Login() {
  const { toast } = useToast();
  const [username, setUsername]         = useState("");
  const [password, setPassword]         = useState("");
  const [showPassword, setShowPassword] = useState(false);

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
    <div className="min-h-screen flex bg-background">

      {/* ══════════ LEFT — Branding panel ══════════ */}
      <div
        className="hidden lg:flex lg:w-[52%] shrink-0 flex-col justify-between p-14 relative overflow-hidden"
        style={{
          background: "linear-gradient(150deg, hsl(280 72% 16%) 0%, hsl(278 66% 24%) 55%, hsl(274 58% 32%) 100%)",
        }}
      >
        {/* Subtle decorative circles (solid color + low opacity) */}
        <div className="pointer-events-none absolute -top-24 -right-24 w-96 h-96 rounded-full opacity-[0.07]"
          style={{ background: "hsl(45 90% 65%)" }} />
        <div className="pointer-events-none absolute bottom-[-5rem] -left-16 w-72 h-72 rounded-full opacity-[0.07]"
          style={{ background: "hsl(45 90% 65%)" }} />

        {/* Logo — color version; the image's own purple bg blends with the panel */}
        <div className="relative z-10">
          <img
            src={hmdLogoColor}
            alt="HMD International Group"
            className="w-52 h-auto object-contain"
          />
        </div>

        {/* Headline + features */}
        <div className="relative z-10 space-y-10">
          <div className="space-y-3">
            <h2
              className="text-[2.5rem] font-extrabold leading-tight tracking-tight"
              style={{ color: BRAND_GOLD }}
            >
              Run your business<br />with confidence.
            </h2>
            <p className="text-[0.95rem] leading-relaxed max-w-xs" style={{ color: "hsl(280 12% 72%)" }}>
              Everything your team needs — from the stockroom to the checkout — in one unified platform.
            </p>
          </div>

          <div className="space-y-5">
            {features.map((f) => (
              <div key={f.title} className="flex items-start gap-4">
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: "rgba(212,170,55,0.12)", border: "1px solid rgba(212,170,55,0.22)" }}
                >
                  <f.icon className="h-4 w-4" style={{ color: BRAND_GOLD }} />
                </div>
                <div>
                  <p className="font-semibold text-sm" style={{ color: "hsl(45 65% 84%)" }}>
                    {f.title}
                  </p>
                  <p className="text-sm mt-0.5" style={{ color: "hsl(280 12% 60%)" }}>
                    {f.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <p className="relative z-10 text-xs" style={{ color: "hsl(280 12% 38%)" }}>
          &copy; {new Date().getFullYear()} HMD International Group. All rights reserved.
        </p>
      </div>

      {/* ══════════ RIGHT — Form panel ══════════ */}
      <div className="flex flex-1 flex-col min-h-screen relative">

        {/* Thin gradient accent stripe at top — visual link to the left panel */}
        <div
          className="absolute top-0 left-0 right-0 h-[3px]"
          style={{ background: `linear-gradient(90deg, ${BRAND_PURPLE} 0%, ${BRAND_GOLD} 100%)` }}
        />

        {/* Top bar */}
        <div className="flex items-center justify-between px-8 pt-6 pb-2">
          {/* Mobile brand name */}
          <div className="flex lg:hidden items-center">
            <span className="text-sm font-extrabold tracking-[0.2em] uppercase" style={{ color: BRAND_PURPLE }}>
              HMD
            </span>
          </div>
          <div className="hidden lg:block" />
          <ThemeToggle />
        </div>

        {/* Centered form */}
        <div className="flex flex-1 items-center justify-center px-8 pb-10">
          <div className="w-full max-w-[360px] space-y-8">

            {/* Brand label — desktop only, above heading */}
            <div className="hidden lg:block">
              <span
                className="text-[0.65rem] font-bold tracking-[0.28em] uppercase"
                style={{ color: BRAND_PURPLE }}
              >
                HMD International Group
              </span>
            </div>

            {/* Heading */}
            <div className="space-y-1.5">
              <h1 className="text-[1.8rem] font-bold tracking-tight">Welcome back</h1>
              <p className="text-sm text-muted-foreground">
                Sign in to continue to your account
              </p>
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

              {/* Purple brand-matched Sign In button */}
              <button
                type="submit"
                data-testid="button-login"
                disabled={loginMutation.isPending}
                className="w-full h-10 rounded-md font-semibold text-sm text-white transition-opacity disabled:opacity-60"
                style={{
                  background: `linear-gradient(135deg, hsl(278 66% 28%) 0%, hsl(278 60% 36%) 100%)`,
                }}
              >
                {loginMutation.isPending ? "Signing in…" : "Sign In"}
              </button>
            </form>

            {/* Bottom tagline */}
            <p className="text-center text-[0.7rem] text-muted-foreground/50 pt-1">
              HMD International Group &mdash; ERP &amp; POS Platform
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
