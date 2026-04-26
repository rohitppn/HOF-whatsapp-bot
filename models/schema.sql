CREATE TABLE IF NOT EXISTS stores (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS hourly_sales (
  id SERIAL PRIMARY KEY,
  store_id INT REFERENCES stores(id),
  date DATE,
  hour_block TEXT,
  target NUMERIC,
  achieved NUMERIC,
  walk_ins INT
);

CREATE TABLE IF NOT EXISTS dsr_reports (
  id SERIAL PRIMARY KEY,
  store_id INT REFERENCES stores(id),
  date DATE,
  total_sales NUMERIC,
  total_bills INT,
  total_walkins INT,
  locked BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS fc_bills (
  id SERIAL PRIMARY KEY,
  store_id INT REFERENCES stores(id),
  date DATE,
  fc_name TEXT,
  bill_value NUMERIC,
  bill_type TEXT
);

CREATE TABLE IF NOT EXISTS grooming_logs (
  id SERIAL PRIMARY KEY,
  store_id INT REFERENCES stores(id),
  date DATE,
  status TEXT
);

CREATE TABLE IF NOT EXISTS opening_logs (
  id SERIAL PRIMARY KEY,
  store_id INT REFERENCES stores(id),
  date DATE,
  opening_time TIME,
  late_flag BOOLEAN
);

CREATE TABLE IF NOT EXISTS reporting_compliance (
  id SERIAL PRIMARY KEY,
  store_id INT REFERENCES stores(id),
  date DATE,
  hourly_submitted BOOLEAN,
  dsr_submitted BOOLEAN
);

CREATE TABLE IF NOT EXISTS group_messages (
  id SERIAL PRIMARY KEY,
  group_jid TEXT NOT NULL,
  sender_jid TEXT,
  sender_name TEXT,
  direction TEXT NOT NULL,
  message_type TEXT,
  text_content TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_group_messages_group_created
  ON group_messages (group_jid, created_at DESC);

CREATE TABLE IF NOT EXISTS group_knowledge (
  id SERIAL PRIMARY KEY,
  group_jid TEXT NOT NULL,
  store_name TEXT,
  kind TEXT NOT NULL,
  fact_text TEXT NOT NULL,
  source_message_id TEXT,
  observed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_group_knowledge_group_observed
  ON group_knowledge (group_jid, observed_at DESC);

CREATE TABLE IF NOT EXISTS wa_auth (
  key TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
