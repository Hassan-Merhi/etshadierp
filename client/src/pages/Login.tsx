import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Package } from "lucide-react";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    console.log("Login attempted with:", username);
    // todo: remove mock functionality - replace with actual authentication
    window.location.href = "/";
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md p-8">
        <div className="flex flex-col items-center gap-6 mb-8">
          <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Package className="h-7 w-7" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-semibold">Welcome Back</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Sign in to your ERP POS account
            </p>
          </div>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              type="text"
              placeholder="Enter your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              data-testid="input-username"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="input-password"
            />
          </div>
          <Button type="submit" className="w-full" data-testid="button-login">
            Sign In
          </Button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-sm text-muted-foreground">
            Demo credentials: admin / password
          </p>
        </div>
      </Card>
    </div>
  );
}
