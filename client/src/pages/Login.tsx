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
import hmdLogoBW from "@assets/WhatsApp_Image_2026-04-07_at_11.07.16_1775552894976.jpeg";

const BRAND_PURPLE = "hsl(278 65% 26%)";
const BRAND_GOLD   = "hsl(45 85% 62%)";

const features = [
  { icon: Boxes,       title: "Inventory Management", description: "Real-time stock tracking across all locations" },
  { icon: ShoppingCart,title: "Point of Sale",         description: "Fast, reliable checkout for your team" },
  { icon: BarChart3,   title: "Business Analytics",   description: "Insights and reports to drive growth" },
];

export default function Login() {
  const { toast } = useToast();
  const [username, setUsername]       = useState("");
  const [password, setPassword]       = useState("");
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

      {/* ══════════════ LEFT — Branding panel ══════════════ */}
      <div
        className="hidden lg:flex lg:w-[52%] shrink-0 flex-col justify-between p-14 relative overflow-hidden"
        style={{ background: "linear-gradient(150deg, hsl(280 72% 16%) 0%, hsl(278 66% 24%) 50%, hsl(274 58% 32%) 100%)" }}
      >
        {/* Decorative blobs */}
        <div className="pointer-events-none absolute -top-28 -right-28 w-[420px] h-[420px] rounded-full"
          style={{ background: "radial-gradient(circle, hsl(45 85% 55% / 0.15) 0%, transparent 70%)" }} />
        <div className="pointer-events-none absolute bottom-0 -left-20 w-80 h-80 rounded-full"
          style={{ background: "radial-gradient(circle, hsl(45 85% 55% / 0.12) 0%, transparent 70%)" }} />

        {/* Logo — color version blends naturally on purple */}
        <div className="relative z-10">
          <img
            src={hmdLogoColor}
            alt="HMD International Group"
            className="h-16 w-auto object-contain rounded-lg"
            style={{ maxWidth: 200 }}
          />
        </div>

        {/* Headline + features */}
        <div className="relative z-10 space-y-10">
          <div className="space-y-3">
            <h2 className="text-[2.6rem] font-extrabold leading-tight tracking-tight" style={{ color: BRAND_GOLD }}>
              Run your business<br />with confidence.
            </h2>
            <p className="text-base leading-relaxed max-w-xs" style={{ color: "hsl(280 15% 75%)" }}>
              Everything your team needs — from the stockroom to the checkout — in one unified platform.
            </p>
          </div>

          <div className="space-y-5">
            {features.map((f) => (
              <div key={f.title} className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: "hsl(45 85% 55% / 0.15)", border: "1px solid hsl(45 85% 55% / 0.25)" }}>
                  <f.icon className="h-4 w-4" style={{ color: BRAND_GOLD }} />
                </div>
                <div>
                  <p className="font-semibold text-sm" style={{ color: "hsl(45 70% 85%)" }}>{f.title}</p>
                  <p className="text-sm mt-0.5" style={{ color: "hsl(280 15% 62%)" }}>{f.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <p className="relative z-10 text-xs" style={{ color: "hsl(280 15% 42%)" }}>
          &copy; {new Date().getFullYear()} HMD International Group. All rights reserved.
        </p>
      </div>

      {/* ══════════════ RIGHT — Form panel ══════════════ */}
      <div className="flex flex-1 flex-col min-h-screen relative">

        {/* Brand accent stripe at top — ties both panels together */}
        <div className="absolute top-0 left-0 right-0 h-1 rounded-none"
          style={{ background: `linear-gradient(90deg, ${BRAND_PURPLE}, ${BRAND_GOLD})` }} />

        {/* Top bar */}
        <div className="flex items-center justify-between px-8 pt-6 pb-2">
          {/* Mobile logo (B&W version looks great on light bg) */}
          <div className="flex lg:hidden items-center">
            <img
              src={hmdLogoBW}
              alt="HMD International Group"
              className="h-8 w-auto object-contain dark:invert"
              style={{ maxWidth: 140 }}
            />
          </div>
          {/* Desktop spacer */}
          <div className="hidden lg:block" />
          <ThemeToggle />
        </div>

        {/* Centered form */}
        <div className="flex flex-1 items-center justify-center px-8 pb-10">
          <div className="w-full max-w-[360px] space-y-8">

            {/* Logo above form on desktop — small, B&W, ties to left panel logo */}
            <div className="hidden lg:flex flex-col items-start gap-3">
              <img
                src={hmdLogoBW}
                alt="HMD International Group"
                className="h-9 w-auto object-contain dark:invert opacity-80"
                style={{ maxWidth: 150 }}
              />
            </div>

            {/* Heading */}
            <div className="space-y-1.5">
              <h1 className="text-[1.75rem] font-bold tracking-tight">Welcome back</h1>
              <p className="text-sm text-muted-foreground">
                Sign in to your HMD International Group account
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

              {/* Brand-colored Sign In button */}
              <Button
                type="submit"
                className="w-full font-semibold text-white"
                style={{ background: `linear-gradient(135deg, hsl(278 66% 28%), hsl(274 58% 36%))` }}
                data-testid="button-login"
                disabled={loginMutation.isPending}
              >
                {loginMutation.isPending ? "Signing in…" : "Sign In"}
              </Button>
            </form>

            {/* Bottom brand note */}
            <p className="text-center text-xs text-muted-foreground/60 pt-2">
              HMD International Group &mdash; ERP &amp; POS Platform
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
