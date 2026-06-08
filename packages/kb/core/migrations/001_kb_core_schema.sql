-- kb-core DDL (inferred from ORM entities; M3.T8)
-- Collection/point-id compatibility: ai_server_documents, dense+sparse@1024, buildStableQdrantPointId(chunkId)

CREATE TABLE IF NOT EXISTS document_directory_record (
  id BIGINT NOT NULL PRIMARY KEY,
  project_id VARCHAR(64) NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  created_by VARCHAR(64) NULL,
  updated_by VARCHAR(64) NULL,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS document_record (
  id BIGINT NOT NULL PRIMARY KEY,
  directory_id BIGINT NOT NULL,
  project_id VARCHAR(64) NULL,
  file_name VARCHAR(512) NOT NULL,
  source_type VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  object_key VARCHAR(1024) NOT NULL,
  file_size BIGINT NULL,
  recall_count INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  created_by VARCHAR(64) NULL,
  updated_by VARCHAR(64) NULL,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  INDEX idx_document_directory (directory_id),
  INDEX idx_document_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS document_import_job (
  id BIGINT NOT NULL PRIMARY KEY,
  document_id BIGINT NOT NULL,
  project_id VARCHAR(64) NULL,
  status VARCHAR(32) NOT NULL,
  parse_status VARCHAR(32) NOT NULL,
  index_status VARCHAR(32) NOT NULL,
  error_message TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  created_by VARCHAR(64) NULL,
  updated_by VARCHAR(64) NULL,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  INDEX idx_import_job_document (document_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS document_chunk (
  id BIGINT NOT NULL PRIMARY KEY,
  chunk_id VARCHAR(128) NOT NULL,
  document_id BIGINT NOT NULL,
  chunk_index INT NOT NULL,
  project_id VARCHAR(64) NULL,
  source_type VARCHAR(64) NOT NULL,
  file_name VARCHAR(512) NOT NULL,
  text_content MEDIUMTEXT NOT NULL,
  embedding_text MEDIUMTEXT NOT NULL,
  section_id VARCHAR(256) NOT NULL,
  heading_path JSON NULL,
  page_no INT NULL,
  chunk_type VARCHAR(64) NOT NULL,
  order_in_section INT NOT NULL DEFAULT 0,
  caption_text TEXT NULL,
  picture_description TEXT NULL,
  sheet_name VARCHAR(256) NULL,
  table_id VARCHAR(256) NULL,
  row_start INT NULL,
  row_end INT NULL,
  headers_text TEXT NULL,
  keywords_text TEXT NULL,
  start_time VARCHAR(64) NULL,
  end_time VARCHAR(64) NULL,
  cue_index INT NULL,
  property_namespace VARCHAR(256) NULL,
  retrieval_profile VARCHAR(64) NULL,
  qdrant_point_id CHAR(36) NOT NULL,
  recall_count INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  created_by VARCHAR(64) NULL,
  updated_by VARCHAR(64) NULL,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uk_chunk_id (chunk_id),
  UNIQUE KEY uk_qdrant_point_id (qdrant_point_id),
  INDEX idx_chunk_document (document_id),
  INDEX idx_chunk_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Note: LIKE %% lexical search on keywords_text/headers_text/text_content — no prefix index benefit (M3 deviation log).
