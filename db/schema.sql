-- ─────────────────────────────────────────────────────────────
-- VAARBEWIJS DATABASE SCHEMA
-- ─────────────────────────────────────────────────────────────

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Bedrijven (toekomstig: B2B verkoop)
CREATE TABLE IF NOT EXISTS companies (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT UNIQUE,
  seats       INTEGER DEFAULT 10,
  plan        TEXT DEFAULT 'trial',        -- trial | basic | pro
  active      INTEGER DEFAULT 1,
  stripe_id   TEXT,
  notes       TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- Gebruikers
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT DEFAULT 'student',    -- admin | student | blocked
  company_id    TEXT REFERENCES companies(id),
  niveau        TEXT DEFAULT 'all',        -- be | vb1 | vb2 | algemeen | all
  language      TEXT DEFAULT 'nl',         -- nl | fr
  last_seen     TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

-- Sessies (wie zit er op, hoe lang)
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  started_at  TEXT DEFAULT (datetime('now')),
  ended_at    TEXT,
  duration_s  INTEGER DEFAULT 0,           -- seconden actief
  ip          TEXT,
  user_agent  TEXT
);

-- Voortgang per categorie
CREATE TABLE IF NOT EXISTS progress (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  category_id TEXT NOT NULL,               -- bijv. "1.1", "7.3"
  correct     INTEGER DEFAULT 0,
  total       INTEGER DEFAULT 0,
  last_answer TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, category_id)
);

-- Examenresultaten
CREATE TABLE IF NOT EXISTS exam_results (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  score      INTEGER NOT NULL,
  max        INTEGER NOT NULL,
  niveau     TEXT,
  sections   TEXT,                         -- JSON: {catName: {good, total}}
  taken_at   TEXT DEFAULT (datetime('now'))
);

-- Activiteitslog (login, logout, examen gestart, etc.)
CREATE TABLE IF NOT EXISTS activity_log (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users(id),
  action     TEXT NOT NULL,                -- login | logout | exam_start | exam_done | quiz_session
  data       TEXT,                         -- JSON extra info
  ip         TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Indexes voor snelle queries
CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_progress_user    ON progress(user_id);
CREATE INDEX IF NOT EXISTS idx_exam_user        ON exam_results(user_id);
CREATE INDEX IF NOT EXISTS idx_log_user         ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_log_created      ON activity_log(created_at);
CREATE INDEX IF NOT EXISTS idx_users_company    ON users(company_id);

-- Magic links voor uitnodigingen
CREATE TABLE IF NOT EXISTS invite_tokens (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  used       INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT DEFAULT (datetime('now', '+20 days'))
);

-- ─────────────────────────────────────────────────────────────
-- VEREENVOUDIGD LINK-SYSTEEM (vervangt email/wachtwoord)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS link_users (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  expires_at  TEXT NOT NULL DEFAULT (datetime('now', '+90 days')),
  blocked     INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS link_progress (
  code        TEXT PRIMARY KEY REFERENCES link_users(code) ON DELETE CASCADE,
  data        TEXT NOT NULL DEFAULT '{}',
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_link_expires ON link_users(expires_at);

CREATE TABLE IF NOT EXISTS link_referrals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_code TEXT NOT NULL REFERENCES link_users(code) ON DELETE CASCADE,
  friend_name  TEXT NOT NULL,
  friend_info  TEXT,
  created_at   TEXT DEFAULT (datetime('now'))
);
