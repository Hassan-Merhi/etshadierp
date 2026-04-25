import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Package, Eye, EyeOff, BarChart3, ShoppingCart, Boxes } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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
      {/* Left panel — branding */}
      <div
        className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 relative overflow-hidden"
        style={{
          background: "linear-gradient(135deg, hsl(217 91% 22%) 0%, hsl(217 91% 35%) 55%, hsl(210 80% 48%) 100%)",
        }}
      >
        {/* Decorative circles */}
        <div
          className="absolute -top-24 -right-24 w-96 h-96 rounded-full opacity-10"
          style={{ background: "hsl(210 20% 98%)" }}
        />
        <div
          className="absolute bottom-0 -left-16 w-72 h-72 rounded-full opacity-10"
          style={{ background: "hsl(210 20% 98%)" }}
        />
        <div
          className="absolute top-1/2 right-8 w-40 h-40 rounded-full opacity-5"
          style={{ background: "hsl(210 20% 98%)" }}
        />

        {/* Logo */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/20 backdrop-blur-sm">
            <Package className="h-5 w-5 text-white" />
          </div>
          <span className="text-white font-semibold text-lg tracking-wide">ERP POS</span>
        </div>

        {/* Headline */}
        <div className="relative z-10 space-y-8">
          <div className="space-y-4">
            <h2 className="text-4xl font-bold text-white leading-snug">
              Run your business<br />with confidence.
            </h2>
            <p className="text-white/70 text-base leading-relaxed max-w-sm">
              Everything your team needs — from the stockroom to the checkout — in one unified platform.
            </p>
          </div>

          {/* Feature list */}
          <div className="space-y-5">
            {features.map((f) => (
              <div key={f.title} className="flex items-start gap-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white/15 backdrop-blur-sm">
                  <f.icon className="h-4 w-4 text-white" />
                </div>
                <div>
                  <p className="text-white font-medium text-sm">{f.title}</p>
                  <p className="text-white/60 text-sm">{f.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer note */}
        <p className="relative z-10 text-white/40 text-xs">
          &copy; {new Date().getFullYear()} ERP POS. All rights reserved.
        </p>
      </div>

      {/* Right panel — form */}
      <div className="flex flex-1 flex-col items-center justify-center p-6 sm:p-12 bg-background">
        {/* Mobile logo */}
        <div className="flex lg:hidden items-center gap-2 mb-10">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Package className="h-5 w-5" />
          </div>
          <span className="font-semibold text-base">ERP POS</span>
        </div>

        <div className="w-full max-w-sm space-y-8">
          {/* Heading */}
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
            <p className="text-sm text-muted-foreground">
              Sign in to your account to continue
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
