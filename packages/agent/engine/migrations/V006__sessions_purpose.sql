-- =============================================================================
-- sessions.purpose：区分正常对话 (chat) 与智能体调试预览 (debug)
-- =============================================================================
-- debug 会话由创建页 POST /sessions { purpose: "debug" } 产生，
-- GET /sessions 缺省仅返回 purpose=chat，与正常对话历史隔离。
-- =============================================================================

ALTER TABLE sessions
  ADD COLUMN purpose VARCHAR(16) NOT NULL DEFAULT 'chat'
  COMMENT 'chat=正常对话; debug=智能体调试预览';

CREATE INDEX idx_sessions_owner_purpose_active
  ON sessions (tenant, user_id, purpose, last_active_time DESC, id DESC);
