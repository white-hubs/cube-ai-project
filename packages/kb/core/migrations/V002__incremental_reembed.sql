-- W3.5 — document checksum + chunk embedding fingerprint (incremental re-embed)

ALTER TABLE `document_record`
  ADD COLUMN `content_checksum` CHAR(64) NULL
    COMMENT 'sha256 of source file bytes; used for unchanged reindex skip' AFTER `text_chunk_mode`,
  ADD COLUMN `embedding_model_code` VARCHAR(128) NULL
    COMMENT 'embedding modelCode used for last successful index' AFTER `content_checksum`;

ALTER TABLE `document_chunk`
  ADD COLUMN `embedding_fingerprint` CHAR(64) NULL
    COMMENT 'sha256(embeddingText|modelCode|instructionProfile|algoVersion)' AFTER `embedding_text`;
