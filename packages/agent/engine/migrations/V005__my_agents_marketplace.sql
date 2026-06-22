-- =============================================================================
-- agent-engine — 我的智能体 / 库（商城）+ 技能 / 插件（ADR-0030）
-- =============================================================================
-- 在 ADR-0016 租户级 descriptor 管理面之上补齐作者归属、可变草稿、上架记录、
-- 用户货架，以及插件可用工具集。tenant 仍是唯一隔离主键；user 是 tenant 下子层。
-- =============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ─── tenant_descriptors：owner 维度 + 可变草稿工作副本 ────────────────────────
ALTER TABLE tenant_descriptors
  ADD COLUMN owner_user_id      VARCHAR(64) NULL COMMENT 'ADR-0030 作者 user；NULL=系统/迁移前遗留' AFTER name,
  ADD COLUMN draft_content_json JSON        NULL COMMENT 'ADR-0030 可变草稿工作副本（保存覆盖；发布才进 versions）' AFTER status,
  ADD COLUMN copied_from        VARCHAR(64) NULL COMMENT 'ADR-0030 copy provenance 口子（v1 不写）' AFTER draft_content_json,
  ADD KEY idx_tenant_kind_owner (tenant, kind, owner_user_id, deleted);

-- 防御性回填：fresh-start 环境为空；若已有数据，让当前 head 成为初始草稿。
UPDATE tenant_descriptors td
  JOIN tenant_descriptor_versions v
    ON v.descriptor_id = td.id AND v.version_no = td.head_version_no
  SET td.draft_content_json = v.content_json
  WHERE td.draft_content_json IS NULL;

UPDATE tenant_descriptors
  SET owner_user_id = create_by
  WHERE owner_user_id IS NULL;

-- ─── descriptor_listing：上架记录 / 共享版本指针 ──────────────────────────────
CREATE TABLE IF NOT EXISTS descriptor_listing (
  descriptor_id     VARCHAR(36) NOT NULL COMMENT '引用 tenant_descriptors.id（agent/skill）',
  tenant            INT(10)     NOT NULL,
  listed            TINYINT(1)  NOT NULL DEFAULT 1 COMMENT '1=在库可发现/可安装；0=已下架',
  shared_version_no INT         NOT NULL COMMENT '浮动 ref 跟随的版本；下架后冻结为最后值',
  publisher_user_id VARCHAR(64) NOT NULL COMMENT '上架者=owner',
  listed_time       DATETIME(3) NULL,
  unlisted_time     DATETIME(3) NULL,
  create_by         VARCHAR(64) NOT NULL,
  create_time       DATETIME(3) NOT NULL,
  update_by         VARCHAR(64) NOT NULL,
  update_time       DATETIME(3) NOT NULL,
  PRIMARY KEY (descriptor_id),
  KEY idx_tenant_listed (tenant, listed)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='ADR-0030 上架记录 + 共享版本指针';

-- ─── user_descriptor_shelf：我的智能体 / 我的技能 货架投影 ────────────────────
CREATE TABLE IF NOT EXISTS user_descriptor_shelf (
  id             VARCHAR(36) NOT NULL COMMENT 'she_ + SFID',
  tenant         INT(10)     NOT NULL,
  user_id        VARCHAR(64) NOT NULL,
  target_kind    VARCHAR(16) NOT NULL COMMENT 'agent | skill',
  target_id      VARCHAR(64) NOT NULL COMMENT 'agt_/skl_（租户）或裸 name（系统级）',
  source         VARCHAR(16) NOT NULL DEFAULT 'ref' COMMENT 'authored | ref | copy',
  pin_version_no INT         NULL     COMMENT 'NULL=浮动；否则钉版（source=ref）',
  enabled        TINYINT(1)  NOT NULL DEFAULT 1 COMMENT '用户级启用/禁用',
  deleted        BIGINT(20)  NOT NULL DEFAULT 0 COMMENT '移除=软删货架条目',
  create_by      VARCHAR(64) NOT NULL,
  create_time    DATETIME(3) NOT NULL,
  update_by      VARCHAR(64) NOT NULL,
  update_time    DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_target (tenant, user_id, target_id, deleted),
  KEY idx_tenant_user_kind (tenant, user_id, target_kind, deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='ADR-0030 我的智能体/我的技能 货架投影';

-- ─── user_available_tool：插件库安装 / 可用工具集 ──────────────────────────────
CREATE TABLE IF NOT EXISTS user_available_tool (
  id          VARCHAR(36)  NOT NULL COMMENT 'uat_ + SFID',
  tenant      INT(10)      NOT NULL,
  user_id     VARCHAR(64)  NOT NULL,
  tool_name   VARCHAR(255) NOT NULL COMMENT '系统/运维登记的工具名（裸 name）',
  enabled     TINYINT(1)   NOT NULL DEFAULT 1,
  deleted     BIGINT(20)   NOT NULL DEFAULT 0,
  create_by   VARCHAR(64)  NOT NULL,
  create_time DATETIME(3)  NOT NULL,
  update_by   VARCHAR(64)  NOT NULL,
  update_time DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_tool (tenant, user_id, tool_name, deleted),
  KEY idx_tenant_user (tenant, user_id, deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='ADR-0030 插件库安装/可用工具集';
