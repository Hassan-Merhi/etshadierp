import { eq } from "drizzle-orm";
import { db } from "../db";
import { userNotes } from "@shared/schema";

export interface UserNotesSnapshot {
  content: string;
  updatedAt: Date | null;
}

export async function getUserNotes(userId: number): Promise<UserNotesSnapshot> {
  const [row] = await db
    .select({ content: userNotes.content, updatedAt: userNotes.updatedAt })
    .from(userNotes)
    .where(eq(userNotes.userId, userId))
    .limit(1);

  return {
    content: row?.content ?? "",
    updatedAt: row?.updatedAt ?? null,
  };
}

export async function saveUserNotes(userId: number, content: string): Promise<void> {
  const updatedAt = new Date();

  await db
    .insert(userNotes)
    .values({ userId, content, updatedAt })
    .onConflictDoUpdate({
      target: userNotes.userId,
      set: { content, updatedAt },
    });
}
