// lib/supabase.js — Supabase service-account client (singleton)
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

export const SUPABASE_URL = process.env.SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
export const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || '';
export const AUTH_ENABLED = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
