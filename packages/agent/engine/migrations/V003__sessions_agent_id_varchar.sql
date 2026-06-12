-- =============================================================================
-- sessions.agent_id：BIGINT → VARCHAR，承载租户级 agent 前缀 id（ADR-0016）
-- =============================================================================
-- 租户级 agent id = `agt_` + SFID（非纯数字），系统级 agent 仍为 19 位 SFID。
-- 两者都要能作为 session 绑定的 agent 引用，故 agent_id 必须为字符串列。
--   - 向后兼容：既有 BIGINT 值按十进制字符串保留；读路径本就 String(agent_id)。
--   - 不改 authz.grants.subject_agent_id（AuthZ subject 维度，与此正交）。
-- =============================================================================

ALTER TABLE sessions
  MODIFY COLUMN agent_id VARCHAR(64) NOT NULL;
