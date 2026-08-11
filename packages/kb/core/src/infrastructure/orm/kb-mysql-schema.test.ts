import { describe, expect, test } from "bun:test";

import { KB_MYSQL_SCHEMA } from "./kb-mysql-schema";

function tableDdl(table: string): string {
  const match = KB_MYSQL_SCHEMA.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\) ENGINE=`, "u"));
  if (!match?.[1]) {
    throw new Error(`missing DDL for ${table}`);
  }
  return match[1];
}

describe("KB_MYSQL_SCHEMA", () => {
  test("fresh-install generation columns match the versioned-chunk migration", () => {
    const document = tableDdl("document_record");
    const chunk = tableDdl("document_chunk");
    const importJob = tableDdl("document_import_job");

    expect(document).toContain("active_generation_id VARCHAR(64) NOT NULL DEFAULT 'legacy'");
    expect(document).toContain("active_generation_job_id VARCHAR(64) NULL");
    expect(chunk).toContain("generation_id VARCHAR(64) NOT NULL DEFAULT 'legacy'");
    expect(chunk).toContain("uk_document_chunk_generation_chunk (document_id, generation_id, chunk_id)");
    expect(importJob).not.toContain("generation_id");
  });
});
