-- W3.4 — MySQL ngram FULLTEXT on document_chunk lexical main columns (Scheme A)
--
-- One-shot additive migration (Flyway-style V003). Re-run after success will fail if the
-- index already exists — treat as applied. MySQL versions vary on
-- `CREATE FULLTEXT INDEX IF NOT EXISTS`; this script uses plain ADD FULLTEXT INDEX.
--
-- Rollback:
--   ALTER TABLE `document_chunk` DROP INDEX `ft_document_chunk_lexical`;
--
-- Ops notes:
-- - ADD FULLTEXT on large InnoDB tables: evaluate ALGORITHM=INPLACE / lock impact before prod.
-- - `ngram_token_size` is a MySQL server setting (default 2). Do NOT change global/session
--   vars in this migration; configure at deploy/ops layer if a different size is required.
-- - Index column order must match MATCH(...) column lists in searchLexicalChunks FULLTEXT path.

ALTER TABLE `document_chunk`
  ADD FULLTEXT INDEX `ft_document_chunk_lexical` (
    `text_content`,
    `embedding_text`,
    `heading_path`,
    `keywords_text`,
    `headers_text`
  ) WITH PARSER ngram;
