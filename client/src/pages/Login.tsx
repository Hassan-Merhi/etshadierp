import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, BarChart3, ShoppingCart, Boxes, Factory, ScanFace, Fingerprint, KeyRound, X } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, resetCsrfToken } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { BiometricAuth, BiometryType } from "@aparajita/capacitor-biometric-auth";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";

function passkeyStorageKey(username: string) { return `passkey_registered_${username}`; }

const CRED_KEY    = "biometric_creds";
const OPT_IN_KEY  = "biometric_opted_in";

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
const LEFT_BG    = "linear-gradient(160deg, #0D0D0D 0%, #111118 55%, #0A0A16 100%)";
const BTN_BG     = `linear-gradient(135deg, ${GOLD_DARK} 0%, ${GOLD_LIGHT} 50%, ${GOLD_DARK} 100%)`;
const BTN_SHADOW = "0 4px 22px rgba(201,168,76,0.35)";

export default function Login() {
  const { toast }                       = useToast();
  const [username, setUsername]         = useState("");
  const [password, setPassword]         = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [biometryAvailable, setBiometryAvailable]   = useState(false);
  const [biometryType, setBiometryType]             = useState<BiometryType | null>(null);
  const [hasSavedCreds, setHasSavedCreds]           = useState(false);
  const [biometryPending, setBiometryPending]       = useState(false);
  const [showBioPrompt, setShowBioPrompt]           = useState(false);
  const pendingUserData                             = useRef<any>(null);
  const pendingCredentials                          = useRef<{ username: string; password: string } | null>(null);

  const [passKeyPending, setPassKeyPending]             = useState(false);
  const [showPasskeyRegister, setShowPasskeyRegister]   = useState(false);
  const [passkeyRegPending, setPasskeyRegPending]       = useState(false);
  const [hasSavedPasskey, setHasSavedPasskey]           = useState(false);
  const pendingPasskeyUser                              = useRef<string>("");

  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    if (isNative || !username) { setHasSavedPasskey(false); return; }
    setHasSavedPasskey(!!localStorage.getItem(passkeyStorageKey(username.trim())));
  }, [username, isNative]);

  useEffect(() => {
    if (!isNative) return;
    (async () => {
      try {
        const info = await BiometricAuth.checkBiometry();
        if (!info.isAvailable) return;
        setBiometryAvailable(true);
        setBiometryType(info.biometryTypes?.[0] ?? null);
        const creds = await loadBiometricCredentials();
        if (!creds) return;
        setHasSavedCreds(true);
        const { value: optIn } = await Preferences.get({ key: OPT_IN_KEY });
        if (optIn === "yes") {
          setTimeout(() => triggerBiometric(creds), 600);
        }
      } catch { /* biometrics not available */ }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNative]);

  const [, navigate] = useLocation();
  const passkeySupported = !isNative && typeof window !== "undefined" && !!(window as any).PublicKeyCredential;

  const finalizeLogin = () => {
    if (!pendingUserData.current) return;
    queryClient.setQueryData(["/api/auth/me"], pendingUserData.current);
    resetCsrfToken();
    pendingUserData.current = null;
    pendingCredentials.current = null;
    navigate("/");
  };

  const loginMutation = useMutation({
    mutationFn: async (credentials: { username: string; password: string }) => {
      const res = await apiRequest("POST", "/api/auth/login", credentials);
      return await res.json();
    },
    onSuccess: async (userData, credentials) => {
      if (isNative && biometryAvailable) {
        const { value: optIn } = await Preferences.get({ key: OPT_IN_KEY });
        if (optIn === "yes") {
          await saveBiometricCredentials(credentials.username, credentials.password);
          setHasSavedCreds(true);
          queryClient.setQueryData(["/api/auth/me"], userData);
          resetCsrfToken();
          navigate("/");
        } else if (optIn === "no") {
          queryClient.setQueryData(["/api/auth/me"], userData);
          resetCsrfToken();
          navigate("/");
        } else {
          pendingUserData.current = userData;
          pendingCredentials.current = credentials;
          setShowBioPrompt(true);
        }
      } else if (!isNative && passkeySupported) {
        const alreadySaved = !!localStorage.getItem(passkeyStorageKey(credentials.username));
        if (alreadySaved) {
          queryClient.setQueryData(["/api/auth/me"], userData);
          resetCsrfToken();
          navigate("/");
        } else {
          pendingUserData.current = userData;
          pendingPasskeyUser.current = credentials.username;
          setShowPasskeyRegister(true);
        }
      } else {
        queryClient.setQueryData(["/api/auth/me"], userData);
        resetCsrfToken();
        navigate("/");
      }
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

  const handleEnableBiometrics = async () => {
    setShowBioPrompt(false);
    if (pendingCredentials.current) {
      await saveBiometricCredentials(pendingCredentials.current.username, pendingCredentials.current.password);
      setHasSavedCreds(true);
    }
    await Preferences.set({ key: OPT_IN_KEY, value: "yes" });
    finalizeLogin();
  };

  const handleDeclineBiometrics = async () => {
    setShowBioPrompt(false);
    await Preferences.set({ key: OPT_IN_KEY, value: "no" });
    finalizeLogin();
  };

  const triggerBiometric = async (creds?: { username: string; password: string }) => {
    setBiometryPending(true);
    try {
      await BiometricAuth.authenticate({
        reason: "Sign in to HMD ERP",
        cancelTitle: "Use Password",
        allowDeviceCredential: false,
      });
      const savedCreds = creds ?? (await loadBiometricCredentials());
      if (!savedCreds) {
        toast({ title: "No saved credentials", description: "Please sign in with your password first.", variant: "destructive" });
        return;
      }
      loginMutation.mutate(savedCreds);
    } catch (err: any) {
      if (err?.code !== "userCancel" && err?.code !== "systemCancel" && err?.code !== "appCancel") {
        toast({ title: "Biometric failed", description: "Please sign in with your password.", variant: "destructive" });
      }
    } finally {
      setBiometryPending(false);
    }
  };

  const handleRegisterPasskey = async () => {
    setPasskeyRegPending(true);
    try {
      const optionsRes = await apiRequest("POST", "/api/auth/passkey/register/options", {});
      const options = await optionsRes.json();
      const regResponse = await startRegistration({ optionsJSON: options });
      const verifyRes = await apiRequest("POST", "/api/auth/passkey/register/verify", { ...regResponse, deviceName: navigator.platform || "Browser" });
      if (!verifyRes.ok) throw new Error("Passkey registration failed");
      localStorage.setItem(passkeyStorageKey(pendingPasskeyUser.current), "1");
      setHasSavedPasskey(true);
    } catch (err: any) {
      if (err?.name === "NotAllowedError") {
        // user cancelled
      } else {
        toast({ title: "Passkey setup failed", description: err.message || "Could not save passkey", variant: "destructive" });
      }
    } finally {
      setPasskeyRegPending(false);
      setShowPasskeyRegister(false);
      queryClient.setQueryData(["/api/auth/me"], pendingUserData.current);
      resetCsrfToken();
      pendingUserData.current = null;
      navigate("/");
    }
  };

  const handleSkipPasskey = () => {
    setShowPasskeyRegister(false);
    queryClient.setQueryData(["/api/auth/me"], pendingUserData.current);
    resetCsrfToken();
    pendingUserData.current = null;
    navigate("/");
  };

  const handlePasskeyLogin = async () => {
    setPassKeyPending(true);
    try {
      const optionsRes = await apiRequest("POST", "/api/auth/passkey/authenticate/options", { username: username || undefined });
      const options = await optionsRes.json();
      const assertion = await startAuthentication({ optionsJSON: options });
      const verifyRes = await apiRequest("POST", "/api/auth/passkey/authenticate/verify", assertion);
      if (!verifyRes.ok) {
        const err = await verifyRes.json();
        throw new Error(err.message || "Passkey verification failed");
      }
      const userData = await verifyRes.json();
      queryClient.setQueryData(["/api/auth/me"], userData);
      resetCsrfToken();
      navigate("/");
    } catch (err: any) {
      if (err?.name === "NotAllowedError") return;
      toast({ title: "Passkey failed", description: err.message || "Could not sign in with passkey", variant: "destructive" });
    } finally {
      setPassKeyPending(false);
    }
  };

  const showBiometricButton = isNative && biometryAvailable && hasSavedCreds;
  const biometricLabel = (() => {
    if (biometryType === BiometryType.faceId)                    return "Face ID";
    if (biometryType === BiometryType.touchId)                   return "Touch ID";
    if (biometryType === BiometryType.faceAuthentication)        return "Face Unlock";
    if (biometryType === BiometryType.fingerprintAuthentication) return "Fingerprint";
    return "Biometrics";
  })();
  const BiometricIcon = (biometryType === BiometryType.faceId || biometryType === BiometryType.faceAuthentication)
    ? ScanFace : Fingerprint;

  return (
    <div className="flex flex-col lg:flex-row min-h-full lg:h-full lg:overflow-hidden">

      {/* ══════════════════════════════════════════
          LEFT — Always-dark branding panel (desktop only)
      ══════════════════════════════════════════ */}
      <div
        className="hidden lg:flex lg:w-[46%] shrink-0 flex-col justify-between px-12 py-10 relative overflow-hidden"
        style={{ background: LEFT_BG }}
      >
        {/* Ambient glows */}
        <div className="pointer-events-none absolute top-0 left-0 right-0 h-[55%]"
          style={{ background: "radial-gradient(ellipse 80% 60% at 50% 10%, rgba(201,168,76,0.14) 0%, transparent 70%)" }} />
        <div className="pointer-events-none absolute -top-32 -right-20 w-80 h-80 rounded-full opacity-[0.06]"
          style={{ background: GOLD_LIGHT, filter: "blur(40px)" }} />
        <div className="pointer-events-none absolute -bottom-20 -left-16 w-64 h-64 rounded-full opacity-[0.04]"
          style={{ background: GOLD, filter: "blur(40px)" }} />

        {/* Logo */}
        <div className="relative z-10 flex flex-col items-start gap-4">
          <div className="relative">
            <div className="absolute inset-0 rounded-full"
              style={{ background: "radial-gradient(circle, rgba(201,168,76,0.20) 0%, transparent 70%)", transform: "scale(1.2)", filter: "blur(14px)" }} />
            <img src="/hmd-logo-new.jpeg" alt="HMD International Group"
              className="relative w-44 h-auto object-contain rounded-full"
              style={{ mixBlendMode: "screen" }} />
          </div>
          <div className="w-28 h-px"
            style={{ background: `linear-gradient(90deg, ${GOLD} 0%, transparent 100%)`, opacity: 0.45 }} />
        </div>

        {/* Headline + features */}
        <div className="relative z-10 space-y-8">
          <div className="space-y-3">
            <h2 className="text-[2.1rem] font-extrabold leading-tight tracking-tight"
              style={{ color: GOLD_LIGHT }}>
              Run your business<br />with confidence.
            </h2>
            <div className="w-8 h-[2px] rounded-full"
              style={{ background: `linear-gradient(90deg, ${GOLD} 0%, transparent 100%)`, opacity: 0.7 }} />
            <p className="text-sm leading-relaxed max-w-xs" style={{ color: "rgba(240,197,71,0.52)" }}>
              Production, inventory, payroll, invoices, and reporting — all in one unified platform.
            </p>
          </div>
          <div className="space-y-4">
            {features.map((f) => (
              <div key={f.title} className="flex items-center gap-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: "rgba(201,168,76,0.10)", border: "1px solid rgba(201,168,76,0.24)" }}>
                  <f.icon className="h-[15px] w-[15px]" style={{ color: GOLD }} />
                </div>
                <div>
                  <p className="font-semibold text-[0.8rem] leading-tight" style={{ color: "#F5E8B0" }}>{f.title}</p>
                  <p className="text-[0.71rem] leading-tight mt-0.5" style={{ color: "rgba(201,168,76,0.42)" }}>{f.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="relative z-10 text-[0.67rem]" style={{ color: "rgba(201,168,76,0.25)" }}>
          &copy; {new Date().getFullYear()} HMD International Group. All rights reserved.
        </p>
      </div>

      {/* ══════════════════════════════════════════
          RIGHT — Uses app theme (bg-background)
      ══════════════════════════════════════════ */}
      <div className="flex flex-1 flex-col bg-background relative">

        {/* Thin gold top stripe */}
        <div className="absolute top-0 left-0 right-0 h-[2px] z-10"
          style={{ background: `linear-gradient(90deg, ${GOLD_DARK}, ${GOLD_LIGHT}, ${GOLD_DARK})` }} />

        {/* ── MOBILE BRANDING ── */}
        <div className="lg:hidden flex flex-col items-center pt-14 pb-6 px-6">
          {/* Logo in a dark circle so it looks right on any bg */}
          <div className="w-24 h-24 rounded-full overflow-hidden mb-4 ring-2 ring-offset-2 ring-offset-background"
            style={{ background: "#0D0D0D", ringColor: `${GOLD}55` }}>
            <img src="/hmd-logo-new.jpeg" alt="HMD International Group"
              className="w-full h-full object-cover" />
          </div>
          <h1 className="text-base font-bold text-foreground tracking-tight">HMD International Group</h1>
          <p className="text-[0.7rem] text-muted-foreground tracking-widest uppercase mt-0.5">ERP &amp; POS Platform</p>
        </div>

        {/* Theme toggle */}
        <div className="absolute top-4 right-4 z-20">
          <ThemeToggle />
        </div>

        {/* ── FORM ── */}
        <div className="relative z-10 flex flex-1 items-center justify-center px-6 py-8 lg:py-10">
          <div className="w-full max-w-[380px] space-y-5">

            {/* Heading */}
            <div className="space-y-1">
              <p className="text-[0.6rem] font-bold tracking-[0.3em] uppercase text-muted-foreground hidden lg:block">
                HMD International Group
              </p>
              <h2 className="text-2xl font-bold text-foreground">Welcome back</h2>
              <p className="text-sm text-muted-foreground">Sign in to continue to your account</p>
            </div>

            {/* Gold accent rule */}
            <div className="h-px w-full"
              style={{ background: `linear-gradient(90deg, ${GOLD}55, ${GOLD}22, transparent)` }} />

            {/* Biometric quick-sign-in */}
            {showBiometricButton && (
              <button
                type="button"
                onClick={() => triggerBiometric()}
                disabled={biometryPending || loginMutation.isPending}
                data-testid="button-biometric-login"
                className="w-full h-11 rounded-lg font-semibold text-sm flex items-center justify-center gap-2.5 disabled:opacity-60 transition-opacity border"
                style={{
                  background: "rgba(201,168,76,0.08)",
                  borderColor: `${GOLD}44`,
                  color: GOLD_LIGHT,
                }}
              >
                <BiometricIcon className="h-5 w-5" />
                {biometryPending ? "Verifying…" : `Sign in with ${biometricLabel}`}
              </button>
            )}

            {/* Form */}
            <form onSubmit={handleLogin} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="username" className="text-foreground">Username</Label>
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
                <Label htmlFor="password" className="text-foreground">Password</Label>
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
                  background: BTN_BG,
                  boxShadow: BTN_SHADOW,
                  transition: "opacity 0.15s, transform 0.1s",
                }}
              >
                {loginMutation.isPending ? "Signing in…" : "Sign In"}
              </button>

              {hasSavedPasskey && passkeySupported && (
                <button
                  type="button"
                  onClick={handlePasskeyLogin}
                  disabled={passKeyPending || loginMutation.isPending}
                  data-testid="button-passkey-login"
                  className="w-full flex items-center justify-center gap-2 text-xs font-medium py-1.5 rounded-lg disabled:opacity-50 transition-opacity border"
                  style={{ color: GOLD, background: "rgba(201,168,76,0.06)", borderColor: `${GOLD}28` }}
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  {passKeyPending ? "Verifying…" : "Sign in with saved passkey"}
                </button>
              )}
            </form>

            <p className="text-center text-[0.67rem] text-muted-foreground pt-1">
              HMD International Group &mdash; ERP &amp; POS Platform
            </p>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════
          PASSKEY REGISTER PROMPT (web only)
      ══════════════════════════════════════════ */}
      {showPasskeyRegister && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-6 sm:pb-0"
          style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)" }}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-6 space-y-5 relative"
            style={{
              background: "rgba(14,14,22,0.97)",
              border: `1px solid rgba(201,168,76,0.28)`,
              boxShadow: "0 24px 64px rgba(0,0,0,0.70)",
            }}
          >
            <button
              className="absolute top-4 right-4 text-muted-foreground opacity-60 hover:opacity-100 transition-opacity"
              onClick={handleSkipPasskey}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="flex flex-col items-center text-center gap-3 pt-1">
              <div className="flex h-14 w-14 items-center justify-center rounded-full"
                style={{ background: "rgba(201,168,76,0.12)", border: `1px solid rgba(201,168,76,0.28)` }}>
                <KeyRound className="h-7 w-7" style={{ color: GOLD_LIGHT }} />
              </div>
              <div>
                <p className="font-bold text-base" style={{ color: "#f0e6c8" }}>Save a Passkey?</p>
                <p className="text-xs mt-1" style={{ color: "rgba(201,168,76,0.50)" }}>
                  Sign in instantly next time using Face ID, Touch ID, or your device passkey — no password needed.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={handleRegisterPasskey}
                disabled={passkeyRegPending}
                data-testid="button-save-passkey"
                className="w-full h-11 rounded-xl font-bold text-sm text-black disabled:opacity-60"
                style={{ background: BTN_BG }}
              >
                {passkeyRegPending ? "Setting up…" : "Save Passkey"}
              </button>
              <button
                onClick={handleSkipPasskey}
                data-testid="button-skip-passkey"
                className="w-full h-10 rounded-xl font-semibold text-xs"
                style={{ color: "rgba(201,168,76,0.45)", background: "transparent" }}
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          BIOMETRIC OPT-IN PROMPT (native only)
      ══════════════════════════════════════════ */}
      {showBioPrompt && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-6 sm:pb-0"
          style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)" }}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-6 space-y-5 relative"
            style={{
              background: "rgba(14,14,22,0.97)",
              border: `1px solid rgba(201,168,76,0.28)`,
              boxShadow: "0 24px 64px rgba(0,0,0,0.70)",
            }}
          >
            <button
              className="absolute top-4 right-4 text-muted-foreground opacity-60 hover:opacity-100 transition-opacity"
              onClick={handleDeclineBiometrics}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="flex flex-col items-center text-center gap-3 pt-1">
              <div className="flex h-14 w-14 items-center justify-center rounded-full"
                style={{ background: "rgba(201,168,76,0.12)", border: `1px solid rgba(201,168,76,0.28)` }}>
                <BiometricIcon className="h-7 w-7" style={{ color: GOLD_LIGHT }} />
              </div>
              <div>
                <p className="font-bold text-base" style={{ color: "#f0e6c8" }}>Enable {biometricLabel}?</p>
                <p className="text-xs mt-1" style={{ color: "rgba(201,168,76,0.50)" }}>
                  Sign in instantly next time using {biometricLabel} instead of your password.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={handleEnableBiometrics}
                data-testid="button-enable-biometrics"
                className="w-full h-11 rounded-xl font-bold text-sm text-black"
                style={{ background: BTN_BG }}
              >
                Enable {biometricLabel}
              </button>
              <button
                onClick={handleDeclineBiometrics}
                data-testid="button-decline-biometrics"
                className="w-full h-10 rounded-xl font-semibold text-xs"
                style={{ color: "rgba(201,168,76,0.45)", background: "transparent" }}
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
