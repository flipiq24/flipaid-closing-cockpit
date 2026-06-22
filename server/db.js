// PostgreSQL access + auth helpers for FlipAid.
// Tables (users, groups, properties, session, app_settings) are created in ensureSchema().
import pg from 'pg';
import crypto from 'crypto';
import { readFileSync } from 'fs';

const { Pool } = pg;

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Create every table the app needs if it isn't already present (idempotent).
export async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS groups (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS properties (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
      address TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Estimated',
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_opened_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_groups_user ON groups(user_id);
    CREATE INDEX IF NOT EXISTS idx_properties_user ON properties(user_id);
    CREATE INDEX IF NOT EXISTS idx_properties_group ON properties(group_id);
    CREATE TABLE IF NOT EXISTS session (
      sid varchar NOT NULL COLLATE "default" PRIMARY KEY,
      sess json NOT NULL,
      expire timestamp(6) NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session_expire ON session(expire);
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

// A stable session-signing secret lives in the DB (never committed, shared across instances).
// Generated once on first boot, then reused so sessions survive restarts and redeploys.
export async function getSessionSecret() {
  const sel = await pool.query(`SELECT value FROM app_settings WHERE key='session_secret'`);
  if (sel.rows.length) return sel.rows[0].value;
  const secret = crypto.randomBytes(48).toString('hex');
  await pool.query(
    `INSERT INTO app_settings(key, value) VALUES('session_secret', $1) ON CONFLICT (key) DO NOTHING`,
    [secret]
  );
  const again = await pool.query(`SELECT value FROM app_settings WHERE key='session_secret'`);
  return again.rows[0].value;
}

// scrypt password hashing (Node built-in — no extra dependency). Stored as "salt:hash".
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return salt + ':' + hash;
}
export function verifyPassword(pw, stored) {
  try {
    const [salt, hash] = String(stored).split(':');
    if (!salt || !hash) return false;
    const test = crypto.scryptSync(String(pw), salt, 64);
    const known = Buffer.from(hash, 'hex');
    return known.length === test.length && crypto.timingSafeEqual(known, test);
  } catch { return false; }
}

// The 4595 Bronson deal address, used to seed each new account's portfolio.
let BRONSON_ADDR = '4595 Bronson St, San Bernardino, CA 92407';
try {
  const j = JSON.parse(readFileSync(new URL('../data/ramona.json', import.meta.url)));
  if (j && j.deal && j.deal.address) BRONSON_ADDR = j.deal.address;
} catch { /* fall back to the literal above */ }

// Create the default group + seed the Bronson property for a freshly-signed-up user.
// Bronson's deal data lives in data/ramona.json (the shared template); the seeded row holds
// an empty override blob ({}), so the cockpit reproduces the golden IA numbers untouched.
export async function seedPortfolio(userId) {
  const g = await pool.query(
    `INSERT INTO groups(user_id, name) VALUES($1, $2) RETURNING id`,
    [userId, 'My Deals']
  );
  const groupId = g.rows[0].id;
  await pool.query(
    `INSERT INTO properties(user_id, group_id, address, status, data) VALUES($1, $2, $3, $4, '{}'::jsonb)`,
    [userId, groupId, BRONSON_ADDR, 'Estimated']
  );
  return groupId;
}
