import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { HttpException } from '@dangao/bun-server'
import { projectContextAls } from '@cube-ai/server-shared'
import { FlowRepository } from '../db/sqlite'
import { FlowCrudService } from './flow-crud.service'
import { CUBE_FLOW_SCHEMA_VERSION } from '../contracts/cube-flow'

function makeTmpRepo(): { repo: FlowRepository; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'cube-ai-crud-'))
  mkdirSync(dir, { recursive: true })
  const repo = FlowRepository.open(join(dir, 'test.sqlite'))
  return { repo, dir }
}

function makeSvc(repo: FlowRepository): FlowCrudService {
  return new FlowCrudService(
    { paths: { sqlitePath: '', langflowApiAllPath: '' } } as any,
    repo,
  )
}

function withProject<T>(projectId: string, fn: () => T): T {
  return projectContextAls.run({ projectId, bypassProjectIsolation: false }, fn)
}

const PROJECT = 'default'

function seed(repo: FlowRepository, id: string, name: string) {
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
    JSON.stringify({ schemaVersion: CUBE_FLOW_SCHEMA_VERSION, nodes: [], edges: [] }),
  )
}

describe('FlowCrudService', () => {
  describe('resolveFlowId', () => {
    test('resolves by UUID', async () => {
      const { repo, dir } = makeTmpRepo()
      try {
        seed(repo, 'uuid-aaa', 'My Flow')
        const svc = makeSvc(repo)
        const id = await withProject(PROJECT, () => svc.resolveFlowId('uuid-aaa'))
        expect(id).toBe('uuid-aaa')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    test('resolves by exact name (case-insensitive)', async () => {
      const { repo, dir } = makeTmpRepo()
      try {
        seed(repo, 'uuid-bbb', 'My Unique Flow')
        const svc = makeSvc(repo)
        const id = await withProject(PROJECT, () => svc.resolveFlowId('my unique flow'))
        expect(id).toBe('uuid-bbb')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    test('throws 404 when flow not found', () => {
      const { repo, dir } = makeTmpRepo()
      try {
        const svc = makeSvc(repo)
        expect(() => withProject(PROJECT, () => svc.resolveFlowId('nonexistent'))).toThrow()
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    test('throws 400 on ambiguous name (duplicate names)', () => {
      const { repo, dir } = makeTmpRepo()
      try {
        seed(repo, 'uuid-c1', 'Duplicate Name')
        seed(repo, 'uuid-c2', 'Duplicate Name')
        const svc = makeSvc(repo)
        expect(() => withProject(PROJECT, () => svc.resolveFlowId('Duplicate Name'))).toThrow(
          /Ambiguous/,
        )
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    test('throws 400 on empty ref', () => {
      const { repo, dir } = makeTmpRepo()
      try {
        const svc = makeSvc(repo)
        expect(() => withProject(PROJECT, () => svc.resolveFlowId(''))).toThrow()
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  describe('assertDeveloperApiFlowScope', () => {
    test('passes when no scope restriction', async () => {
      const { repo, dir } = makeTmpRepo()
      try {
        const svc = makeSvc(repo)
        // No developerApiAls store → no restriction
        await expect(svc.assertDeveloperApiFlowScope('any-id')).resolves.toBeUndefined()
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  describe('list', () => {
    test('returns flows for given project', async () => {
      const { repo, dir } = makeTmpRepo()
      try {
        seed(repo, 'id-1', 'Flow A')
        seed(repo, 'id-2', 'Flow B')
        const svc = makeSvc(repo)
        const flows = await withProject(PROJECT, () => svc.list())
        expect(flows.length).toBe(2)
        expect(flows.map((f) => f.id).sort()).toEqual(['id-1', 'id-2'].sort())
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    test('does not return flows from other projects', async () => {
      const { repo, dir } = makeTmpRepo()
      try {
        seed(repo, 'id-x', 'Flow X')
        const svc = makeSvc(repo)
        const flows = await withProject('other-project', () => svc.list())
        expect(flows.length).toBe(0)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  describe('get', () => {
    test('returns flow with graph', async () => {
      const { repo, dir } = makeTmpRepo()
      try {
        seed(repo, 'id-g1', 'Graph Flow')
        const svc = makeSvc(repo)
        const flow = await withProject(PROJECT, () => svc.get('id-g1'))
        expect(flow.id).toBe('id-g1')
        expect(flow.name).toBe('Graph Flow')
        expect(flow.graph.schemaVersion).toBe(CUBE_FLOW_SCHEMA_VERSION)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    test('throws 404 for unknown flow', () => {
      const { repo, dir } = makeTmpRepo()
      try {
        const svc = makeSvc(repo)
        expect(() => withProject(PROJECT, () => svc.get('no-such-id'))).toThrow()
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  describe('delete', () => {
    test('deletes existing flow', async () => {
      const { repo, dir } = makeTmpRepo()
      try {
        seed(repo, 'id-del', 'To Delete')
        const svc = makeSvc(repo)
        const result = await withProject(PROJECT, () => svc.delete('id-del'))
        expect(result.deleted).toBe(true)
        expect((await withProject(PROJECT, () => svc.list())).length).toBe(0)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  describe('getFlowSummary', () => {
    test('returns node count and edge count', async () => {
      const { repo, dir } = makeTmpRepo()
      try {
        const graph = {
          schemaVersion: CUBE_FLOW_SCHEMA_VERSION,
          nodes: [
            { id: 'n1', lfNodeId: 'n1', cubeType: 'cube.lf.ChatInput', x: 0, y: 0, width: 100, height: 50, config: {} },
            { id: 'n2', lfNodeId: 'n2', cubeType: 'cube.lf.OpenAIModel', x: 200, y: 0, width: 100, height: 50, config: {} },
          ],
          edges: [{ id: 'e1', source: 'n1', target: 'n2', sourcePort: 'o:x', targetPort: 'i:y' }],
        }
        repo.createFlow(
          PROJECT,
          {
            id: 'id-summary',
            name: 'Summary Flow',
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
        const svc = makeSvc(repo)
        const summary = await withProject(PROJECT, () => svc.getFlowSummary('id-summary'))
        expect(summary.nodeCount).toBe(2)
        expect(summary.edgeCount).toBe(1)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })
})
