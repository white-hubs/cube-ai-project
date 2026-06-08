import { Injectable } from '@dangao/bun-server'
import type { CubeFlowGraph } from '../contracts/cube-flow'
import { FlowCrudService } from './flow-crud.service'
import { FlowLangflowSyncService } from './flow-langflow-sync.service'
import { FlowExecutionService } from './flow-execution.service'
import { FlowPlaygroundService } from './flow-playground.service'

export { FlowCrudService } from './flow-crud.service'
export { FlowLangflowSyncService } from './flow-langflow-sync.service'
export { FlowExecutionService } from './flow-execution.service'
export { FlowPlaygroundService } from './flow-playground.service'

/**
 * FlowsService — 门面（Facade）：聚合 4 个子 Service，保持现有调用方的 import 路径不变。
 * 新代码建议直接注入具体 Service（FlowCrudService 等）。
 */
@Injectable()
export class FlowsService {
  constructor(
    private readonly crud: FlowCrudService,
    private readonly lfSync: FlowLangflowSyncService,
    private readonly execution: FlowExecutionService,
    private readonly playground: FlowPlaygroundService,
  ) {}

  // ── CRUD ────────────────────────────────────────────────────────────────────

  resolveFlowId(ref: string) {
    return this.crud.resolveFlowId(ref)
  }

  list() {
    return this.crud.list()
  }

  get(ref: string) {
    return this.crud.get(ref)
  }

  getFlowSummary(ref: string) {
    return this.crud.getFlowSummary(ref)
  }

  exportSnapshot(ref: string) {
    return this.crud.exportSnapshot(ref)
  }

  delete(ref: string) {
    return this.lfSync.deleteFlow(ref)
  }

  getDefaultPlaygroundSessionId(flowId: string) {
    return this.crud.getDefaultPlaygroundSessionId(flowId)
  }

  resolvePlaygroundSessionIdForTool(flowId: string, sessionId?: string | null) {
    return this.crud.resolvePlaygroundSessionIdForTool(flowId, sessionId)
  }

  // ── Langflow sync ────────────────────────────────────────────────────────────

  async create(body: { name: string; description?: string }) {
    return this.lfSync.create(body)
  }

  async update(ref: string, body: { name?: string; description?: string; graph?: CubeFlowGraph }) {
    return this.lfSync.update(ref, body)
  }

  async importFlow(body: unknown) {
    return this.lfSync.importFlow(body)
  }

  async importGraphIntoExistingFlow(ref: string, body: unknown) {
    return this.lfSync.importGraphIntoExistingFlow(ref, body)
  }

  async importFromLangflow(ref: string, langflowFlowId: string) {
    return this.lfSync.importFromLangflow(ref, langflowFlowId)
  }

  async pushToLangflow(id: string, graph: CubeFlowGraph) {
    return this.lfSync.pushToLangflow(id, graph)
  }

  // ── Execution ────────────────────────────────────────────────────────────────

  async run(id: string, body: unknown) {
    return this.execution.run(id, body)
  }

  async runStream(id: string, body: unknown): Promise<Response> {
    return this.execution.runStream(id, body)
  }

  // ── Playground ───────────────────────────────────────────────────────────────

  listPlaygroundSessions(flowId: string) {
    return this.playground.listPlaygroundSessions(flowId)
  }

  listPlaygroundSessionsPaged(flowId: string, pageNumber?: number, pageSize?: number) {
    return this.playground.listPlaygroundSessionsPaged(flowId, pageNumber, pageSize)
  }

  createPlaygroundSessionRow(flowId: string, body: { title?: string | null; asDefault?: boolean }) {
    return this.playground.createPlaygroundSessionRow(flowId, body)
  }

  deletePlaygroundSession(flowId: string, sessionId: string) {
    return this.playground.deletePlaygroundSession(flowId, sessionId)
  }

  getPlaygroundSessionMessages(flowId: string, sessionId: string) {
    return this.playground.getPlaygroundSessionMessages(flowId, sessionId)
  }

  async playgroundMessages(ref: string, body: unknown) {
    return this.playground.playgroundMessages(ref, body)
  }
}
