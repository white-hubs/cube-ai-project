-- AuthZ `grants` 表 — `packages/agent/engine` GrantRepository / AuthzGateway 集成测用。
-- ref: docs/detailed-design/04-auth-and-authz/authorization-gateway.md §7.2

CREATE TABLE IF NOT EXISTS grants (
  id                        BIGINT(20)   NOT NULL COMMENT '主键 SFID',
  tenant                    INT(10)      NOT NULL,
  form                      VARCHAR(8)   NOT NULL,

  grantor_type              VARCHAR(16)  NOT NULL,
  grantor_user_id           VARCHAR(64)  NULL,

  subject_user_id           VARCHAR(64)  NULL,
  subject_user_group_id     VARCHAR(64)  NULL,
  subject_agent_id          BIGINT(20)   NULL,
  subject_session_id        BIGINT(20)   NULL,

  scope_tool_name           VARCHAR(128) NULL,
  scope_tool_pattern        VARCHAR(128) NULL,
  scope_action              VARCHAR(8)   NOT NULL DEFAULT 'ALLOW',
  args_constraint_json      JSON         NULL,

  expire_time               DATETIME(3)  NULL,
  revoke_time               DATETIME(3)  NULL,
  revoke_user_id            VARCHAR(64)  NULL,

  origin                    VARCHAR(24)  NOT NULL,
  note                      VARCHAR(255) NULL,

  deleted                   BIGINT(20)   NOT NULL DEFAULT 0,

  create_by                 VARCHAR(64)  NOT NULL,
  creator_id                VARCHAR(64)  NULL,
  creator_type              VARCHAR(16)  NULL,
  create_time               DATETIME(3)  NOT NULL,
  update_by                 VARCHAR(64)  NOT NULL,
  updater_id                VARCHAR(64)  NULL,
  updater_type              VARCHAR(16)  NULL,
  update_time               DATETIME(3)  NOT NULL,

  PRIMARY KEY (id),
  KEY idx_tenant_deleted             (tenant, deleted),
  KEY idx_tenant_subject_tool        (tenant, subject_user_id, scope_tool_name, deleted),
  KEY idx_tenant_subject_pattern     (tenant, subject_user_id, scope_tool_pattern, deleted),
  KEY idx_tenant_form_revoke_expire  (tenant, form, revoke_time, expire_time, deleted),
  KEY idx_tenant_grantor_create      (tenant, grantor_user_id, create_time, deleted),
  KEY idx_tenant_origin_create       (tenant, origin, create_time, deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='授权条目（test fixture）';
