CREATE TABLE IF NOT EXISTS usage_totals (
  user_id TEXT PRIMARY KEY,
  tokens INTEGER NOT NULL DEFAULT 0,
  days_active INTEGER NOT NULL DEFAULT 0,
  first_usage_date TEXT,
  app_version TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_usage_totals_tokens ON usage_totals(tokens);
