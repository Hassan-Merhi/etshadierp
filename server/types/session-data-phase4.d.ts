import "express-session";

declare module "express-session" {
  interface SessionData {
    csrfToken?: string;
    role?: string;
    factoryRole?: string;
    currentCompanyName?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    loginAt?: string;
    name?: string;
    email?: string;
    passkeyChallenge?: string;
    user?: {
      role?: string;
    };
  }
}
