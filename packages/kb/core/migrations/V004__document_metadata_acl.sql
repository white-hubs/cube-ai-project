-- W4.1 — document metadata + ACL (dual-leg: MySQL lexical + Qdrant vector)
-- Legacy: NULL/empty acl_group_ids_json remains tenant-visible during compatibility period.

ALTER TABLE `document_record`
  ADD COLUMN `doc_type` VARCHAR(64) NULL
    COMMENT 'document type for metadata filter (e.g. standard)' AFTER `embedding_model_code`,
  ADD COLUMN `lang` VARCHAR(32) NULL
    COMMENT 'language code for metadata filter' AFTER `doc_type`,
  ADD COLUMN `tags_json` JSON NULL
    COMMENT 'string tags array for metadata filter (AND)' AFTER `lang`,
  ADD COLUMN `acl_group_ids_json` JSON NULL
    COMMENT 'ACL group ids; NULL/empty = tenant-visible (legacy)' AFTER `tags_json`,
  ADD COLUMN `metadata_json` JSON NULL
    COMMENT 'optional custom document metadata bag' AFTER `acl_group_ids_json`;

-- Denormalized onto chunk so searchLexicalChunks stays single-table (no join explosion).
ALTER TABLE `document_chunk`
  ADD COLUMN `doc_type` VARCHAR(64) NULL
    COMMENT 'denormalized from document_record.doc_type' AFTER `property_namespace`,
  ADD COLUMN `lang` VARCHAR(32) NULL
    COMMENT 'denormalized from document_record.lang' AFTER `doc_type`,
  ADD COLUMN `tags_json` JSON NULL
    COMMENT 'denormalized from document_record.tags_json' AFTER `lang`,
  ADD COLUMN `acl_group_ids_json` JSON NULL
    COMMENT 'denormalized from document_record.acl_group_ids_json' AFTER `tags_json`,
  ADD COLUMN `doc_created_at` DATETIME NULL
    COMMENT 'denormalized document create_time for payload/filter' AFTER `acl_group_ids_json`;
