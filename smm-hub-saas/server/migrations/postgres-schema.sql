-- Postgres schema (equivalente ao SQLite). Rode com: psql $DATABASE_URL < postgres-schema.sql
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  uuid TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  balance_cents BIGINT NOT NULL DEFAULT 0,
  total_deposited_cents BIGINT NOT NULL DEFAULT 0,
  tier TEXT NOT NULL DEFAULT 'Standard',
  role TEXT NOT NULL DEFAULT 'user',
  api_key TEXT UNIQUE NOT NULL,
  ref_code TEXT UNIQUE,
  referred_by INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active',
  cashback_cents BIGINT DEFAULT 0,
  whatsapp TEXT,
  two_factor_secret TEXT,
  two_factor_enabled SMALLINT DEFAULT 0,
  email_verified SMALLINT DEFAULT 0,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_apikey ON users(api_key);
-- Demais tabelas: espelhar DDL do server/db.js e extended-schema*.js
