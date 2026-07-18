CREATE TABLE IF NOT EXISTS "user_credential_versions" (
  "user_id" varchar PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "credential_version" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

INSERT INTO "user_credential_versions" ("user_id", "credential_version")
SELECT "id", 0 FROM "users"
ON CONFLICT ("user_id") DO NOTHING;
