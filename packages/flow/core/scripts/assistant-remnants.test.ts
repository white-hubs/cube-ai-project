import { describe, expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const scriptsDir = import.meta.dir;

const ASSISTANT_SQL_PATTERNS = [
  /platform_assistant_sessions/iu,
  /platform_assistant_messages/iu,
  /assistant_proposals/iu,
  /assistant_audit_log/iu,
  /assistantHelpDocsPath/iu,
];

describe("flow-core migration scripts — no assistant toy remnants (ADR-0012 / M4.T3)", () => {
  test("SQL scripts omit assistant table migrations", async () => {
    const entries = await readdir(scriptsDir);
    const sqlFiles = entries.filter((name) => name.endsWith(".sql"));
    const violations: string[] = [];

    for (const file of sqlFiles) {
      const source = await readFile(path.join(scriptsDir, file), "utf8");
      for (const pattern of ASSISTANT_SQL_PATTERNS) {
        if (pattern.test(source)) {
          violations.push(`${file}: ${pattern.source}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
