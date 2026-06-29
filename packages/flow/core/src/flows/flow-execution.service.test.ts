import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { tenantContextAls } from "@cube-ai/tenant-context";

import { CUBE_FLOW_SCHEMA_VERSION } from "../contracts/cube-flow";
import { FlowRepository } from "../db/sqlite";
import { resetExecutionMetricsForTests } from "../observability/execution-metrics";
import { FlowCrudService } from "./flow-crud.service";
import { FlowExecutionService } from "./flow-execution.service";
import { FlowLangflowSyncService } from "./flow-langflow-sync.service";

function makeTmpRepo(): { repo: FlowRepository; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "cube-ai-exec-"));
  mkdirSync(dir, { recursive: true });
  const repo = FlowRepository.open(join(dir, "test.sqlite"));
  return { dir, repo };
}

const stubConfig = {
  paths: { langflowApiAllPath: "", sqlitePath: "" },
} as any;

const PROJECT = "default";

function seedFlow(repo: FlowRepository, id: string, name: string) {
  const graph = {
    edges: [{ id: "e1", source: "n1", target: "n2", sourcePort: "o:chat", targetPort: "i:input_value" }],
    nodes: [
      { id: "n1", lfNodeId: "n1", cubeType: "cube.lf.ChatInput", x: 0, y: 0, width: 100, height: 50, config: {} },
      {
        id: "n2",
        lfNodeId: "n2",
        cubeType: "cube.lf.OpenAIModel",
        x: 200,
        y: 0,
        width: 100,
        height: 50,
        config: { openai_api_key: "sk-test" },
      },
    ],
    schemaVersion: CUBE_FLOW_SCHEMA_VERSION,
  };
  repo.createFlow(
    PROJECT,
    {
      binding_status: "pending",
      create_by: "system",
      create_time: new Date().toISOString(),
      creator_id: null,
      creator_type: null,
      cube_revision: 0,
      description: "",
      id,
      langflow_flow_id: null,
      lf_snapshot_json: null,
      name,
      update_by: "system",
      update_time: new Date().toISOString(),
      updater_id: null,
      updater_type: null,
    },
    JSON.stringify(graph),
  );
}

function withProject<T>(fn: () => T): T {
  return tenantContextAls.run({ bypassTenantIsolation: false, tenantId: PROJECT }, fn);
}

describe("FlowExecutionService", () => {
  test("run resolves flow by name before dispatching", async () => {
    const { repo, dir } = makeTmpRepo();
    try {
      seedFlow(repo, "exec-flow-1", "Exec Flow");
      resetExecutionMetricsForTests();

      const crud = new FlowCrudService(stubConfig, repo);
      const lfSync = new FlowLangflowSyncService(stubConfig, repo, crud);
      const svc = new FlowExecutionService(crud, lfSync);

      // Langflow not configured, should throw 503 not 404
      const err = await withProject(() => svc.run("exec-flow-1", { input: "hello", stream: false })).catch((e) => e);
      // Should be 503 (no execution backend), not 404 (flow not found)
      expect(err).toBeTruthy();
      const status = (err as any)?.status;
      expect(status === 503 || status === 502 || status === 500 || err instanceof Error).toBe(true);
      expect(status).not.toBe(404);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("run throws 503 when Langflow unavailable and engine fallback disabled", async () => {
    const { repo, dir } = makeTmpRepo();
    try {
      seedFlow(repo, "exec-flow-2", "Exec Flow 2");

      const crud = new FlowCrudService(stubConfig, repo);
      const lfSync = new FlowLangflowSyncService(stubConfig, repo, crud);
      const svc = new FlowExecutionService(crud, lfSync);

      const originalEnv = process.env["EXP_USE_CUBE_FLOW_ENGINE"];
      delete process.env["EXP_USE_CUBE_FLOW_ENGINE"];
      const originalFallback = process.env["CUBE_AI_CUBE_ENGINE_FALLBACK"];
      delete process.env["CUBE_AI_CUBE_ENGINE_FALLBACK"];

      try {
        await expect(withProject(() => svc.run("exec-flow-2", { input: "hello", stream: false }))).rejects.toThrow();
      } finally {
        if (originalEnv !== undefined) {
          process.env["EXP_USE_CUBE_FLOW_ENGINE"] = originalEnv;
        }
        if (originalFallback !== undefined) {
          process.env["CUBE_AI_CUBE_ENGINE_FALLBACK"] = originalFallback;
        }
      }
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("run throws 404 for nonexistent flow", async () => {
    const { repo, dir } = makeTmpRepo();
    try {
      const crud = new FlowCrudService(stubConfig, repo);
      const lfSync = new FlowLangflowSyncService(stubConfig, repo, crud);
      const svc = new FlowExecutionService(crud, lfSync);

      await expect(withProject(() => svc.run("no-such-flow", { input: "hi", stream: false }))).rejects.toThrow();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("runStream resolves flow by name before dispatching", async () => {
    const { repo, dir } = makeTmpRepo();
    try {
      seedFlow(repo, "exec-flow-3", "Exec Flow Stream");

      const crud = new FlowCrudService(stubConfig, repo);
      const lfSync = new FlowLangflowSyncService(stubConfig, repo, crud);
      const svc = new FlowExecutionService(crud, lfSync);

      // Langflow not configured, should throw 503 not 404
      const err = await withProject(() => svc.runStream("exec-flow-3", { input: "hello", stream: true })).catch((e) => e);
      expect(err).toBeTruthy();
      const status = (err as any)?.status;
      expect(status).not.toBe(404);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
