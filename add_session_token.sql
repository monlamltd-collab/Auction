-- Add session_token column to users table for token-based auth
-- Run this in the Supabase SQL Editor
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_token text;
CREATE INDEX IF NOT EXISTS idx_users_session_token ON users(session_token);
