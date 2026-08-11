-- W4.2 — search feedback observability (F-08)
-- Write path stores per-call feedback; aggregation queries read this table + recall_count separately.

CREATE TABLE IF NOT EXISTS `search_feedback` (
  `id` VARCHAR(64) NOT NULL,
  `tenant_id` VARCHAR(64) NOT NULL,
  `trace_id` VARCHAR(128) NOT NULL COMMENT 'correlates with KnowledgeQueryRequest.traceId / search X-Trace-Id',
  `feedback_type` VARCHAR(32) NOT NULL COMMENT 'thumbs_up|thumbs_down|wrong_citation|missed_source',
  `query` TEXT NOT NULL,
  `hit_chunk_ids_json` JSON NULL COMMENT 'chunk ids returned/cited for this retrieval call',
  `comment` TEXT NULL,
  `create_by` VARCHAR(64) NOT NULL DEFAULT 'system',
  `creator_id` VARCHAR(64) NULL,
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_search_feedback_tenant_trace` (`tenant_id`, `trace_id`),
  KEY `idx_search_feedback_tenant_time` (`tenant_id`, `create_time`),
  KEY `idx_search_feedback_tenant_type` (`tenant_id`, `feedback_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
