import { db } from "../db";
import { notifications, notificationRules, users } from "@shared/schema";
import { eq, and, gte, inArray } from "drizzle-orm";

export const NOTIFICATION_EVENT_TYPES = {
  LOADING_STARTED: "LOADING_STARTED",
  LOADING_FINALIZED: "LOADING_FINALIZED",
  INVOICE_PENDING: "INVOICE_PENDING",
  INVOICE_FINALIZED: "INVOICE_FINALIZED",
  INTERCOMPANY_REQUEST: "INTERCOMPANY_REQUEST",
} as const;

export type NotificationEventType = typeof NOTIFICATION_EVENT_TYPES[keyof typeof NOTIFICATION_EVENT_TYPES];

interface DispatchOptions {
  eventType: NotificationEventType;
  title: string;
  message: string;
  entityType?: string;
  entityId?: number;
  triggeredByUserId?: string | null;
  companyId?: number;
}

export async function dispatchNotification(opts: DispatchOptions): Promise<void> {
  try {
    const rules = await db
      .select({ recipientUserId: notificationRules.recipientUserId })
      .from(notificationRules)
      .where(
        and(
          eq(notificationRules.eventType, opts.eventType),
          eq(notificationRules.isEnabled, true),
        ),
      );

    if (rules.length === 0) return;

    const recipientIds = [...new Set(rules.map(r => r.recipientUserId))];

    // Only deliver to users that exist AND have active=true
    const activeUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          inArray(users.id, recipientIds),
          eq(users.active, true),
        ),
      );

    const activeSet = new Set(activeUsers.map(u => u.id));
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    for (const recipientUserId of recipientIds) {
      if (!activeSet.has(recipientUserId)) continue;

      // Deduplicate: skip if same user+event+entity already notified within 5 min
      if (opts.entityType && opts.entityId) {
        const recent = await db
          .select({ id: notifications.id })
          .from(notifications)
          .where(
            and(
              eq(notifications.recipientUserId, recipientUserId),
              eq(notifications.eventType, opts.eventType),
              eq(notifications.entityType, opts.entityType),
              eq(notifications.entityId, opts.entityId),
              gte(notifications.createdAt, fiveMinutesAgo),
            ),
          )
          .limit(1);
        if (recent.length > 0) continue;
      }

      await db.insert(notifications).values({
        recipientUserId,
        eventType: opts.eventType,
        title: opts.title,
        message: opts.message,
        entityType: opts.entityType ?? null,
        entityId: opts.entityId ?? null,
        triggeredByUserId: opts.triggeredByUserId ?? null,
        companyId: opts.companyId ?? null,
        isRead: false,
      });
    }
  } catch (err: any) {
    console.error("[NotificationService] Failed to dispatch notification:", err?.message);
  }
}
