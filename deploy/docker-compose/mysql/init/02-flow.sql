USE cube_ai_center;

CREATE TABLE IF NOT EXISTS `flows` (
  `id` BIGINT(20) UNSIGNED NOT NULL,
  `tenant_id` VARCHAR(64) NOT NULL,
  `deleted` BIGINT NOT NULL DEFAULT 0,
  `create_by` VARCHAR(64) NOT NULL DEFAULT 'system',
  `creator_id` VARCHAR(64) NULL,
  `creator_type` VARCHAR(64) NULL,
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_by` VARCHAR(64) NOT NULL DEFAULT 'system',
  `updater_id` VARCHAR(64) NULL,
  `updater_type` VARCHAR(64) NULL,
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT NOT NULL,
  `langflow_flow_id` VARCHAR(128) NULL,
  `binding_status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `cube_revision` BIGINT NOT NULL DEFAULT 0,
  `lf_snapshot_json` LONGTEXT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_flows_tenant_deleted` (`tenant_id`, `deleted`),
  KEY `idx_flows_tenant_updated` (`tenant_id`, `deleted`, `update_time`),
  KEY `idx_flows_langflow` (`langflow_flow_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `flow_graphs` (
  `flow_id` VARCHAR(64) NOT NULL,
  `tenant_id` VARCHAR(64) NOT NULL,
  `deleted` BIGINT NOT NULL DEFAULT 0,
  `create_by` VARCHAR(64) NOT NULL DEFAULT 'system',
  `creator_id` VARCHAR(64) NULL,
  `creator_type` VARCHAR(64) NULL,
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_by` VARCHAR(64) NOT NULL DEFAULT 'system',
  `updater_id` VARCHAR(64) NULL,
  `updater_type` VARCHAR(64) NULL,
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `graph_json` LONGTEXT NOT NULL,
  PRIMARY KEY (`flow_id`),
  KEY `idx_flow_graphs_tenant_deleted` (`tenant_id`, `deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `playground_sessions` (
  `id` BIGINT(20) UNSIGNED NOT NULL,
  `tenant_id` VARCHAR(64) NOT NULL,
  `deleted` BIGINT NOT NULL DEFAULT 0,
  `create_by` VARCHAR(64) NOT NULL DEFAULT 'system',
  `creator_id` VARCHAR(64) NULL,
  `creator_type` VARCHAR(64) NULL,
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_by` VARCHAR(64) NOT NULL DEFAULT 'system',
  `updater_id` VARCHAR(64) NULL,
  `updater_type` VARCHAR(64) NULL,
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `flow_id` VARCHAR(64) NOT NULL,
  `session_id` VARCHAR(128) NULL,
  `title` VARCHAR(255) NULL,
  `user_id` VARCHAR(64) NULL,
  `is_default` TINYINT NOT NULL DEFAULT 0,
  `chat_history` LONGTEXT NULL,
  `last_message` TEXT NULL,
  `flow_default_scope` VARCHAR(64) GENERATED ALWAYS AS (
    CASE WHEN `is_default` = 1 AND `deleted` = 0 THEN `flow_id` ELSE NULL END
  ) STORED,
  PRIMARY KEY (`id`),
  KEY `idx_playground_sessions_tenant_deleted` (`tenant_id`, `deleted`),
  KEY `idx_playground_sessions_flow_updated` (`flow_id`, `deleted`, `update_time`),
  KEY `idx_playground_sessions_remote_session` (`session_id`),
  UNIQUE KEY `uk_playground_one_default_per_flow` (`flow_default_scope`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `playground_messages` (
  `id` BIGINT(20) UNSIGNED NOT NULL,
  `tenant_id` VARCHAR(64) NOT NULL,
  `deleted` BIGINT NOT NULL DEFAULT 0,
  `create_by` VARCHAR(64) NOT NULL DEFAULT 'system',
  `creator_id` VARCHAR(64) NULL,
  `creator_type` VARCHAR(64) NULL,
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_by` VARCHAR(64) NOT NULL DEFAULT 'system',
  `updater_id` VARCHAR(64) NULL,
  `updater_type` VARCHAR(64) NULL,
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `session_id` VARCHAR(64) NOT NULL,
  `role` VARCHAR(32) NOT NULL,
  `content` LONGTEXT NOT NULL,
  `seq` BIGINT NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_playground_messages_session_seq` (`session_id`, `deleted`, `seq`),
  KEY `idx_playground_messages_tenant_deleted` (`tenant_id`, `deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `custom_component_templates` (
  `id` BIGINT(20) UNSIGNED NOT NULL,
  `tenant_id` VARCHAR(64) NOT NULL,
  `deleted` BIGINT NOT NULL DEFAULT 0,
  `create_by` VARCHAR(64) NOT NULL DEFAULT 'system',
  `creator_id` VARCHAR(64) NULL,
  `creator_type` VARCHAR(64) NULL,
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_by` VARCHAR(64) NOT NULL DEFAULT 'system',
  `updater_id` VARCHAR(64) NULL,
  `updater_type` VARCHAR(64) NULL,
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `display_name` VARCHAR(255) NOT NULL,
  `dsl_json` LONGTEXT NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_custom_component_templates_tenant_deleted` (`tenant_id`, `deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `webhook_invocations` (
  `id` BIGINT(20) UNSIGNED NOT NULL,
  `tenant_id` VARCHAR(64) NOT NULL,
  `deleted` BIGINT NOT NULL DEFAULT 0,
  `create_by` VARCHAR(64) NOT NULL DEFAULT 'system',
  `creator_id` VARCHAR(64) NULL,
  `creator_type` VARCHAR(64) NULL,
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_by` VARCHAR(64) NOT NULL DEFAULT 'system',
  `updater_id` VARCHAR(64) NULL,
  `updater_type` VARCHAR(64) NULL,
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `flow_id` VARCHAR(64) NOT NULL,
  `source` VARCHAR(255) NULL,
  `payload_json` LONGTEXT NOT NULL,
  `status` VARCHAR(64) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_webhook_invocations_flow_deleted` (`flow_id`, `deleted`, `create_time`),
  KEY `idx_webhook_invocations_tenant_deleted` (`tenant_id`, `deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `app_kv` (
  `kv_key` VARCHAR(255) NOT NULL,
  `tenant_id` VARCHAR(64) NULL,
  `deleted` BIGINT NOT NULL DEFAULT 0,
  `create_by` VARCHAR(64) NOT NULL DEFAULT 'system',
  `creator_id` VARCHAR(64) NULL,
  `creator_type` VARCHAR(64) NULL,
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_by` VARCHAR(64) NOT NULL DEFAULT 'system',
  `updater_id` VARCHAR(64) NULL,
  `updater_type` VARCHAR(64) NULL,
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `value_json` LONGTEXT NOT NULL,
  PRIMARY KEY (`kv_key`),
  KEY `idx_app_kv_tenant_deleted` (`tenant_id`, `deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
