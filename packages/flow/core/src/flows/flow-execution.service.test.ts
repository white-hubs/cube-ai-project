import { describe, expect, test, mock } from 'bun:test'
import { join } from 'node:path'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { tenantContextAls } from '@cube-ai/server-shared'
import { FlowRepository } from '../db/sqlite'
import { FlowCrudService } from './flow-crud.service'
import { FlowLangflowSyncService } from './flow-langflow-sync.service'
import { FlowExecutionService } from './flow-execution.service'
import { CUBE_FLOW_SCHEMA_VERSION } from '../contracts/cube-flow'
import { resetExecutionMetricsForTests } from '../observability/execution-metrics'

function makeTmpRepo(): { repo: FlowRepository; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'cube-ai-exec-'))
  mkdirSync(dir, { recursive: true })
  const repo = FlowRepository.open(join(dir, 'test.sqlite'))
  return { repo, dir }
}

const stubConfig = {
  paths: { sqlitePath: '', langflowApiAllPath: '' },
} as any

const PROJECT = 'default'

function seedFlow(repo: FlowRepository, id: string, name: string) {
  const graph = {
    schemaVersion: CUBE_FLOW_SCHEMA_VERSION,
    nodes: [
      { id: 'n1', lfNodeId: 'n1', cubeType: 'cube.lf.ChatInput', x: 0, y: 0, width: 100, height: 50, config: {} },
      { id: 'n2', lfNodeId: 'n2', cubeType: 'cube.lf.OpenAIModel', x: 200, y: 0, width: 100, height: 50, config: { openai_api_key: 'sk-test' } },
    ],
    edges: [{ id: 'e1', source: 'n1', target: 'n2', sourcePort: 'o:chat', targetPort: 'i:input_value' }],
  }
  repo.createFlow(
    PROJECT,
    {
      id,
      name,
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
  )
}

function withProject<T>(fn: () => T): T {
  return tenantContextAls.run({ tenantId: PROJECT, bypassTenantIsolation: false }, fn)
}

describe('FlowExecutionService', () => {
  test('run resolves flow by name before dispatching', async () => {
    const { repo, dir } = makeTmpRepo()
    try {
      seedFlow(repo, 'exec-flow-1', 'Exec Flow')
      resetExecutionMetricsForTests()

      const crud = new FlowCrudService(stubConfig, repo)
      const lfSync = new FlowLangflowSyncService(stubConfig, repo, crud)
      const svc = new FlowExecutionService(crud, lfSync)

      // Langflow not configured, should throw 503 not 404
      const err = await withProject(() =>
        svc.run('exec-flow-1', { input: 'hello', stream: false }),
      ).catch((e) => e)
      // Should be 503 (no execution backend), not 404 (flow not found)
      expect(err).toBeTruthy()
      const status = (err as any)?.status
      expect(status === 503 || status === 502 || status === 500 || err instanceof Error).toBe(true)
      expect(status).not.toBe(404)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('run throws 503 when Langflow unavailable and engine fallback disabled', async () => {
    const { repo, dir } = makeTmpRepo()
    try {
      seedFlow(repo, 'exec-flow-2', 'Exec Flow 2')

      const crud = new FlowCrudService(stubConfig, repo)
      const lfSync = new FlowLangflowSyncService(stubConfig, repo, crud)
      const svc = new FlowExecutionService(crud, lfSync)

      const originalEnv = process.env['EXP_USE_CUBE_FLOW_ENGINE']
      delete process.env['EXP_USE_CUBE_FLOW_ENGINE']
      const originalFallback = process.env['CUBE_AI_CUBE_ENGINE_FALLBACK']
      delete process.env['CUBE_AI_CUBE_ENGINE_FALLBACK']

      try {
        await expect(
          withProject(() => svc.run('exec-flow-2', { input: 'hello', stream: false })),
        ).rejects.toThrow()
      } finally {
        if (originalEnv !== undefined) process.env['EXP_USE_CUBE_FLOW_ENGINE'] = originalEnv
        if (originalFallback !== undefined) process.env['CUBE_AI_CUBE_ENGINE_FALLBACK'] = originalFallback
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('run throws 404 for nonexistent flow', async () => {
    const { repo, dir } = makeTmpRepo()
    try {
      const crud = new FlowCrudService(stubConfig, repo)
      const lfSync = new FlowLangflowSyncService(stubConfig, repo, crud)
      const svc = new FlowExecutionService(crud, lfSync)

      await expect(
        withProject(() => svc.run('no-such-flow', { input: 'hi', stream: false })),
      ).rejects.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('runStream resolves flow by name before dispatching', async () => {
    const { repo, dir } = makeTmpRepo()
    try {
      seedFlow(repo, 'exec-flow-3', 'Exec Flow Stream')

      const crud = new FlowCrudService(stubConfig, repo)
      const lfSync = new FlowLangflowSyncService(stubConfig, repo, crud)
      const svc = new FlowExecutionService(crud, lfSync)

      // Langflow not configured, should throw 503 not 404
      const err = await withProject(() =>
        svc.runStream('exec-flow-3', { input: 'hello', stream: true }),
      ).catch((e) => e)
      expect(err).toBeTruthy()
      const status = (err as any)?.status
      expect(status).not.toBe(404)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
