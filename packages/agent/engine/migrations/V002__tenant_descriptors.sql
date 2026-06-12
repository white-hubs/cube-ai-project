-- =============================================================================
-- agent-engine — 租户级 descriptor 管理面持久层（ADR-0016 §2/§4）
-- =============================================================================
-- 双层权威：租户级 descriptor 唯一权威 = engine 域 MySQL（tenant 隔离），经管理面
-- API 写入；系统级 descriptor 仍住 descriptors/ 文件 + Nacos，互不遮蔽。
-- 标识：id = 类型前缀 + SFID（agt_/skl_/rul_），服务端生成、不可变。
-- 生命周期：draft/publish 两态 + append-only 版本历史（head 指针 + published 指针）。
-- =============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ─── tenant_descriptors（head 指针 + 元信息） ────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_descriptors (
  id                    VARCHAR(36)  NOT NULL COMMENT '前缀 id：agt_/skl_/rul_ + SFID',
  tenant                INT(10)      NOT NULL COMMENT '租户隔离主键（ADR-0012 addendum）',
  kind                  VARCHAR(16)  NOT NULL COMMENT 'agent | skill | rule',
  name                  VARCHAR(255) NOT NULL COMMENT '租户内唯一（UX 约束），不参与运行时解析',
  head_version_no       INT          NOT NULL DEFAULT 1 COMMENT '当前最新（草稿）版本号',
  published_version_no  INT          NULL COMMENT '已发布版本号；NULL = 尚未发布',
  status                VARCHAR(16)  NOT NULL DEFAULT 'draft' COMMENT 'draft | published',
  deleted               BIGINT(20)   NOT NULL DEFAULT 0 COMMENT '软删：0=活跃，否则删除时刻 epoch ms',
  create_by             VARCHAR(64)  NOT NULL,
  create_time           DATETIME(3)  NOT NULL,
  update_by             VARCHAR(64)  NOT NULL,
  update_time           DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  -- name 在 (tenant, kind) 内对活跃行唯一；软删行 deleted=ms 不冲突，可重建同名
  UNIQUE KEY uk_tenant_kind_name (tenant, kind, name, deleted),
  KEY idx_tenant_kind_deleted (tenant, kind, deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='租户级 descriptor head/元信息';

-- ─── tenant_descriptor_versions（append-only 版本历史） ──────────────────────
CREATE TABLE IF NOT EXISTS tenant_descriptor_versions (
  id              BIGINT(20)   NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  descriptor_id   VARCHAR(36)  NOT NULL COMMENT '引用 tenant_descriptors.id（无 FK）',
  tenant          INT(10)      NOT NULL COMMENT '租户（冗余）',
  version_no      INT          NOT NULL COMMENT 'descriptor 内单调递增版本号',
  content_json    JSON         NOT NULL COMMENT '该版本内容（按 kind schema）',
  create_by       VARCHAR(64)  NOT NULL,
  create_time     DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_descriptor_version (descriptor_id, version_no),
  KEY idx_tenant_descriptor (tenant, descriptor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='租户级 descriptor append-only 版本历史';
