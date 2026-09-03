CREATE TABLE IF NOT EXISTS tree_usage_buckets (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  bucket_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  source TEXT NOT NULL,
  model TEXT,
  tokens INTEGER NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  event_count INTEGER NOT NULL DEFAULT 1,
  app_version TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, device_id, bucket_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tree_usage_buckets_user_started
  ON tree_usage_buckets(user_id, started_at);

CREATE INDEX IF NOT EXISTS idx_tree_usage_buckets_user_updated
  ON tree_usage_buckets(user_id, updated_at, device_id, bucket_id);

CREATE TABLE IF NOT EXISTS tree_usage_bucket_tombstones (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  bucket_id TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  PRIMARY KEY (user_id, device_id, bucket_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tree_usage_bucket_tombstones_user_deleted
  ON tree_usage_bucket_tombstones(user_id, deleted_at, device_id, bucket_id);

-- One bounded, one-time conversion keeps existing cloud trees visually intact.
-- New requests never scan tree_events again.
INSERT INTO tree_usage_buckets (
  user_id,
  device_id,
  bucket_id,
  started_at,
  source,
  model,
  tokens,
  input_tokens,
  output_tokens,
  cache_read_tokens,
  cache_write_tokens,
  event_count,
  app_version,
  updated_at
)
SELECT
  user_id,
  COALESCE(device_id, 'legacy-device'),
  'legacy-hour-' || strftime('%Y%m%d%H', created_at) || '-' || source,
  strftime('%Y-%m-%dT%H:00:00.000Z', created_at),
  source,
  NULL,
  COALESCE(SUM(tokens), 0),
  SUM(input_tokens),
  SUM(output_tokens),
  SUM(cache_read_tokens),
  SUM(cache_write_tokens),
  COUNT(*),
  MAX(app_version),
  MAX(updated_at)
FROM tree_events
GROUP BY user_id, COALESCE(device_id, 'legacy-device'), strftime('%Y-%m-%dT%H:00:00.000Z', created_at), source
ON CONFLICT(user_id, device_id, bucket_id) DO NOTHING;
