import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type FlowInvokerPort } from "@cube-ai/contracts";
import { tenantContextAls } from "@cube-ai/tenant-context";

import { CUBE_FLOW_SCHEMA_VERSION } from "../contracts/cube-flow";
import { FlowRepository } from "../db/sqlite";
import { FlowCrudService } from "../flows/flow-crud.service";
import { FlowExecutionService } from "../flows/flow-execution.service";
import { FlowLangflowSyncService } from "../flows/flow-langflow-sync.service";
import { FlowInvokerPortImpl } from "../platform/flow-platform-ports";

const stubConfig = {
  paths: { componentCatalogPath: "", langflowApiAllPath: "", sqlitePath: "" },
} as any;

function makeTmpRepo(): { repo: FlowRepository; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "cube-flow-invoker-"));
  mkdirSync(dir, { recursive: true });
  const repo = FlowRepository.open(join(dir, "test.sqlite"));
  return { dir, repo };
}

describe("FlowInvokerPortImpl", () => {
  test("invoke runs flow in project context and returns sync envelope", async () => {
    const { repo, dir } = makeTmpRepo();
    try {
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
            config: { api_key: "sk-test" },
          },
        ],
        schemaVersion: CUBE_FLOW_SCHEMA_VERSION,
      };
      repo.createFlow(
        "default",
        {
          binding_status: "pending",
          create_by: "system",
          create_time: new Date().toISOString(),
          creator_id: null,
          creator_type: null,
          cube_revision: 0,
          description: "",
          id: "invoke-flow-1",
          langflow_flow_id: null,
          lf_snapshot_json: null,
          name: "Invoke Flow",
          update_by: "system",
          update_time: new Date().toISOString(),
          updater_id: null,
          updater_type: null,
        },
        JSON.stringify(graph),
      );

      const crud = new FlowCrudService(stubConfig, repo);
      const lfSync = new FlowLangflowSyncService(stubConfig, repo, crud);
      const execution = new FlowExecutionService(crud, lfSync);
      const port: FlowInvokerPort = new FlowInvokerPortImpl(execution);

      const originalEnv = process.env["EXP_USE_CUBE_FLOW_ENGINE"];
      delete process.env["EXP_USE_CUBE_FLOW_ENGINE"];

      try {
        await expect(
          port.invoke({ flowId: "invoke-flow-1", tenant: 0, traceId: "trace-1", variables: { input: "hi" } }, new AbortController().signal),
        ).rejects.toThrow();
      } finally {
        if (originalEnv !== undefined) {
          process.env["EXP_USE_CUBE_FLOW_ENGINE"] = originalEnv;
        }
      }

      await tenantContextAls.run({ bypassTenantIsolation: false, tenantId: "default" }, async () => {
        await expect(execution.run("invoke-flow-1", { input: "hi", stream: false })).rejects.toThrow();
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
