-- Migration: Add user_presence table for active users tracking
-- Run this on Render: psql $DATABASE_URL -f migrations/add_user_presence.sql

CREATE TABLE IF NOT EXISTS user_presence (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(255) NOT NULL,
    user_id VARCHAR NOT NULL,
    username TEXT NOT NULL,
    current_route TEXT NOT NULL DEFAULT '/',
    company_id INTEGER,
    company_name TEXT,
    role TEXT,
    last_seen TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_presence_session_unique ON user_presence(session_id);

-- Create index for quick cleanup of stale records
CREATE INDEX IF NOT EXISTS user_presence_last_seen_idx ON user_presence(last_seen);
