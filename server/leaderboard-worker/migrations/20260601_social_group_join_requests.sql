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

CREATE INDEX IF NOT EXISTS idx_social_group_join_requests_group_status ON social_group_join_requests(group_id, status);
CREATE INDEX IF NOT EXISTS idx_social_group_join_requests_requester_status ON social_group_join_requests(requester_user_id, status);
CREATE INDEX IF NOT EXISTS idx_social_group_join_requests_inviter ON social_group_join_requests(invited_by_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_group_join_requests_pending_user ON social_group_join_requests(group_id, requester_user_id) WHERE status = 'pending';
