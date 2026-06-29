import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FlowRepository } from "./sqlite";

describe("playground sqlite", () => {
  test("default session, messages, archive on graph", () => {
    const dir = mkdtempSync(join(tmpdir(), "cube-ai-pg-"));
    try {
      mkdirSync(dir, { recursive: true });
      const dbPath = join(dir, "t.sqlite");
      const repo = FlowRepository.open(dbPath);
      const projectId = "test-tenant";
      const flowId = crypto.randomUUID();
      const now = new Date().toISOString();
      repo.createFlow(
        projectId,
        {
          binding_status: "pending",
          create_by: "system",
          create_time: now,
          creator_id: null,
          creator_type: null,
          cube_revision: 0,
          description: "",
          id: flowId,
          langflow_flow_id: null,
          name: "F",
          update_by: "system",
          update_time: now,
          updater_id: null,
          updater_type: null,
        },
        '{"schemaVersion":1,"nodes":[],"edges":[]}',
      );

      const sid = repo.ensurePlaygroundDefaultSession(flowId);
      expect(repo.listPlaygroundSessions(flowId).length).toBe(1);
      repo.appendPlaygroundMessage(sid, "user", "hi");
      expect(repo.countPlaygroundMessages(sid)).toBe(1);

      repo.updateGraph(projectId, flowId, '{"schemaVersion":1,"nodes":[1],"edges":[]}');
      const after = repo.getFlow(flowId, projectId)!;
      repo.archiveDefaultPlaygroundSession(flowId, `对话 · rev ${after.cube_revision}`);

      const list = repo.listPlaygroundSessions(flowId);
      expect(list.length).toBe(2);
      expect(list.filter((s) => s.is_default === 1).length).toBe(1);
      const newDef = list.find((s) => s.is_default === 1)!;
      expect(repo.countPlaygroundMessages(newDef.id)).toBe(0);

      const old = list.find((s) => s.id === sid)!;
      expect(old.is_default).toBe(0);
      expect(repo.countPlaygroundMessages(sid)).toBe(1);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
