import { pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { users } from "./users";

export const userLanguagePreferences = pgTable("user_language_preferences", {
  userId: varchar("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  preferredLanguage: varchar("preferred_language", { length: 2 }).notNull().default("en"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type UserLanguagePreference = typeof userLanguagePreferences.$inferSelect;
export type InsertUserLanguagePreference = typeof userLanguagePreferences.$inferInsert;
