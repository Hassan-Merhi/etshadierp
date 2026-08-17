/**
 * factoryDocsUsersRoutes: FactoryUsersAccess endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { logger } from "../../../lib/logger";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import { users, companies, userCompanyRoles, factoryUserProfiles, factoryUserPageAccess } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";

export function registerFactoryUsersAccessRoutes(app: Express) {
  // ───────────────────────────────────────────────
  // Factory User Management
  // ───────────────────────────────────────────────

  app.get("/api/factory/users", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      const currentRole = req.session.currentRole;
      const globalRole = req.user?.role;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const isAllowed =
        ["Admin", "Owner", "Developer"].includes(currentRole) || ["Admin", "Developer"].includes(globalRole);
      if (!isAllowed) return res.status(403).json({ message: "Only Admin or Owner can manage users" });

      const allUsers = await db
        .select({
          id: users.id,
          username: users.username,
          active: users.active,
          createdAt: users.createdAt,
        })
        .from(users);

      // Collect user IDs that have the Developer role in ANY company.
      // Match the ERP user-list behaviour: Developer accounts are globally
      // invisible to non-developers, regardless of which company is active.
      const devRoles = await db
        .select({ userId: userCompanyRoles.userId })
        .from(userCompanyRoles)
        .where(eq(userCompanyRoles.role, "Developer"));
      const devUserIds = new Set(devRoles.map((r) => r.userId));
      const requesterIsDeveloper = currentRole === "Developer" || globalRole === "Developer";

      const visibleUsers = allUsers.filter((u) => requesterIsDeveloper || !devUserIds.has(u.id));

      const profiles = await db.select().from(factoryUserProfiles).where(eq(factoryUserProfiles.companyId, companyId));

      const access = await db
        .select()
        .from(factoryUserPageAccess)
        .where(eq(factoryUserPageAccess.companyId, companyId));

      const profileMap = new Map(profiles.map((p) => [p.userId, p]));
      const accessMap = new Map<string, string[]>();
      access.forEach((a) => {
        if (!accessMap.has(a.userId)) accessMap.set(a.userId, []);
        accessMap.get(a.userId)!.push(a.pageKey);
      });

      const result = visibleUsers.map((u) => {
        const profile = profileMap.get(u.id);
        return {
          ...u,
          displayName: profile?.displayName || null,
          hasErpAccess: profile?.hasErpAccess ?? true,
          hasFactoryAccess: profile?.hasFactoryAccess ?? true,
          hiddenCostFields: profile?.hiddenCostFields ?? [],
          hideAllCosts: profile?.hideAllCosts ?? false,
          pageAccess: accessMap.get(u.id) || [],
        };
      });

      res.json(result);
    } catch (error: unknown) {
      logger.error("Error fetching factory users:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.post("/api/factory/users", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      const currentRole = req.session.currentRole;
      const globalRole = req.user?.role;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const isAllowed = ["Admin", "Owner"].includes(currentRole) || ["Admin", "Developer"].includes(globalRole);
      if (!isAllowed) return res.status(403).json({ message: "Only Admin or Owner can manage users" });

      const { username, password, displayName, pageAccess, hasErpAccess, hasFactoryAccess } = req.body;

      if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
      }
      if (password.length < 4) {
        return res.status(400).json({ message: "Password must be at least 4 characters" });
      }

      const existing = await db.select().from(users).where(eq(users.username, username));
      if (existing.length > 0) {
        return res.status(400).json({ message: "Username already exists" });
      }

      await db.transaction(async (tx) => {
        const hashedPassword = await bcrypt.hash(password, 10);
        const [newUser] = await tx
          .insert(users)
          .values({
            username,
            password: hashedPassword,
            active: true,
          })
          .returning();

        await tx.insert(userCompanyRoles).values({
          userId: newUser.id,
          companyId,
          role: "User",
        });

        await tx.insert(factoryUserProfiles).values({
          companyId,
          userId: newUser.id,
          displayName: displayName || username,
          hasErpAccess: hasErpAccess ?? true,
          hasFactoryAccess: hasFactoryAccess ?? true,
        });

        if (Array.isArray(pageAccess) && pageAccess.length > 0) {
          await tx.insert(factoryUserPageAccess).values(
            pageAccess.map((pk: string) => ({
              companyId,
              userId: newUser.id,
              pageKey: pk,
            }))
          );
        }

        const { password: _, ...userWithoutPassword } = newUser;
        res.status(201).json({
          ...userWithoutPassword,
          displayName: displayName || username,
          hasErpAccess: hasErpAccess ?? true,
          hasFactoryAccess: hasFactoryAccess ?? true,
          pageAccess: pageAccess || [],
        });
      });
    } catch (error: unknown) {
      logger.error("Error creating factory user:", { error: error });
      res.status(400).json({ message: getErrorMessage(error) });
    }
  });

  app.put("/api/factory/users/:userId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      const currentRole = req.session.currentRole;
      const globalRole = req.user?.role;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const isAllowed = ["Admin", "Owner"].includes(currentRole) || ["Admin", "Developer"].includes(globalRole);
      if (!isAllowed) return res.status(403).json({ message: "Only Admin or Owner can manage users" });

      const { userId } = req.params;
      const {
        displayName,
        pageAccess,
        password,
        hasErpAccess,
        hasFactoryAccess,
        hiddenCostFields,
        hideAllCosts,
        username,
      } = req.body;

      await db.transaction(async (tx) => {
        const userUpdates: any = {};
        if (password && password.length >= 4) {
          userUpdates.password = await bcrypt.hash(password, 10);
        }
        if (username && username.trim()) {
          const existingWithUsername = await tx
            .select({ id: users.id })
            .from(users)
            .where(eq(users.username, username.trim()));
          if (existingWithUsername.length > 0 && existingWithUsername[0].id !== userId) {
            throw new Error("Username already taken");
          }
          userUpdates.username = username.trim();
        }
        if (Object.keys(userUpdates).length > 0) {
          await tx.update(users).set(userUpdates).where(eq(users.id, userId));
        }

        const profileUpdates: any = { updatedAt: new Date() };
        if (displayName !== undefined) profileUpdates.displayName = displayName;
        if (hasErpAccess !== undefined) profileUpdates.hasErpAccess = hasErpAccess;
        if (hasFactoryAccess !== undefined) profileUpdates.hasFactoryAccess = hasFactoryAccess;
        if (Array.isArray(hiddenCostFields)) profileUpdates.hiddenCostFields = hiddenCostFields;
        if (hideAllCosts !== undefined) profileUpdates.hideAllCosts = !!hideAllCosts;

        const existingProfile = await tx
          .select()
          .from(factoryUserProfiles)
          .where(and(eq(factoryUserProfiles.companyId, companyId), eq(factoryUserProfiles.userId, userId)));

        if (existingProfile.length > 0) {
          await tx
            .update(factoryUserProfiles)
            .set(profileUpdates)
            .where(and(eq(factoryUserProfiles.companyId, companyId), eq(factoryUserProfiles.userId, userId)));
        } else {
          await tx.insert(factoryUserProfiles).values({
            companyId,
            userId,
            displayName: displayName || "User",
            hasErpAccess: hasErpAccess ?? true,
            hasFactoryAccess: hasFactoryAccess ?? true,
            hiddenCostFields: Array.isArray(hiddenCostFields) ? hiddenCostFields : [],
            hideAllCosts: !!hideAllCosts,
          });
        }

        if (Array.isArray(pageAccess)) {
          await tx
            .delete(factoryUserPageAccess)
            .where(and(eq(factoryUserPageAccess.companyId, companyId), eq(factoryUserPageAccess.userId, userId)));

          if (pageAccess.length > 0) {
            await tx.insert(factoryUserPageAccess).values(
              pageAccess.map((pk: string) => ({
                companyId,
                userId,
                pageKey: pk,
              }))
            );
          }
        }
      });

      res.json({ message: "User updated" });
    } catch (error: unknown) {
      logger.error("Error updating factory user:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.delete("/api/factory/users/:userId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      const currentRole = req.session.currentRole;
      const globalRole = req.user?.role;
      const sessionUserId = req.session.userId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const isAllowed = ["Admin", "Owner"].includes(currentRole) || ["Admin", "Developer"].includes(globalRole);
      if (!isAllowed) return res.status(403).json({ message: "Only Admin or Owner can manage users" });
      const { userId } = req.params;
      if (userId === sessionUserId) {
        return res.status(400).json({ message: "You cannot delete your own account" });
      }
      await db.transaction(async (tx) => {
        await tx.delete(factoryUserPageAccess).where(eq(factoryUserPageAccess.userId, userId));
        await tx.delete(factoryUserProfiles).where(eq(factoryUserProfiles.userId, userId));
        await tx.delete(userCompanyRoles).where(eq(userCompanyRoles.userId, userId));
        await tx.delete(users).where(eq(users.id, userId));
      });
      res.json({ message: "User removed successfully" });
    } catch (error: unknown) {
      logger.error("Error deleting factory user:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.get("/api/factory/my-access", requireAuth, async (req: any, res: any) => {
    try {
      const userId = req.session.userId;
      const currentCompanyId = req.session.currentCompanyId;
      const pinnedFactoryId = req.session.factoryCompanyId;
      const cachedFactoryName = req.session.factoryCompanyName as string | undefined;
      const role = req.session.currentRole;

      // Fast-path: if the session already has the resolved factory company AND the role
      // is admin/owner/developer (full access, no per-user DB lookup needed), return
      // immediately without touching the database. This fires on every page navigation
      // (staleTime=30s), so eliminating the DB round-trip matters a lot.
      if (
        pinnedFactoryId &&
        cachedFactoryName &&
        userId &&
        (role === "Admin" || role === "Owner" || role === "Developer")
      ) {
        res.set("Cache-Control", "private, max-age=120");
        return res.json({
          fullAccess: true,
          pageKeys: [],
          hasErpAccess: true,
          hasFactoryAccess: true,
          hiddenCostFields: [],
          hideAllCosts: false,
          companyId: pinnedFactoryId,
          companyName: cachedFactoryName,
        });
      }

      // Resolve the factory company ID:
      // Priority 1: already-pinned factoryCompanyId — verify it is factory type
      // Priority 2: currentCompanyId if it is factory type
      // Priority 3: first active factory-type company in the DB
      // Priority 4: fall back to currentCompanyId (legacy / single-company setups)
      let companyId: number | null = null;
      let companyName: string = "";

      if (pinnedFactoryId) {
        const [pinned] = await db
          .select({ id: companies.id, name: companies.name, companyType: companies.companyType })
          .from(companies)
          .where(eq(companies.id, pinnedFactoryId));
        if (pinned?.companyType === "factory") {
          companyId = pinned.id;
          companyName = pinned.name;
        }
      }

      if (!companyId && currentCompanyId) {
        const [current] = await db
          .select({ id: companies.id, name: companies.name, companyType: companies.companyType })
          .from(companies)
          .where(eq(companies.id, currentCompanyId));
        if (current?.companyType === "factory") {
          companyId = current.id;
          companyName = current.name;
        }
      }

      if (!companyId) {
        const [factoryComp] = await db
          .select({ id: companies.id, name: companies.name })
          .from(companies)
          .where(and(eq(companies.companyType, "factory"), eq(companies.active, true)))
          .limit(1);
        if (factoryComp) {
          companyId = factoryComp.id;
          companyName = factoryComp.name;
        }
      }

      if (!companyId) {
        // Last resort: use currentCompanyId (single-company or legacy setups)
        companyId = currentCompanyId;
        if (currentCompanyId) {
          const [c] = await db
            .select({ name: companies.name })
            .from(companies)
            .where(eq(companies.id, currentCompanyId));
          companyName = c?.name ?? "";
        }
      }

      if (!companyId || !userId) return res.status(400).json({ message: "No company or user" });

      // Pin both the ID and name into the session — subsequent calls use the fast-path above.
      req.session.factoryCompanyId = companyId;
      req.session.factoryCompanyName = companyName;

      if (role === "Admin" || role === "Owner" || role === "Developer") {
        res.set("Cache-Control", "private, max-age=120");
        return res.json({
          fullAccess: true,
          pageKeys: [],
          hasErpAccess: true,
          hasFactoryAccess: true,
          hiddenCostFields: [],
          hideAllCosts: false,
          companyId,
          companyName,
        });
      }

      const [profile] = await db
        .select({
          hasErpAccess: factoryUserProfiles.hasErpAccess,
          hasFactoryAccess: factoryUserProfiles.hasFactoryAccess,
          hiddenCostFields: factoryUserProfiles.hiddenCostFields,
          hideAllCosts: factoryUserProfiles.hideAllCosts,
        })
        .from(factoryUserProfiles)
        .where(and(eq(factoryUserProfiles.companyId, companyId), eq(factoryUserProfiles.userId, userId)));

      const hasErpAccess = profile ? profile.hasErpAccess : true;
      const hasFactoryAccess = profile ? profile.hasFactoryAccess : true;
      const hideAllCosts = profile?.hideAllCosts ?? false;
      // When hideAllCosts is set, treat all cost field keys as hidden
      const ALL_COST_KEYS = [
        "inventory_avg_rate",
        "inventory_total_value",
        "inventory_sell_price",
        "inventory_sell_value",
        "bale_history_cost_per_kg",
        "bale_history_total_cost",
        "bales_list_cost_per_kg",
        "hide_proforma_price",
      ];
      const hiddenCostFields = hideAllCosts ? ALL_COST_KEYS : (profile?.hiddenCostFields ?? []);

      const access = await db
        .select({ pageKey: factoryUserPageAccess.pageKey })
        .from(factoryUserPageAccess)
        .where(and(eq(factoryUserPageAccess.companyId, companyId), eq(factoryUserPageAccess.userId, userId)));

      res.set("Cache-Control", "private, max-age=120");
      if (access.length === 0) {
        return res.json({
          fullAccess: true,
          pageKeys: [],
          hasErpAccess,
          hasFactoryAccess,
          hiddenCostFields,
          hideAllCosts,
          companyId,
          companyName,
        });
      }

      res.json({
        fullAccess: false,
        pageKeys: access.map((a) => a.pageKey),
        hasErpAccess,
        hasFactoryAccess,
        hiddenCostFields,
        hideAllCosts,
        companyId,
        companyName,
      });
    } catch (error: unknown) {
      logger.error("Error fetching my access:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
