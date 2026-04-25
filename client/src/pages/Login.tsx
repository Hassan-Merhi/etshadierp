import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, BarChart3, ShoppingCart, Boxes } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import hmdLogo from "@assets/WhatsApp_Image_2026-04-07_at_11.07.16_1775633971273.jpeg";

const features = [
  {
    icon: Boxes,
    title: "Inventory Management",
    description: "Real-time stock tracking across all locations",
  },
  {
    icon: ShoppingCart,
    title: "Point of Sale",
    description: "Fast, reliable checkout for your team",
  },
  {
    icon: BarChart3,
    title: "Business Analytics",
    description: "Insights and reports to drive growth",
  },
];

export default function Login() {
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const loginMutation = useMutation({
    mutationFn: async (credentials: { username: string; password: string }) => {
      const res = await apiRequest("POST", "/api/auth/login", credentials);
      return await res.json();
    },
    onSuccess: () => {
      window.location.href = "/";
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Login Failed",
        description: error.message || "Invalid username or password",
        variant: "destructive",
      });
    },
  });

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();

    if (!username || !password) {
      toast({
        title: "Error",
        description: "Please enter both username and password",
        variant: "destructive",
      });
      return;
    }

    loginMutation.mutate({ username, password });
  };

  return (
    <div className="min-h-screen flex">
      {/* Left panel — HMD branding */}
      <div
        className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 relative overflow-hidden"
        style={{
          background: "linear-gradient(160deg, hsl(280 70% 18%) 0%, hsl(278 65% 26%) 50%, hsl(275 60% 32%) 100%)",
        }}
      >
        {/* Decorative circles */}
        <div
          className="absolute -top-20 -right-20 w-80 h-80 rounded-full opacity-10"
          style={{ background: "hsl(45 90% 60%)" }}
        />
        <div
          className="absolute bottom-0 -left-16 w-64 h-64 rounded-full opacity-10"
          style={{ background: "hsl(45 90% 60%)" }}
        />
        <div
          className="absolute top-1/2 right-10 w-32 h-32 rounded-full opacity-5"
          style={{ background: "hsl(45 90% 60%)" }}
        />

        {/* Logo */}
        <div className="relative z-10 flex items-center gap-3">
          <img
            src={hmdLogo}
            alt="HMD International Group"
            className="h-12 w-auto rounded-md object-cover"
            style={{ aspectRatio: "1.6 / 1" }}
          />
        </div>

        {/* Headline */}
        <div className="relative z-10 space-y-8">
          <div className="space-y-4">
            <h2 className="text-4xl font-bold leading-snug" style={{ color: "hsl(45 85% 70%)" }}>
              Run your business<br />with confidence.
            </h2>
            <p className="text-base leading-relaxed max-w-sm" style={{ color: "hsl(280 20% 80%)" }}>
              Everything your team needs — from the stockroom to the checkout — in one unified platform.
            </p>
          </div>

          {/* Feature list */}
          <div className="space-y-5">
            {features.map((f) => (
              <div key={f.title} className="flex items-start gap-4">
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
                  style={{ background: "rgba(212,170,80,0.18)" }}
                >
                  <f.icon className="h-4 w-4" style={{ color: "hsl(45 85% 70%)" }} />
                </div>
                <div>
                  <p className="font-medium text-sm" style={{ color: "hsl(45 80% 82%)" }}>{f.title}</p>
                  <p className="text-sm" style={{ color: "hsl(280 20% 68%)" }}>{f.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <p className="relative z-10 text-xs" style={{ color: "hsl(280 20% 50%)" }}>
          &copy; {new Date().getFullYear()} HMD International Group. All rights reserved.
        </p>
      </div>

      {/* Right panel — form */}
      <div className="flex flex-1 flex-col items-center justify-center p-6 sm:p-12 bg-background">
        {/* Mobile logo */}
        <div className="flex lg:hidden flex-col items-center gap-3 mb-10">
          <img
            src={hmdLogo}
            alt="HMD International Group"
            className="h-16 w-auto rounded-md object-cover"
            style={{ aspectRatio: "1.6 / 1" }}
          />
          <span className="font-semibold text-sm text-muted-foreground tracking-widest uppercase">
            International Group
          </span>
        </div>

        <div className="w-full max-w-sm space-y-8">
          {/* Heading */}
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
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
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover-elevate rounded-sm"
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full"
              data-testid="button-login"
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? "Signing in..." : "Sign In"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
