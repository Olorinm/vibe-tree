CREATE TABLE IF NOT EXISTS social_profile_privacy (
  user_id TEXT PRIMARY KEY,
  profile_visibility TEXT NOT NULL DEFAULT 'relations',
  show_level INTEGER NOT NULL DEFAULT 1,
  show_token_total INTEGER NOT NULL DEFAULT 1,
  show_active_days INTEGER NOT NULL DEFAULT 1,
  show_achievements INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
