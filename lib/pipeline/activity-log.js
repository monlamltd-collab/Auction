// lib/pipeline/activity-log.js — Log user/system activity events to Supabase
import { supabase } from '../supabase.js';

/**
 * Log an activity event to the activity_events table.
 *
 * @param {string} action - Event action name
 * @param {object} detail - Additional event detail (JSONB)
 * @param {string|null} email - User email (optional)
 * @param {string|null} ip - Request IP (optional)
 */
export async function logActivityEvent(action, detail = {}, email = null, ip = null) {
  try {
    await supabase.from('activity_events').insert({
      user_email: email || null,
      action,
      detail,
      ip: ip || null,
    });
  } catch (e) {
    console.warn('Activity log error:', e.message);
  }
}
