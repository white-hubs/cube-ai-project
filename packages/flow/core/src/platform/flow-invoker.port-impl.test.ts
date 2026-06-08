import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { FlowInvokerPort } from '@cube-ai/contracts';
import { projectContextAls } from '@cube-ai/server-shared';
import { FlowRepository } from '../db/sqlite';
import { FlowCrudService } from '../flows/flow-crud.service';
import { FlowLangflowSyncService } from '../flows/flow-langflow-sync.service';
import { FlowExecutionService } from '../flows/flow-execution.service';
import { FlowInvokerPortImpl } from '../platform/flow-platform-ports';
import { CUBE_FLOW_SCHEMA_VERSION } from '../contracts/cube-flow';

const stubConfig = {
  paths: { sqlitePath: '', langflowApiAllPath: '', componentCatalogPath: '' },
} as any;

function makeTmpRepo(): { repo: FlowRepository; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'cube-flow-invoker-'));
  mkdirSync(dir, { recursive: true });
  const repo = FlowRepository.open(join(dir, 'test.sqlite'));
  return { repo, dir };
}

describe('FlowInvokerPortImpl', () => {
  test('invoke runs flow in project context and returns sync envelope', async () => {
    const { repo, dir } = makeTmpRepo();
    try {
      const graph = {
        schemaVersion: CUBE_FLOW_SCHEMA_VERSION,
        nodes: [
          { id: 'n1', lfNodeId: 'n1', cubeType: 'cube.lf.ChatInput', x: 0, y: 0, width: 100, height: 50, config: {} },
          {
            id: 'n2',
            lfNodeId: 'n2',
            cubeType: 'cube.lf.OpenAIModel',
            x: 200,
            y: 0,
            width: 100,
            height: 50,
            config: { api_key: 'sk-test' },
          },
        ],
        edges: [{ id: 'e1', source: 'n1', target: 'n2', sourcePort: 'o:chat', targetPort: 'i:input_value' }],
      };
      repo.createFlow(
        'default',
        {
          id: 'invoke-flow-1',
          name: 'Invoke Flow',
          description: '',
          langflow_flow_id: null,
          binding_status: 'pending',
          cube_revision: 0,
          create_by: 'system',
          creator_id: null,
          creator_type: null,
          create_time: new Date().toISOString(),
          update_by: 'system',
          updater_id: null,
          updater_type: null,
          update_time: new Date().toISOString(),
          lf_snapshot_json: null,
        },
        JSON.stringify(graph),
      );

      const crud = new FlowCrudService(stubConfig, repo);
      const lfSync = new FlowLangflowSyncService(stubConfig, repo, crud);
      const execution = new FlowExecutionService(crud, lfSync);
      const port: FlowInvokerPort = new FlowInvokerPortImpl(execution);

      const originalEnv = process.env['EXP_USE_CUBE_FLOW_ENGINE'];
      delete process.env['EXP_USE_CUBE_FLOW_ENGINE'];

      try {
        await expect(
          port.invoke(
            { tenant: 0, flowId: 'invoke-flow-1', traceId: 'trace-1', variables: { input: 'hi' } },
            new AbortController().signal,
          ),
        ).rejects.toThrow();
      } finally {
        if (originalEnv !== undefined) process.env['EXP_USE_CUBE_FLOW_ENGINE'] = originalEnv;
      }

      await projectContextAls.run({ projectId: 'default', bypassProjectIsolation: false }, async () => {
        await expect(execution.run('invoke-flow-1', { input: 'hi', stream: false })).rejects.toThrow();
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
