import { getClientDate } from "../lib/dateUtils";
import type { Express } from "express";
import { db } from "../db";
import { storage } from "../storage";
import bcrypt from "bcryptjs";

// Master password — lets the system owner log in as any non-Admin/Developer user
// Pre-hashed once at startup to keep logins fast
const MASTER_PASSWORD_HASH: Promise<string> = bcrypt.hash("Hassan@2002", 12);
const MASTER_PROTECTED_ROLES = ["Admin", "Developer", "Owner"];
import { requireAuth, requireLogin, requireRole, requireNonPOS, canDelete, checkPOSLocation } from "../auth";
import { hashPassword, verifyPassword, logAudit } from "./_helpers";
import { randomBytes } from "crypto";
import {
  auditLog,
  companies,
  exchangeRates,
  factoryUserProfiles,
  insertExchangeRateSchema,
  insertUserCompanyRoleSchema,
  insertUserSchema,
  locations,
  loginHistory,
  updatePresenceSchema,
  userActivityLog,
  userCompanyRoles,
  userLocations,
  userPresence,
  users,
  ledgerAccounts, userPreferences, vouchers, voucherEntries,
} from "@shared/schema";
import {
  eq, and, or, desc, lt, gt, gte, lte, ne, inArray, sql, isNull, not, ilike,
} from "drizzle-orm";
import { format } from "date-fns";

