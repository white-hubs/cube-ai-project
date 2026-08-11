-- W3.1 — versioned document chunk generations.
-- Existing rows become the legacy active generation. Rebuilds write a staging
-- generation, validate both MySQL and Qdrant, then switch document_record in one update.

ALTER TABLE `document_record`
  ADD COLUMN `active_generation_id` VARCHAR(64) NOT NULL DEFAULT 'legacy'
    COMMENT 'active document_chunk/Qdrant generation' AFTER `embedding_model_code`,
  ADD COLUMN `active_generation_job_id` VARCHAR(64) NULL
    COMMENT 'latest import job allowed to activate a generation' AFTER `active_generation_id`;

ALTER TABLE `document_chunk`
  ADD COLUMN `generation_id` VARCHAR(64) NOT NULL DEFAULT 'legacy'
    COMMENT 'versioned rebuild generation' AFTER `document_id`,
  DROP INDEX `uk_document_chunk_chunk_id`,
  DROP INDEX `uk_document_chunk_qdrant_point_id`,
  ADD UNIQUE KEY `uk_document_chunk_generation_chunk` (`document_id`, `generation_id`, `chunk_id`),
  ADD UNIQUE KEY `uk_document_chunk_qdrant_point_id` (`qdrant_point_id`),
  ADD KEY `idx_document_chunk_active_generation` (`document_id`, `generation_id`, `deleted`);
