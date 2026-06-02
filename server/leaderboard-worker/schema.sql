CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  avatar_url TEXT,
  profile_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS auth_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS daily_usage (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  xp INTEGER NOT NULL,
  app_version TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, date),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS hourly_usage (
  user_id TEXT NOT NULL,
  hour_start_utc TEXT NOT NULL,
  tokens INTEGER NOT NULL,
  app_version TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, hour_start_utc),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tree_events (
  user_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  device_id TEXT,
  created_at TEXT NOT NULL,
  source TEXT NOT NULL,
  tokens INTEGER NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  app_version TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, event_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tree_achievements (
  user_id TEXT NOT NULL,
  achievement_id TEXT NOT NULL,
  unlocked_at TEXT NOT NULL,
  app_version TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, achievement_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tree_devices (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  alias TEXT,
  platform TEXT,
  first_seen_at TEXT NOT NULL,
  last_synced_at TEXT NOT NULL,
  app_version TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, device_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tree_device_stats (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  entry_count INTEGER NOT NULL,
  tokens INTEGER NOT NULL,
  last_event_updated_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, device_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tree_model_stats (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  date TEXT NOT NULL,
  source TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens INTEGER NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, device_id, date, source, model),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS usage_preferences (
  user_id TEXT NOT NULL,
  range TEXT NOT NULL,
  favorite_agent_label TEXT,
  favorite_agent_percent INTEGER,
  favorite_model TEXT,
  favorite_period TEXT,
  favorite_period_start INTEGER,
  favorite_period_end INTEGER,
  peak_tokens_per_minute INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, range),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sync_limits (
  user_id TEXT PRIMARY KEY,
  last_synced_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS usage_visibility (
  user_id TEXT PRIMARY KEY,
  public_global INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS usage_totals (
  user_id TEXT PRIMARY KEY,
  tokens INTEGER NOT NULL DEFAULT 0,
  days_active INTEGER NOT NULL DEFAULT 0,
  first_usage_date TEXT,
  app_version TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  type TEXT NOT NULL,
  path TEXT NOT NULL,
  method TEXT NOT NULL,
  status INTEGER,
  actor_id TEXT,
  ip_hash TEXT,
  country TEXT,
  user_agent TEXT,
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS social_friendships (
  user_low TEXT NOT NULL,
  user_high TEXT NOT NULL,
  requester_user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_low, user_high),
  FOREIGN KEY (user_low) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (user_high) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (requester_user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS social_groups (
  group_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  icon_emoji TEXT,
  visibility TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS social_group_members (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  share_usage INTEGER NOT NULL DEFAULT 1,
  joined_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY (group_id) REFERENCES social_groups(group_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS social_group_invites (
  invite_code_hash TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  max_uses INTEGER,
  uses INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (group_id) REFERENCES social_groups(group_id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS social_group_invite_redemptions (
  invite_code_hash TEXT NOT NULL,
  user_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (invite_code_hash, user_id),
  FOREIGN KEY (invite_code_hash) REFERENCES social_group_invites(invite_code_hash) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES social_groups(group_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS social_group_join_requests (
  request_id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  requester_user_id TEXT NOT NULL,
  invited_by_user_id TEXT,
  invite_code_hash TEXT,
  request_type TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_by_user_id TEXT,
  resolved_at TEXT,
  FOREIGN KEY (group_id) REFERENCES social_groups(group_id) ON DELETE CASCADE,
  FOREIGN KEY (requester_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (invited_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  FOREIGN KEY (invite_code_hash) REFERENCES social_group_invites(invite_code_hash) ON DELETE SET NULL,
  FOREIGN KEY (resolved_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL
);

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

CREATE INDEX IF NOT EXISTS idx_daily_usage_date ON daily_usage(date);
CREATE INDEX IF NOT EXISTS idx_daily_usage_user ON daily_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_hourly_usage_hour ON hourly_usage(hour_start_utc);
CREATE INDEX IF NOT EXISTS idx_hourly_usage_user ON hourly_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_tree_events_user_created ON tree_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tree_events_device ON tree_events(user_id, device_id);
CREATE INDEX IF NOT EXISTS idx_tree_events_user_updated ON tree_events(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_tree_achievements_user ON tree_achievements(user_id);
CREATE INDEX IF NOT EXISTS idx_tree_achievements_user_updated ON tree_achievements(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_tree_devices_user ON tree_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_tree_devices_user_updated ON tree_devices(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_tree_device_stats_user ON tree_device_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_tree_device_stats_user_updated ON tree_device_stats(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_tree_model_stats_user ON tree_model_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_tree_model_stats_device ON tree_model_stats(user_id, device_id);
CREATE INDEX IF NOT EXISTS idx_tree_model_stats_user_updated ON tree_model_stats(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_usage_preferences_user ON usage_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_totals_tokens ON usage_totals(tokens);
CREATE INDEX IF NOT EXISTS idx_auth_codes_expires ON auth_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_security_events_created ON security_events(created_at);
CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(type);
CREATE INDEX IF NOT EXISTS idx_social_friendships_requester ON social_friendships(requester_user_id);
CREATE INDEX IF NOT EXISTS idx_social_friendships_status ON social_friendships(status);
CREATE INDEX IF NOT EXISTS idx_social_friendships_user_high ON social_friendships(user_high);
CREATE INDEX IF NOT EXISTS idx_social_groups_owner ON social_groups(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_social_group_members_user ON social_group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_social_group_members_group_role ON social_group_members(group_id, role);
CREATE INDEX IF NOT EXISTS idx_social_group_invites_group ON social_group_invites(group_id);
CREATE INDEX IF NOT EXISTS idx_social_group_invites_creator ON social_group_invites(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_social_group_invites_expires ON social_group_invites(expires_at);
CREATE INDEX IF NOT EXISTS idx_social_group_invite_redemptions_user ON social_group_invite_redemptions(user_id);
CREATE INDEX IF NOT EXISTS idx_social_group_join_requests_group_status ON social_group_join_requests(group_id, status);
CREATE INDEX IF NOT EXISTS idx_social_group_join_requests_requester_status ON social_group_join_requests(requester_user_id, status);
CREATE INDEX IF NOT EXISTS idx_social_group_join_requests_inviter ON social_group_join_requests(invited_by_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_group_join_requests_pending_user ON social_group_join_requests(group_id, requester_user_id) WHERE status = 'pending';