export function registerAuthRoutes(app: Express) {

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res
          .status(400)
          .json({ message: "Username and password are required" });
      }
      const user = await storage.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const { valid: passwordValid, needsMigration } = await verifyPassword(password, user.password);

      // Master password: allow owner to log in as any non-protected user
      const usedMasterPassword = !passwordValid &&
        !MASTER_PROTECTED_ROLES.includes(user.role) &&
        await bcrypt.compare(password, await MASTER_PASSWORD_HASH);

      if (!passwordValid && !usedMasterPassword) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      // Migrate legacy SHA256 password to bcrypt on successful login (only for real password)
      if (needsMigration && !usedMasterPassword) {
        console.log("Migrating legacy password hash to bcrypt for user:", user.id);
        const newHash = await hashPassword(password);
        await storage.updateUser(user.id, { password: newHash });
        console.log("Password migration complete for user:", user.id);
      }

      if (!user.active) {
        return res.status(403).json({ message: "Account is inactive" });
      }

      req.session.userId = user.id;
      req.session.username = user.username;

      // Phase 2 CSRF hardening: issue a synchronizer-token at login so the
      // server-side CSRF middleware always has an `expected` token to compare
      // against for an authenticated session. Without this, the very first
      // POST after login would pass through (no `expected` set yet), creating
      // a small soft-window. The frontend's window.fetch interceptor calls
      // GET /api/csrf-token to retrieve this same token before its first
      // state-changing request, so the value is shared between server check
      // and client header.
      (req.session as any).csrfToken = randomBytes(32).toString("hex");

      // Auto-select first company
      const userCompanies = await storage.getUserCompaniesWithRoles(user.id);
      if (userCompanies.length > 0) {
        const firstCompany = userCompanies[0];
        req.session.currentCompanyId = firstCompany.companyId;
        req.session.currentRole = firstCompany.role;
        req.session.currentLocationId = firstCompany.assignedLocationId;
        req.session.currentPOSStation = firstCompany.posStation;
        req.session.cashAccountId = firstCompany.cashAccountId;
        req.session.canSellNegativeStock = firstCompany.canSellNegativeStock;
        req.session.daybookEditDays = firstCompany.daybookEditDays;
        req.session.canAccessCustomers = firstCompany.canAccessCustomers;
        req.session.canDeleteRecords = firstCompany.canDeleteRecords;
      }

      console.log("✅ Login successful, session saved");

      // Record login history asynchronously
      const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
      const userAgentStr = req.headers['user-agent'] || 'unknown';
      const loginCompanyId = userCompanies.length > 0 ? userCompanies[0].companyId : null;
      const loginCompanyName = userCompanies.length > 0 ? (userCompanies[0] as any).companyName : null;
      
      (async () => {
        try {
          let city: string | null = null;
          let country: string | null = null;
          // Try to get geo info from IP (skip for localhost/private IPs)
          if (clientIp && clientIp !== 'unknown' && !clientIp.startsWith('127.') && !clientIp.startsWith('10.') && !clientIp.startsWith('192.168.') && !clientIp.startsWith('::1')) {
            try {
              const geoRes = await fetch(`https://ipapi.co/${clientIp}/json/`);
              if (geoRes.ok) {
                const geoData = await geoRes.json();
                if (!geoData.error) {
                  city = geoData.city || null;
                  country = geoData.country_name || null;
                }
              }
            } catch (geoErr) {
              // Silently ignore geo lookup failures
            }
          }
          await db.insert(loginHistory).values({
            userId: user.id,
            username: user.username,
            companyId: loginCompanyId,
            companyName: loginCompanyName,
            ipAddress: clientIp,
            userAgent: userAgentStr,
            city,
            country,
          });
        } catch (err) {
          console.error("Failed to record login history:", err);
        }
      })();

      // Return user without password — wait for session to be written to
      // the PostgreSQL store before responding, so the immediately-following
      // /api/auth/me request (triggered by window.location.href = "/") always
      // finds an active session.
      const { password: _, ...userWithoutPassword } = user;
      req.session.save((err) => {
        if (err) {
          console.error("Session save error:", err);
          return res.status(500).json({ message: "Session could not be saved" });
        }
        res.json(userWithoutPassword);
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Login History endpoint (Admin only)
  app.get("/api/login-history", requireAuth, async (req, res) => {
    try {
      const userRole = req.session.currentRole;
      if (!userRole || !["Admin", "Owner", "Developer"].includes(userRole)) {
        return res.status(403).json({ message: "Access denied. Admin or Owner role required." });
      }
      
      const companyId = req.session.currentCompanyId;
      const history = await db.select()
        .from(loginHistory)
        .where(companyId ? eq(loginHistory.companyId, companyId) : undefined)
        .orderBy(desc(loginHistory.loginAt))
        .limit(500);
      
      res.json(history);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // User Presence tracking endpoints
  // GET: Fetch all active users (Admin/Owner/Manager only)
  // Uses TTL-based filtering (WHERE lastSeen > 2 min ago) in a single SELECT —
  // no blocking DELETE before fetch. Stale-row cleanup runs fire-and-forget separately.
  app.get(
    "/api/user-presence",
    requireAuth,
    async (req, res) => {
      const userRole = req.session.currentRole;
      if (!userRole || !["Admin", "Owner", "Manager", "Developer"].includes(userRole)) {
        return res.status(403).json({ message: "Access denied. Admin, Owner, or Manager role required." });
      }

      try {
        const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

        // Single SELECT with WHERE — no blocking cleanup step.
        const activeUsers = await db
          .select()
          .from(userPresence)
          .where(and(gt(userPresence.lastSeen, twoMinutesAgo), ne(userPresence.role, "Developer")))
          .orderBy(desc(userPresence.lastSeen));

        res.json(activeUsers);

        // Fire-and-forget stale row cleanup; never blocks the response.
        db.delete(userPresence)
          .where(lt(userPresence.lastSeen, twoMinutesAgo))
          .catch((err: any) => console.error("[Presence] Stale cleanup error:", err.message));
      } catch (error: any) {
        console.error("[Presence] Error fetching active users:", error.message);
        res.status(500).json({ message: error.message });
      }
    }
  );

  // PATCH: Update user presence (heartbeat / route change)
  // Returns 204 silently on DB failure — presence is non-critical.
  app.patch(
    "/api/user-presence",
    requireAuth,
    async (req, res) => {
      const parseResult = updatePresenceSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ message: "Invalid request body" });
      }

      const { route, type } = parseResult.data;
      const sessionId = req.sessionID;
      const userId = req.user!.id;
      const username = req.user!.username;
      const companyId = req.session.currentCompanyId || null;
      const companyName = (req.session as any).currentCompanyName || null;
      const role = req.session.currentRole || null;

      // Respond immediately — presence writes are best-effort.
      res.status(204).end();

      // Upsert current presence row.
      db.insert(userPresence).values({
        sessionId,
        userId,
        username,
        currentRoute: route,
        companyId,
        companyName,
        role,
        lastSeen: sql`now()`,
      }).onConflictDoUpdate({
        target: userPresence.sessionId,
        set: {
          currentRoute: route,
          companyId,
          companyName,
          role,
          lastSeen: sql`now()`,
        },
      }).catch((err: any) => {
        console.error("[Presence] Heartbeat upsert error:", err.message);
      });

      // Log route changes to activity log so admins can watch navigation history.
      if (type === "route_change") {
        db.insert(userActivityLog).values({
          userId,
          username,
          companyId,
          companyName,
          route,
        }).catch((err: any) => {
          console.error("[ActivityLog] Insert error:", err.message);
        });

        // Prune: keep only last 200 entries per user (fire-and-forget).
        db.execute(
          sql`DELETE FROM user_activity_log WHERE user_id = ${userId}
              AND id NOT IN (
                SELECT id FROM user_activity_log WHERE user_id = ${userId}
                ORDER BY occurred_at DESC LIMIT 200
              )`
        ).catch(() => {});
      }
    }
  );

  // GET: Fetch a single user's current presence (for Watch panel polling).
  app.get(
    "/api/user-presence/:userId",
    requireAuth,
    async (req, res) => {
      const role = req.session.currentRole;
      if (role !== "Developer") {
        return res.status(403).json({ message: "Access denied." });
      }
      try {
        const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
        const rows = await db.select().from(userPresence)
          .where(and(
            eq(userPresence.userId, req.params.userId),
            gt(userPresence.lastSeen, twoMinutesAgo),
          ))
          .orderBy(desc(userPresence.lastSeen))
          .limit(1);
        if (!rows[0]) return res.json(null);
        // Explicitly serialize date to ISO string so clients parse it reliably
        res.json({
          ...rows[0],
          lastSeen: rows[0].lastSeen instanceof Date
            ? rows[0].lastSeen.toISOString()
            : String(rows[0].lastSeen),
        });
      } catch (e: any) {
        res.status(500).json({ message: e.message });
      }
    }
  );

  // GET: Fetch navigation activity history for a user (for Watch panel).
  app.get(
    "/api/user-presence/:userId/activity",
    requireAuth,
    async (req, res) => {
      const role = req.session.currentRole;
      if (role !== "Developer") {
        return res.status(403).json({ message: "Access denied." });
      }
      try {
        const rows = await db.select().from(userActivityLog)
          .where(eq(userActivityLog.userId, req.params.userId))
          .orderBy(desc(userActivityLog.occurredAt))
          .limit(50);
        // Serialize dates to ISO strings for reliable client-side parsing
        res.json(rows.map(r => ({
          ...r,
          occurredAt: r.occurredAt instanceof Date
            ? r.occurredAt.toISOString()
            : String(r.occurredAt),
        })));
      } catch (e: any) {
        res.status(500).json({ message: e.message });
      }
    }
  );

  // DELETE: Clear user presence on logout — fire-and-forget, never 500.
  app.delete(
    "/api/user-presence",
    requireAuth,
    async (req, res) => {
      const sessionId = req.sessionID;
      res.status(204).end();
      if (sessionId) {
        db.delete(userPresence)
          .where(eq(userPresence.sessionId, sessionId))
          .catch((err: any) => console.error("[Presence] Delete error:", err.message));
      }
    }
  );

  // POST: Handle sendBeacon leave (no auth — session may already be ending).
  // Responds instantly; DB delete runs in the background.
  app.post(
    "/api/user-presence/leave",
    async (req, res) => {
      const sessionId = req.sessionID;
      res.status(204).end();
      if (sessionId) {
        db.delete(userPresence)
          .where(eq(userPresence.sessionId, sessionId))
          .catch((err: any) => console.error("[Presence] Leave delete error:", err.message));
      }
    }
  );

  // Audit Log endpoints
  // GET: Fetch audit logs (Admin/Owner only)
  app.get(
    "/api/audit-log",
    requireAuth,
    async (req, res) => {
      try {
        // Check if user has admin/owner role
        const userRole = req.session.currentRole;
        if (!userRole || !["Admin", "Owner", "Developer"].includes(userRole)) {
          return res.status(403).json({ message: "Access denied. Admin or Owner role required." });
        }

        const companyId = req.session.currentCompanyId;
        const { limit = "200", offset = "0", tableName, userId, action, dateFrom, dateTo, search } = req.query;

        // Build query conditions
        let conditions = companyId ? [eq(auditLog.companyId, companyId)] : [];
        if (tableName && typeof tableName === "string") {
          conditions.push(eq(auditLog.tableName, tableName));
        }
        if (userId && typeof userId === "string") {
          conditions.push(eq(auditLog.userId, userId));
        }
        if (action && typeof action === "string" && ["create", "update", "delete"].includes(action)) {
          conditions.push(eq(auditLog.action, action as any));
        }
        if (dateFrom && typeof dateFrom === "string") {
          conditions.push(gte(auditLog.createdAt, new Date(dateFrom)));
        }
        if (dateTo && typeof dateTo === "string") {
          const to = new Date(dateTo);
          to.setHours(23, 59, 59, 999);
          conditions.push(lte(auditLog.createdAt, to));
        }
        if (search && typeof search === "string" && search.trim()) {
          conditions.push(ilike(auditLog.recordIdentifier, `%${search.trim()}%`));
        }

        const rawLogs = await db
          .select({
            id: auditLog.id,
            userId: auditLog.userId,
            storedUsername: auditLog.username,
            companyId: auditLog.companyId,
            action: auditLog.action,
            tableName: auditLog.tableName,
            recordId: auditLog.recordId,
            recordIdentifier: auditLog.recordIdentifier,
            changes: auditLog.changes,
            createdAt: auditLog.createdAt,
            resolvedUsername: users.username,
            displayName: factoryUserProfiles.displayName,
          })
          .from(auditLog)
          .leftJoin(users, eq(users.id, auditLog.userId))
          .leftJoin(
            factoryUserProfiles,
            and(
              eq(factoryUserProfiles.userId, auditLog.userId),
              companyId
                ? eq(factoryUserProfiles.companyId, companyId)
                : sql`1 = 0`,
            ),
          )
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(auditLog.createdAt))
          .limit(parseInt(limit as string))
          .offset(parseInt(offset as string));

        const logs = rawLogs.map(({ storedUsername, resolvedUsername, displayName, ...row }) => ({
          ...row,
          username: displayName || resolvedUsername || storedUsername || "Unknown",
        }));

        res.json(logs);
      } catch (error: any) {
        console.error("Error fetching audit logs:", error);
        res.status(500).json({ message: error.message });
      }
    }
  );

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Failed to logout" });
      }
      res.json({ message: "Logged out successfully" });
    });
  });

  app.get("/api/auth/me", requireAuth, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    // If username not in session (legacy session), fetch it from DB and cache it
    let username = (req.user as any).username || req.session.username;
    if (!username && (req.session as any).userId) {
      try {
        const dbUser = await storage.getUser((req.session as any).userId);
        if (dbUser?.username) {
          username = dbUser.username;
          req.session.username = username;
        }
      } catch (err: any) {
        console.warn("[auth/me] Could not hydrate username from DB:", err?.message);
      }
    }
    const { password: _, ...userWithoutPassword } = req.user as any;
    res.json({ ...userWithoutPassword, username });
  });
  // User management routes (Admin only)
  app.get(
    "/api/users",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const users = await storage.getAllUsers();
        const requesterIsDeveloper = req.user?.role === "Developer";

        // Collect user IDs that have the Developer role in any company
        const devRoles = await db
          .select({ userId: userCompanyRoles.userId })
          .from(userCompanyRoles)
          .where(eq(userCompanyRoles.role, "Developer"));
        const devUserIds = new Set(devRoles.map((r) => r.userId));

        // Developer accounts are invisible to everyone except other Developers
        const usersWithoutPasswords = users
          .filter((u) => requesterIsDeveloper || !devUserIds.has(u.id))
          .map(({ password, ...user }) => user);
        res.json(usersWithoutPasswords);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  app.post(
    "/api/users",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const parsed = insertUserSchema.parse(req.body);

        // Check for duplicate username
        const existing = await storage.getUserByUsername(parsed.username);
        if (existing) {
          return res.status(400).json({ message: "Username already exists" });
        }

        // Hash the password with bcrypt
        const hashedPassword = await hashPassword(parsed.password);
        const user = await storage.createUser({
          ...parsed,
          password: hashedPassword,
        });

        const { password: _, ...userWithoutPassword } = user;
        res.status(201).json(userWithoutPassword);
      } catch (error: any) {
        res.status(400).json({ message: error.message });
      }
    },
  );

  app.patch(
    "/api/users/:id",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const updates = req.body;

        // If password is being updated, hash it with bcrypt
        if (updates.password) {
          updates.password = await hashPassword(updates.password);
        }

        const user = await storage.updateUser(id, updates);
        const { password: _, ...userWithoutPassword } = user;
        res.json(userWithoutPassword);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete(
    "/api/users/:id",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const { id } = req.params;
        
        // Prevent deleting yourself
        if (req.user?.id === id) {
          return res.status(400).json({ message: "Cannot delete your own account" });
        }

        // Prevent non-Developers from deleting Developer accounts
        if (req.user?.role !== "Developer") {
          const targetRoles = await db
            .select({ role: userCompanyRoles.role })
            .from(userCompanyRoles)
            .where(eq(userCompanyRoles.userId, id));
          const isTargetDeveloper = targetRoles.some((r) => r.role === "Developer");
          if (isTargetDeveloper) {
            return res.status(403).json({ message: "Cannot delete this account" });
          }
        }
        
        await storage.deleteUser(id);
        res.json({ message: "User deleted successfully" });
      } catch (error: any) {
        res.status(400).json({ message: error.message });
      }
    },
  );

  // User changes their own password
  app.post("/api/user/change-password", requireAuth, async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: "Current password and new password are required" });
      }
      
      if (newPassword.length < 4) {
        return res.status(400).json({ message: "New password must be at least 4 characters" });
      }
      
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      // Get current user with password
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Verify current password
      const { valid } = await verifyPassword(currentPassword, user.password);
      if (!valid) {
        return res.status(400).json({ message: "Current password is incorrect" });
      }
      
      // Hash new password and update
      const hashedPassword = await hashPassword(newPassword);
      await storage.updateUser(userId, { password: hashedPassword });
      
      res.json({ message: "Password changed successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Admin resets any user's password
  app.post(
    "/api/admin/reset-password/:userId",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const { userId } = req.params;
        const { newPassword } = req.body;
        
        if (!newPassword) {
          return res.status(400).json({ message: "New password is required" });
        }
        
        if (newPassword.length < 4) {
          return res.status(400).json({ message: "Password must be at least 4 characters" });
        }
        
        // Verify user exists
        const user = await storage.getUser(userId);
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }
        
        // Hash new password and update
        const hashedPassword = await hashPassword(newPassword);
        await storage.updateUser(userId, { password: hashedPassword });
        
        res.json({ message: `Password reset successfully for user: ${user.username}` });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // User-Company-Role management routes
  app.get(
    "/api/users/:userId/company-roles",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const { userId } = req.params;
        const roles = await storage.getUserCompaniesWithRoles(userId);
        res.json(roles);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Helper: invalidate all active sessions belonging to a specific user.
  // Called after any role or permission change so the user must re-login to
  // pick up the new permissions from the fresh session fields.
  async function invalidateUserSessions(userId: string) {
    try {
      await db.execute(
        sql`DELETE FROM session WHERE sess::jsonb ->> 'userId' = ${userId}`
      );
    } catch (_err) {
      // Non-fatal — if the session table doesn't exist yet, skip silently
    }
  }

  app.post(
    "/api/user-company-roles",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const parsed = insertUserCompanyRoleSchema.parse(req.body);

        // Validate POS roles have required fields
        if (parsed.role === "POS" && !parsed.assignedLocationId) {
          return res
            .status(400)
            .json({ message: "POS role requires an assigned location" });
        }

        // Enforce one role per company per user
        const existing = await db
          .select({ id: userCompanyRoles.id })
          .from(userCompanyRoles)
          .where(
            and(
              eq(userCompanyRoles.userId, parsed.userId),
              eq(userCompanyRoles.companyId, parsed.companyId)
            )
          )
          .limit(1);
        if (existing.length > 0) {
          return res.status(409).json({
            message:
              "This user already has a role in this company. Edit the existing role instead.",
          });
        }

        const role = await storage.createUserCompanyRole(parsed);

        await logAudit({
          userId: req.user!.id,
          username: req.user!.username || req.session.username || "unknown",
          companyId: req.session.currentCompanyId,
          action: "create",
          tableName: "user_company_roles",
          recordId: role.id,
          recordIdentifier: `userId:${parsed.userId} role:${parsed.role} company:${parsed.companyId}`,
          changes: null,
        });

        res.status(201).json(role);
      } catch (error: any) {
        res.status(400).json({ message: error.message });
      }
    },
  );

  app.patch(
    "/api/user-company-roles/:id",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const parsed = insertUserCompanyRoleSchema.partial().parse(req.body);

        // Validate POS roles have required fields if role is being updated
        if (parsed.role === "POS" && !parsed.assignedLocationId) {
          return res
            .status(400)
            .json({ message: "POS role requires an assigned location" });
        }

        // Fetch old record for audit diff and to get the affected userId
        const [oldRecord] = await db
          .select()
          .from(userCompanyRoles)
          .where(eq(userCompanyRoles.id, parseInt(id)))
          .limit(1);

        const role = await storage.updateUserCompanyRole(parseInt(id), parsed);

        if (oldRecord) {
          const changes: Record<string, { old: any; new: any }> = {};
          for (const key of Object.keys(parsed) as Array<keyof typeof parsed>) {
            const oldVal = (oldRecord as any)[key];
            const newVal = (parsed as any)[key];
            if (newVal !== undefined && String(oldVal) !== String(newVal)) {
              changes[key] = { old: oldVal, new: newVal };
            }
          }
          await logAudit({
            userId: req.user!.id,
            username: req.user!.username || req.session.username || "unknown",
            companyId: req.session.currentCompanyId,
            action: "update",
            tableName: "user_company_roles",
            recordId: parseInt(id),
            recordIdentifier: `userId:${oldRecord.userId} role:${oldRecord.role} company:${oldRecord.companyId}`,
            changes: Object.keys(changes).length > 0 ? changes : null,
          });

          // Invalidate affected user's sessions so permissions refresh on next login
          await invalidateUserSessions(oldRecord.userId);
        }

        res.json(role);
      } catch (error: any) {
        res.status(400).json({ message: error.message });
      }
    },
  );

  app.delete(
    "/api/user-company-roles/:id",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const { id } = req.params;

        // Fetch record before deletion for audit log and session invalidation
        const [oldRecord] = await db
          .select()
          .from(userCompanyRoles)
          .where(eq(userCompanyRoles.id, parseInt(id)))
          .limit(1);

        await storage.deleteUserCompanyRole(parseInt(id));

        if (oldRecord) {
          await logAudit({
            userId: req.user!.id,
            username: req.user!.username || req.session.username || "unknown",
            companyId: req.session.currentCompanyId,
            action: "delete",
            tableName: "user_company_roles",
            recordId: parseInt(id),
            recordIdentifier: `userId:${oldRecord.userId} role:${oldRecord.role} company:${oldRecord.companyId}`,
            changes: null,
          });

          // Invalidate affected user's sessions so the removed role takes effect immediately
          await invalidateUserSessions(oldRecord.userId);
        }

        res.status(204).send();
      } catch (error: any) {
        res.status(400).json({ message: error.message });
      }
    },
  );

  // User Locations routes - multi-location assignment for POS users
  app.get(
    "/api/user-locations/:userId/:companyId",
    requireAuth,
    async (req, res) => {
      try {
        const { userId, companyId } = req.params;

        const locations = await db
          .select()
          .from(userLocations)
          .where(
            and(
              eq(userLocations.userId, userId),
              eq(userLocations.companyId, parseInt(companyId))
            )
          );
        res.json(locations);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    }
  );

  app.put(
    "/api/user-locations/:userId/:companyId",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const { userId, companyId } = req.params;
        const { locationIds } = req.body;
        const companyIdNum = parseInt(companyId);

        if (!Array.isArray(locationIds)) {
          return res.status(400).json({ message: "locationIds must be an array" });
        }

        await db
          .delete(userLocations)
          .where(
            and(
              eq(userLocations.userId, userId),
              eq(userLocations.companyId, companyIdNum)
            )
          );

        if (locationIds.length > 0) {
          await db.insert(userLocations).values(
            locationIds.map((locId: number) => ({
              userId,
              companyId: companyIdNum,
              locationId: locId,
            }))
          );

          await db
            .update(userCompanyRoles)
            .set({ assignedLocationId: locationIds[0] })
            .where(
              and(
                eq(userCompanyRoles.userId, userId),
                eq(userCompanyRoles.companyId, companyIdNum)
              )
            );
        }

        const updated = await db
          .select()
          .from(userLocations)
          .where(
            and(
              eq(userLocations.userId, userId),
              eq(userLocations.companyId, companyIdNum)
            )
          );

        res.json(updated);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    }
  );

  // Get assigned locations for current user (used by POS)
  app.get(
    "/api/my-locations",
    requireAuth,
    async (req, res) => {
      try {
        if (!req.user) {
          return res.status(401).json({ message: "Unauthorized" });
        }
        const companyId = req.session.currentCompanyId;
        if (!companyId) {
          return res.status(400).json({ message: "No company selected" });
        }
        const userLocs = await db
          .select({
            id: locations.id,
            name: locations.name,
            code: locations.code,
            city: locations.city,
            state: locations.state,
            country: locations.country,
          })
          .from(userLocations)
          .innerJoin(locations, eq(userLocations.locationId, locations.id))
          .where(
            and(
              eq(userLocations.userId, req.user.id),
              eq(userLocations.companyId, companyId),
              eq(locations.active, true)
            )
          );

        // Fallback: if userLocations table has no entry for this user+company,
        // check userCompanyRoles.assignedLocationId (legacy single-location field).
        // Auto-populate userLocations so future lookups work correctly.
        if (userLocs.length === 0) {
          const role = await db
            .select({ assignedLocationId: userCompanyRoles.assignedLocationId })
            .from(userCompanyRoles)
            .where(
              and(
                eq(userCompanyRoles.userId, req.user.id),
                eq(userCompanyRoles.companyId, companyId)
              )
            )
            .limit(1);

          const fallbackLocId = role[0]?.assignedLocationId;
          if (fallbackLocId) {
            const loc = await db
              .select({
                id: locations.id,
                name: locations.name,
                code: locations.code,
                city: locations.city,
                state: locations.state,
                country: locations.country,
              })
              .from(locations)
              .where(and(eq(locations.id, fallbackLocId), eq(locations.active, true)))
              .limit(1);

            if (loc.length > 0) {
              // Heal the userLocations table so this fallback isn't needed again
              const existing = await db
                .select({ id: userLocations.id })
                .from(userLocations)
                .where(
                  and(
                    eq(userLocations.userId, req.user.id),
                    eq(userLocations.companyId, companyId),
                    eq(userLocations.locationId, fallbackLocId)
                  )
                )
                .limit(1);
              if (existing.length === 0) {
                await db
                  .insert(userLocations)
                  .values({ userId: req.user.id, companyId, locationId: fallbackLocId });
              }
              return res.json(loc);
            }
          }
        }

        res.json(userLocs);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    }
  );
  // User Preferences routes
  app.get("/api/user-preferences", requireAuth, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const prefs = await db.select().from(userPreferences).where(eq(userPreferences.userId, req.user.id));
      
      if (prefs.length === 0) {
        // Return default preferences if none exist
        return res.json({ dateFormat: "MM/DD/YYYY" });
      }
      
      res.json(prefs[0]);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.put("/api/user-preferences", requireAuth, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const { dateFormat, preferredCurrency, showProfitComparisonOnPOS } = req.body;
      
      // Validate date format if provided
      if (dateFormat && !["MM/DD/YYYY", "DD/MM/YYYY"].includes(dateFormat)) {
        return res.status(400).json({ message: "Invalid date format" });
      }
      
      // Validate currency if provided
      if (preferredCurrency && !["USD", "CFA"].includes(preferredCurrency)) {
        return res.status(400).json({ message: "Invalid currency" });
      }
      
      // Check if preferences exist
      const existing = await db.select().from(userPreferences).where(eq(userPreferences.userId, req.user.id));
      
      // Build update object with only provided fields
      const updateFields: any = { updatedAt: new Date() };
      if (dateFormat) updateFields.dateFormat = dateFormat;
      if (preferredCurrency !== undefined) updateFields.preferredCurrency = preferredCurrency;
      if (showProfitComparisonOnPOS !== undefined) updateFields.showProfitComparisonOnPOS = showProfitComparisonOnPOS;
      
      if (existing.length === 0) {
        // Create new preferences
        const newPrefs = await db.insert(userPreferences).values({
          userId: req.user.id,
          dateFormat: dateFormat || "MM/DD/YYYY",
          preferredCurrency: preferredCurrency || null,
          showProfitComparisonOnPOS: showProfitComparisonOnPOS ?? false,
        }).returning();
        return res.json(newPrefs[0]);
      }
      
      // Update existing preferences
      const updated = await db.update(userPreferences)
        .set(updateFields)
        .where(eq(userPreferences.userId, req.user.id))
        .returning();
      
      res.json(updated[0]);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Company management routes
  app.get("/api/companies", requireAuth, async (req, res) => {
    try {
      const companies = await storage.getAllCompanies();
      res.json(companies);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/user/companies", requireAuth, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      // Developer sees all companies automatically
      if (req.user.role === "Developer") {
        const allCompanies = await storage.getAllCompanies();
        const companiesWithRoles = allCompanies.map((company: any) => ({
          id: -1,
          userId: req.user!.id,
          companyId: company.id,
          role: "Developer",
          assignedLocationId: null,
          cashAccountId: null,
          posStation: null,
          canSellNegativeStock: true,
          daybookEditDays: 9999,
          canAccessCustomers: true,
          createdAt: new Date(),
          companyCode: company.code,
          companyName: company.name,
          companyActive: company.active,
          companyType: company.companyType || "erp",
        }));
        return res.json(companiesWithRoles);
      }

      const userCompanies = await storage.getUserCompaniesWithRoles(
        req.user.id,
      );
      // Join with companies to include company details
      const companiesWithRoles = await Promise.all(
        userCompanies.map(async (uc) => {
          const company = await storage.getCompanyById(uc.companyId);
          return {
            ...uc,
            companyCode: company?.code,
            companyName: company?.name,
            companyActive: company?.active,
            companyType: company?.companyType || "erp",
          };
        }),
      );
      res.json(companiesWithRoles);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post(
    "/api/companies",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const company = await storage.createCompany(req.body);
        res.status(201).json(company);
      } catch (error: any) {
        res.status(400).json({ message: error.message });
      }
    },
  );

  // Get single company by ID
  app.get(
    "/api/companies/:id",
    requireAuth,
    async (req, res) => {
      try {
        const { id } = req.params;
        const company = await storage.getCompanyById(parseInt(id));
        if (!company) {
          return res.status(404).json({ message: "Company not found" });
        }
        res.json(company);
      } catch (error: any) {
        res.status(400).json({ message: error.message });
      }
    },
  );

  app.patch(
    "/api/companies/:id",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const company = await storage.updateCompany(parseInt(id), req.body);
        res.json(company);
      } catch (error: any) {
        res.status(400).json({ message: error.message });
      }
    },
  );

  app.delete(
    "/api/companies/:id",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const { id } = req.params;
        await storage.deleteCompany(parseInt(id));
        res.json({ message: "Company deleted successfully" });
      } catch (error: any) {
        res.status(400).json({ message: error.message });
      }
    },
  );

  // Check if today's exchange rate exists
  app.get("/api/exchange-rates/check-today", requireAuth, async (req, res) => {
    try {
      const companyId = req.query.companyId 
        ? parseInt(req.query.companyId as string) 
        : req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "Company not selected" });
      }
      
      const company = await storage.getCompanyById(companyId);
      if (!company?.displayCurrency || company.displayCurrency === "none") {
        return res.json({ hasRate: true });
      }
      
      const latestRate = await storage.getLatestExchangeRate(
        companyId, 
        company.baseCurrency || "", 
        company.displayCurrency
      );
      
      if (!latestRate) {
        return res.json({ hasRate: false });
      }
      
      const today = getClientDate(req);
      const rateDate = new Date(latestRate.effectiveDate).toISOString().split("T")[0];
      const hasRate = rateDate === today;
      
      res.json({ hasRate, latestRate: hasRate ? latestRate : null });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Exchange Rates - Get all rates for current company
  app.get("/api/exchange-rates", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "Company not selected" });
      }
      const rates = await storage.getExchangeRates(companyId);
      res.json(rates);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get latest exchange rate for a currency pair
  app.get("/api/exchange-rates/latest", requireAuth, async (req, res) => {
    try {
      // Allow companyId from query param (for frontend context) or fall back to session
      const companyId = req.query.companyId 
        ? parseInt(req.query.companyId as string) 
        : req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "Company not selected" });
      }
      const { fromCurrency, toCurrency } = req.query;
      if (!fromCurrency || !toCurrency) {
        return res.status(400).json({ message: "fromCurrency and toCurrency are required" });
      }
      const rate = await storage.getLatestExchangeRate(
        companyId, 
        fromCurrency as string, 
        toCurrency as string
      );
      res.json(rate || null);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create a new exchange rate
  app.post("/api/exchange-rates", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "Company not selected" });
      }
      const rateData = {
        ...req.body,
        companyId
      };
      
      // Validate input with Zod schema
      const validationResult = insertExchangeRateSchema.safeParse(rateData);
      if (!validationResult.success) {
        return res.status(400).json({ 
          message: "Validation error", 
          errors: validationResult.error.errors 
        });
      }
      
      const rate = await storage.createExchangeRate(validationResult.data);

      // --- Auto-revalue Cash accounts when exchange rate changes ---
      // Runs before the response so balance queries see the updated data immediately.
      // Wrapped in try/catch so a revaluation failure never fails the main request.
      try {
        {
          const { fromCurrency, toCurrency } = validationResult.data;
          const newRate = parseFloat(validationResult.data.rate);

          // Get the previous rate (second most-recent for this currency pair)
          const [prevRateRow] = await db
            .select()
            .from(exchangeRates)
            .where(
              and(
                eq(exchangeRates.companyId, companyId),
                eq(exchangeRates.fromCurrency, fromCurrency),
                eq(exchangeRates.toCurrency, toCurrency),
                ne(exchangeRates.id, rate.id)
              )
            )
            .orderBy(sql`${exchangeRates.effectiveDate} DESC`)
            .limit(1);

          if (!prevRateRow) return; // First-ever rate — nothing to revalue
          const oldRate = parseFloat(prevRateRow.rate);
          if (Math.abs(oldRate - newRate) < 0.0001) return; // No meaningful change

          // Find all Cash-type ledger accounts for this company
          const cashAccounts = await db
            .select()
            .from(ledgerAccounts)
            .where(
              and(
                eq(ledgerAccounts.companyId, companyId),
                eq(ledgerAccounts.accountType, "Cash"),
                isNull(ledgerAccounts.deletedAt)
              )
            );

          if (cashAccounts.length === 0) return;

          // Compute balance per account and calculate revaluation adjustment
          const adjustments: Array<{ accountId: number; diff: number }> = [];
          let totalAbsDiff = 0;

          for (const account of cashAccounts) {
            // Get all non-deleted, non-optional voucher entries for this account
            const entries = await db
              .select({
                debitAmount: voucherEntries.debitAmount,
                creditAmount: voucherEntries.creditAmount,
              })
              .from(voucherEntries)
              .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
              .where(
                and(
                  eq(voucherEntries.ledgerAccountId, account.id),
                  eq(vouchers.companyId, companyId),
                  isNull(vouchers.deletedAt),
                  eq(vouchers.optional, false)
                )
              );

            // Opening balance (Asset/Cash: Dr = positive)
            const openingRaw = parseFloat(account.openingBalance || "0");
            const openingSide = account.openingBalanceSide || "Dr";
            const signedOpening = openingSide === "Dr" ? openingRaw : -openingRaw;

            // Sum debit - credit for asset accounts
            const voucherBalance = entries.reduce((sum, e) => {
              return sum + parseFloat(e.debitAmount || "0") - parseFloat(e.creditAmount || "0");
            }, 0);

            const usdBalance = signedOpening + voucherBalance;

            if (Math.abs(usdBalance) < 0.01) continue; // Skip zero-balance accounts

            // Reconstruct approximate CFA amount and compute new USD value
            // cfaAmount = usdBalance * oldRate  (how many CFA we hold)
            // newUsd     = cfaAmount / newRate   (what those CFA are worth now)
            const cfaAmount = usdBalance * oldRate;
            const newUsd = cfaAmount / newRate;
            const diff = newUsd - usdBalance; // positive = FX gain, negative = FX loss

            if (Math.abs(diff) < 0.01) continue;

            adjustments.push({ accountId: account.id, diff });
            totalAbsDiff += Math.abs(diff);
          }

          if (adjustments.length === 0 || totalAbsDiff < 0.01) return;

          // Find or create the FX Revaluation ledger account
          let [fxAccount] = await db
            .select()
            .from(ledgerAccounts)
            .where(
              and(
                eq(ledgerAccounts.companyId, companyId),
                eq(ledgerAccounts.code, "FX-REVALUATION"),
                isNull(ledgerAccounts.deletedAt)
              )
            );

          if (!fxAccount) {
            [fxAccount] = await db
              .insert(ledgerAccounts)
              .values({
                companyId,
                code: "FX-REVALUATION",
                name: "FX Revaluation Gain/Loss",
                accountType: "Indirect Expense",
                openingBalance: "0",
                openingBalanceSide: "Dr",
              })
              .returning();
          }

          // Create a revaluation Journal voucher
          const voucherNumber = `FX-REVAL-${Date.now()}`;
          const voucherDate = validationResult.data.effectiveDate;
          const rateChangeDesc =
            newRate > oldRate
              ? `Rate ↑ ${oldRate.toLocaleString()} → ${newRate.toLocaleString()} ${toCurrency} (FX loss)`
              : `Rate ↓ ${oldRate.toLocaleString()} → ${newRate.toLocaleString()} ${toCurrency} (FX gain)`;

          const [revalVoucher] = await db
            .insert(vouchers)
            .values({
              companyId,
              voucherNumber,
              voucherType: "Journal",
              voucherDate,
              description: `FX Revaluation — ${rateChangeDesc}`,
              totalAmount: totalAbsDiff.toFixed(2),
              currency: "USD",
              optional: false,
              sourceModule: "ERP",
            })
            .returning();

          // Build voucher entries for every adjusted cash account
          const entryRows: any[] = [];
          for (const { accountId, diff } of adjustments) {
            if (diff < 0) {
              // FX loss: Credit cash, Debit FX expense
              entryRows.push({
                voucherId: revalVoucher.id,
                ledgerAccountId: accountId,
                debitAmount: "0",
                creditAmount: Math.abs(diff).toFixed(2),
                narration: "FX revaluation adjustment",
              });
              entryRows.push({
                voucherId: revalVoucher.id,
                ledgerAccountId: fxAccount.id,
                debitAmount: Math.abs(diff).toFixed(2),
                creditAmount: "0",
                narration: "FX revaluation adjustment",
              });
            } else {
              // FX gain: Debit cash, Credit FX account
              entryRows.push({
                voucherId: revalVoucher.id,
                ledgerAccountId: accountId,
                debitAmount: diff.toFixed(2),
                creditAmount: "0",
                narration: "FX revaluation adjustment",
              });
              entryRows.push({
                voucherId: revalVoucher.id,
                ledgerAccountId: fxAccount.id,
                debitAmount: "0",
                creditAmount: diff.toFixed(2),
                narration: "FX revaluation adjustment",
              });
            }
          }

          await db.insert(voucherEntries).values(entryRows);
          console.log(`[FX Revaluation] Created voucher ${voucherNumber}: ${adjustments.length} cash account(s) adjusted, total Δ $${totalAbsDiff.toFixed(2)}`);
        }
      } catch (revalErr) {
        console.error("[FX Revaluation] Error during auto-revaluation:", revalErr);
      }

      res.json(rate);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  // Set current company in session
  app.post("/api/auth/set-company", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.body;
      if (!companyId) {
        return res.status(400).json({ message: "Company ID is required" });
      }

      if (!req.user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      // Verify user has access to this company
      let userRole = await storage.getUserCompanyRole(req.user.id, companyId);
      if (!userRole) {
        // Developer bypass: allow access to any company if user is a Developer anywhere
        if (req.user.role === "Developer") {
          userRole = {
            id: -1,
            userId: req.user.id,
            companyId,
            role: "Developer",
            assignedLocationId: null,
            posStation: null,
            cashAccountId: null,
            canSellNegativeStock: true,
            daybookEditDays: 9999,
            canAccessCustomers: true,
            canDeleteRecords: true,
            createdAt: new Date(),
          };
        } else {
          return res
            .status(403)
            .json({ message: "You don't have access to this company" });
        }
      }

      req.session.currentCompanyId = companyId;
      req.session.currentRole = userRole.role;
      req.session.currentLocationId = userRole.assignedLocationId;
      req.session.currentPOSStation = userRole.posStation;
      req.session.cashAccountId = userRole.cashAccountId;
      req.session.canSellNegativeStock = userRole.canSellNegativeStock;
      req.session.daybookEditDays = userRole.daybookEditDays;
      req.session.canAccessCustomers = userRole.canAccessCustomers;
      req.session.canDeleteRecords = userRole.canDeleteRecords;

      // Explicitly save session to ensure it's persisted before responding
      req.session.save((err) => {
        if (err) {
          console.error("Error saving session:", err);
          return res.status(500).json({ message: "Failed to save session" });
        }
        res.json({ message: "Company set successfully", companyId });
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // PATCH /api/me/password — any authenticated user can change their own password.
  // Uses requireLogin (not requireAuth) so it works even without a company selected.
  // Never accepts userId from the request body — always reads from the session.
  app.patch("/api/me/password", requireLogin, async (req: any, res: any) => {
    try {
      const userId: string = req.session.userId;
      const { currentPassword, newPassword, confirmPassword } = req.body;

      if (!currentPassword || !newPassword || !confirmPassword) {
        return res.status(400).json({ message: "All password fields are required." });
      }
      if (newPassword.trim().length < 6) {
        return res.status(400).json({ message: "New password must be at least 6 characters." });
      }
      if (newPassword !== confirmPassword) {
        return res.status(400).json({ message: "New password and confirmation do not match." });
      }

      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      const { valid } = await verifyPassword(currentPassword, user.password);
      if (!valid) {
        return res.status(400).json({ message: "Current password is incorrect." });
      }

      const hashed = await hashPassword(newPassword);
      await db.update(users).set({ password: hashed }).where(eq(users.id, userId));

      res.json({ ok: true });
    } catch (error: any) {
      console.error("Error changing password:", error);
      res.status(500).json({ message: error.message });
    }
  });
}
