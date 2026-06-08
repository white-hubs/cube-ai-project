import { describe, test, expect, mock } from 'bun:test';
import type { SessionSseEmitter } from '@cube-ai/bun-server-ext-sse';
import type { OutboxWriter } from '@cube-ai/bun-server-ext-outbox';
import type { EngineOutput, StreamChunk, StreamChunkPayload } from '@tachu/core';
import { HostError } from '@tachu/core';
import { TurnService } from './turn.service';
import { TurnLockService } from './turn-lock.service';
import { SfidService } from '../../infra/sfid/sfid.service';
import { AgenticEngineError } from '../../infra/errors/agentic-error';
import { LoggerFactory } from '../../infra/observability/logger.factory';
import type { TurnRepository } from './turn.repository';
import type { SessionRepository } from './repository/session.repository';
import type Redis from 'ioredis';
import type { EngineFactory } from '../tachu/engine-factory';
import type { JobDataService } from '../jobs/job-data.service';
import type { LocalFileService } from '../files/local-file.service';

/**
 * TurnService 单元测试 —— 公开行为契约：
 *  - happy path：tachu chunks → 通过 mapper → SSE 一组事件按序 emit
 *  - 错误路径：error chunk → mapper 发 turn.failed → DB 走 markTurnError
 *  - 取消路径：cancelTurn 调用 engine.cancel + DB cancelTurn + SSE turn.cancelled
 *
 * 这一版 mock `engineFactory.runStream` 为 async generator —— 与新 EngineFactory
 * 的 API（返回 `AsyncIterable<StreamChunk>`）保持一致。
 */

const SESSION_ID = '1000000000000000001';
const TENANT = 1;

function makeOutput(opts?: {
  tokenUsage?: { input: number; output: number; total: number };
}): EngineOutput {
  return {
    type: 'text',
    content: 'ok',
    steps: [],
    metadata: {
      outcome: 'completed',
      toolCalls: [],
      durationMs: 0,
      tokenUsage: opts?.tokenUsage ?? { input: 0, output: 0, total: 0 },
    },
    correlation: {
      traceId:   't',
      requestId: 't',
      sessionId: SESSION_ID,
      turnId:    'turn-test',
    },
    deliveryMode: 'streaming',
  };
}

function asyncGenFrom(chunks: StreamChunkPayload[]) {
  return async function* (): AsyncIterable<StreamChunk> {
    for (const c of chunks) yield c as StreamChunk;
  };
}

function buildTurnService(o: {
  lockAcquire?: boolean | Error;
  insertTurnNo?: number;
  redisGet?: string | null;
  redisSet?: ReturnType<typeof mock>;
  /** Chunks tachu Engine should yield. Defaults to a minimal delta+done. */
  chunks?: StreamChunkPayload[];
  /** Override runStream entirely (e.g. to throw). */
  runStream?: ReturnType<typeof mock>;
  resolveEffectiveRoute?: ReturnType<typeof mock>;
  /** Session row for snapshot loading. null = no snapshot. */
  sessionRow?: { sessionId: string; agentSnapshotJson: unknown } | null;
  getTurnRow?: ReturnType<typeof mock>;
  outboxAppend?: ReturnType<typeof mock>;
  jobData?: JobDataService;
} = {}): {
  service: TurnService;
  mocks: {
    sseEmit: ReturnType<typeof mock>;
    runStream: ReturnType<typeof mock>;
    resolveEffectiveRoute: ReturnType<typeof mock>;
    cancel: ReturnType<typeof mock>;
    release: ReturnType<typeof mock>;
    cancelDb: ReturnType<typeof mock>;
    completeDb: ReturnType<typeof mock>;
    markTurnError: ReturnType<typeof mock>;
    outboxAppend: ReturnType<typeof mock>;
    insertRunningTurn: ReturnType<typeof mock>;
    nextMessageSeqForTurn: ReturnType<typeof mock>;
    insertAssistantMessage: ReturnType<typeof mock>;
    bindAttachmentsToMessage: ReturnType<typeof mock>;
  };
} {
  const sfidService = new SfidService();

  const release = mock(async () => {});
  const mockLock = {
    tryAcquire: mock(async () => {
      if (o.lockAcquire instanceof Error) throw o.lockAcquire;
      return o.lockAcquire ?? true;
    }),
    renew: mock(async () => true),
    release,
  } as unknown as TurnLockService;

  const insertRunningTurn = mock(async () => o.insertTurnNo ?? 1);
  const cancelDb = mock(async () => {});
  const completeDb = mock(async () => {});
  const markTurnError = mock(async () => {});

  const turns = {
    requirePool: () => {},
    insertRunningTurn,
    completeTurn: completeDb,
    cancelTurn: cancelDb,
    markTurnError,
    getTurnRow:
      o.getTurnRow ??
      mock(async () => ({
        sessionId: SESSION_ID,
        status: 'RUNNING',
        pipelineTrace: null,
      })),
  } as unknown as TurnRepository;

  const redis = {
    get: mock(async () => o.redisGet ?? null),
    set: o.redisSet ?? mock(async () => 'OK'),
  } as unknown as Redis;

  const sseEmit = mock(async () => {});
  const sseEmitter = { emit: sseEmit } as unknown as SessionSseEmitter;

  const defaultChunks: StreamChunkPayload[] = [
    { type: 'delta', content: 'ok' },
    { type: 'done', output: makeOutput() },
  ];
  const runStream =
    o.runStream ?? mock(asyncGenFrom(o.chunks ?? defaultChunks));
  const resolveEffectiveRoute =
    o.resolveEffectiveRoute ??
    mock(async (input?: { turnModelCode?: string }) => ({
      effectiveModelCode: input?.turnModelCode ?? 'gpt-4o-mini',
      effectiveProviderCode: 'agentic-platform-llm-catalog',
      reason: 'DIRECT',
    }));
  const cancel = mock(() => {});
  const engineFactory = {
    runStream,
    cancel,
    resolveEffectiveRoute,
  } as unknown as EngineFactory;

  const sessionRow = o.sessionRow === undefined
    ? { sessionId: SESSION_ID, agentSnapshotJson: null }
    : o.sessionRow;
  const sessions = {
    findById: mock(async () => sessionRow),
  } as unknown as SessionRepository;

  const outboxAppend = o.outboxAppend ?? mock(async () => {});
  const outbox = { append: outboxAppend } as unknown as OutboxWriter;

  const nextMessageSeqForTurn = mock(async () => 1);
  const insertAssistantMessage = mock(async () => {});
  const bindAttachmentsToMessage = mock(async () => {});
  const jobData =
    o.jobData ??
    ({
      nextMessageSeqForTurn,
      insertAssistantMessage,
    } as unknown as JobDataService);

  const loggerFactory = new LoggerFactory();
  const localFiles = {
    bindAttachmentsToMessage,
  } as unknown as LocalFileService;

  const service = new TurnService(
    sfidService,
    sseEmitter,
    mockLock,
    turns,
    sessions,
    redis,
    jobData,
    localFiles,
    engineFactory,
    outbox,
    loggerFactory,
  );

  return {
    service,
    mocks: {
      sseEmit,
      runStream,
      resolveEffectiveRoute,
      cancel,
      release,
      cancelDb,
      completeDb,
      markTurnError,
      outboxAppend,
      insertRunningTurn,
      nextMessageSeqForTurn,
      insertAssistantMessage,
      bindAttachmentsToMessage,
    },
  };
}

function schemasFromSse(calls: unknown[][]): string[] {
  return calls.map((c) => {
    const row = c as unknown as [unknown, unknown, { payload: { schema?: string } }];
    return row[2]?.payload?.schema ?? '';
  });
}

describe('TurnService.startTurn — happy path', () => {
  test('returns a valid SFID turnId when lock succeeds', async () => {
    const { service } = buildTurnService();
    const turnId = await service.startTurn(SESSION_ID, TENANT, 'Hello');
    expect(turnId).toMatch(/^\d{19}$/);
  });

  test('emits turn.started SSE (schema turn-started-v1) after lock succeeds', async () => {
    const { service, mocks } = buildTurnService();
    await service.startTurn(SESSION_ID, TENANT, 'Hello');
    expect(mocks.sseEmit.mock.calls.length).toBeGreaterThanOrEqual(1);
    const arg = mocks.sseEmit.mock.calls[0]?.[2] as { payload: { schema?: string } };
    expect(arg.payload.schema).toBe('turn-started-v1');
  });

  test('streaming chunks → SSE emits message.delta + message.completed + usage.delta-v2 + turn.completed', async () => {
    const { service, mocks } = buildTurnService();
    await service.startTurn(SESSION_ID, TENANT, 'Hello');
    await new Promise((r) => setTimeout(r, 50));

    const schemas = schemasFromSse(mocks.sseEmit.mock.calls);
    expect(schemas.includes('message-delta-v1')).toBe(true);
    expect(schemas.includes('message-completed-v1')).toBe(true);
    expect(schemas.includes('usage-delta-v2')).toBe(true);
    expect(schemas.includes('turn-completed-v1')).toBe(true);
  });

  test('emits intent.routing SSE (matched) during LLM phase', async () => {
    const { service, mocks } = buildTurnService();
    await service.startTurn(SESSION_ID, TENANT, 'Hello');
    await new Promise((r) => setTimeout(r, 50));
    const ir = mocks.sseEmit.mock.calls
      .map((c) => c[2] as { sseEvent?: string; payload?: { schema?: string; state?: string } })
      .find((x) => x.sseEvent === 'intent.routing' || x.payload?.schema === 'intent-routing-v1');
    expect(ir?.payload?.schema).toBe('intent-routing-v1');
    expect(ir?.payload?.state).toBe('matched');
  });

  test('emits effective-route-resolved-v1 before model output', async () => {
    const { service, mocks } = buildTurnService({
      resolveEffectiveRoute: mock(async () => ({
        effectiveModelCode: 'gpt-4.1-vision',
        effectiveProviderCode: 'openai-compat',
        reason: 'IMAGE_CAPABILITY_REROUTE',
      })),
    });
    await service.startTurn(SESSION_ID, TENANT, 'Hello', {
      content: {
        schema: 'message-content-v1',
        blocks: [{ type: 'image_ref', attachmentId: 'att_01' }],
      },
      attachments: [{ attachmentId: 'att_01', kind: 'image', fileId: 'file_01', mimeType: 'image/png' }],
      modelCode: 'gpt-4o-mini',
      providerCode: 'openai',
    });
    await new Promise((r) => setTimeout(r, 50));
    const emitted = mocks.sseEmit.mock.calls
      .map((c) => c[2] as { sseEvent?: string; payload?: { schema?: string; reason?: string } });
    const routeIndex = emitted.findIndex((event) => event.sseEvent === 'turn.route.resolved');
    const firstModelOutputIndex = emitted.findIndex(
      (event) => event.payload?.schema === 'message-delta-v1' || event.payload?.schema === 'message-completed-v1',
    );
    const routeEvent = routeIndex >= 0 ? emitted[routeIndex] : undefined;
    expect(routeEvent?.payload?.schema).toBe('effective-route-resolved-v1');
    expect(routeEvent?.payload?.reason).toBe('IMAGE_CAPABILITY_REROUTE');
    expect(routeIndex).toBeGreaterThanOrEqual(0);
    expect(firstModelOutputIndex).toBeGreaterThan(routeIndex);
  });

  test('intent.routing state empty when configured flow keywords do not match', async () => {
    const snapshot = {
      agent: {
        content: {
          prompt: 'p',
          toolRefs: ['platform.flow.invoke', 'platform.knowledge.query'],
          intentRouting: {
            enabled: true,
            flows: [{ toolName: 'platform.flow.invoke', priority: 1, keywords: ['nope'] }],
          },
        },
      },
    };
    const { service, mocks } = buildTurnService({
      sessionRow: { sessionId: SESSION_ID, agentSnapshotJson: snapshot },
    });
    await service.startTurn(SESSION_ID, TENANT, 'no keyword here');
    await new Promise((r) => setTimeout(r, 50));
    const ir = mocks.sseEmit.mock.calls
      .map((c) => c[2] as { sseEvent?: string; payload?: { schema?: string; state?: string } })
      .find((x) => x.sseEvent === 'intent.routing' || x.payload?.schema === 'intent-routing-v1');
    expect(ir?.payload?.state).toBe('empty');
  });

  test('tool-call-start + tool-call-end → SSE emits tool.call.started + tool.call.completed', async () => {
    const chunks: StreamChunkPayload[] = [
      {
        type: 'tool-call-start',
        callId: 'tcall_1',
        tool: 'platform.knowledge.query',
        argumentsPreview: '{"q":"x"}',
      },
      {
        type: 'tool-call-end',
        callId: 'tcall_1',
        tool: 'platform.knowledge.query',
        success: true,
        durationMs: 5,
      },
      { type: 'done', output: makeOutput() },
    ];
    const { service, mocks } = buildTurnService({ chunks });
    await service.startTurn(SESSION_ID, TENANT, 'Hello');
    await new Promise((r) => setTimeout(r, 50));

    const schemas = schemasFromSse(mocks.sseEmit.mock.calls);
    expect(schemas.includes('tool-call-started-v1')).toBe(true);
    expect(schemas.includes('tool-call-completed-v1')).toBe(true);
    expect(schemas.includes('message-delta-v1')).toBe(true);
  });

  test('invokes engine.runStream with prompt, sessionId, tenant, turnId', async () => {
    const { service, mocks } = buildTurnService();
    await service.startTurn(SESSION_ID, TENANT, 'prompt');
    await new Promise((r) => setTimeout(r, 50));
    expect(mocks.runStream.mock.calls.length).toBeGreaterThanOrEqual(1);
    const arg = mocks.runStream.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg.prompt).toBe('prompt');
    expect(arg.sessionId).toBe(SESSION_ID);
    expect(arg.tenant).toBe(TENANT);
  });

  test('forwards turn body modelCode as turnModelCode to engine.runStream', async () => {
    const { service, mocks } = buildTurnService();
    await service.startTurn(SESSION_ID, TENANT, 'prompt', { modelCode: 'gpt-4.1' });
    await new Promise((r) => setTimeout(r, 50));
    const arg = mocks.runStream.mock.calls[0]?.[0] as { turnModelCode?: string };
    expect(arg.turnModelCode).toBe('gpt-4.1');
  });

  test('forwards skillEmbeddingModelCode to engine.runStream', async () => {
    const { service, mocks } = buildTurnService();
    await service.startTurn(SESSION_ID, TENANT, 'prompt', {
      skillEmbeddingModelCode: 'text-embedding-3-large',
    });
    await new Promise((r) => setTimeout(r, 50));
    const arg = mocks.runStream.mock.calls[0]?.[0] as { skillEmbeddingModelCode?: string };
    expect(arg.skillEmbeddingModelCode).toBe('text-embedding-3-large');
  });

  test('persists runtimeRefs in the inputEnvelope for this turn', async () => {
    const runtimeRefs = {
      knowledgeBases: [{ kbId: 'kb-1', displayName: '产品知识库' }],
    };
    const { service, mocks } = buildTurnService();
    await service.startTurn(SESSION_ID, TENANT, 'prompt', { runtimeRefs });
    const arg = mocks.insertRunningTurn.mock.calls[0]?.[0] as {
      inputEnvelope?: { runtimeRefs?: unknown };
    };
    expect(arg.inputEnvelope?.runtimeRefs).toEqual(runtimeRefs);
  });

  test('persists multimodal content and attachments in the inputEnvelope', async () => {
    const content = {
      schema: 'message-content-v1' as const,
      blocks: [
        { type: 'text' as const, text: 'compare' },
        { type: 'image_ref' as const, attachmentId: 'att_01' },
      ],
    };
    const attachments = [
      {
        attachmentId: 'att_01',
        kind: 'image' as const,
        fileId: 'file_01',
        mimeType: 'image/png',
      },
    ];
    const { service, mocks } = buildTurnService();
    await service.startTurn(SESSION_ID, TENANT, 'compare', { content, attachments });
    const arg = mocks.insertRunningTurn.mock.calls[0]?.[0] as {
      inputEnvelope?: { content?: unknown; attachments?: unknown };
      userContentJson?: unknown;
      attachmentsJson?: unknown;
    };
    expect(arg.inputEnvelope?.content).toEqual(content);
    expect(arg.inputEnvelope?.attachments).toEqual(attachments);
    expect(arg.userContentJson).toEqual(content.blocks);
    expect(arg.attachmentsJson).toEqual(attachments);
    expect(mocks.bindAttachmentsToMessage).toHaveBeenCalledWith({
      tenant: TENANT,
      sessionId: SESSION_ID,
      messageId: expect.any(String),
      attachments,
    });
  });

  test('forwards runtimeRefs to engine.runStream', async () => {
    const runtimeRefs = {
      knowledgeBases: [{ kbId: 'kb-1', displayName: '产品知识库' }],
    };
    const { service, mocks } = buildTurnService();
    await service.startTurn(SESSION_ID, TENANT, 'prompt', { runtimeRefs });
    await new Promise((r) => setTimeout(r, 50));
    const arg = mocks.runStream.mock.calls[0]?.[0] as { runtimeRefs?: unknown };
    expect(arg.runtimeRefs).toEqual(runtimeRefs);
  });

  test('loads agent snapshot from SessionRepository and forwards it to engine.runStream', async () => {
    const snapshot = {
      agent: { content: { prompt: 'GLOBAL+AGENT+SUFFIX', modelConfig: { model: 'snap-default' } } },
    };
    const { service, mocks } = buildTurnService({
      sessionRow: { sessionId: SESSION_ID, agentSnapshotJson: snapshot },
    });
    await service.startTurn(SESSION_ID, TENANT, 'prompt');
    await new Promise((r) => setTimeout(r, 50));
    const arg = mocks.runStream.mock.calls[0]?.[0] as { agentSnapshot?: unknown };
    expect(arg.agentSnapshot).toEqual(snapshot);
  });

  test('completes turn in DB with tokenUsage from done.output.metadata', async () => {
    const chunks: StreamChunkPayload[] = [
      { type: 'delta', content: 'ok' },
      {
        type: 'done',
        output: makeOutput({ tokenUsage: { input: 11, output: 22, total: 33 } }),
      },
    ];
    const { service, mocks } = buildTurnService({ chunks });
    await service.startTurn(SESSION_ID, TENANT, 'prompt');
    await new Promise((r) => setTimeout(r, 50));
    expect(mocks.insertAssistantMessage.mock.calls.length).toBe(1);
    const insArg = mocks.insertAssistantMessage.mock.calls[0]?.[0] as {
      contentJson?: unknown;
    };
    expect(insArg.contentJson).toEqual([{ type: 'text', text: 'ok' }]);
    expect(mocks.completeDb.mock.calls.length).toBe(1);
    const callArg = mocks.completeDb.mock.calls[0]?.[0] as {
      tokenUsage: { input: number; output: number; total: number };
    };
    expect(callArg.tokenUsage).toEqual({ input: 11, output: 22, total: 33 });
  });

  test('insertRunningTurn stores user message id + prompt for messages row', async () => {
    const { service, mocks } = buildTurnService();
    await service.startTurn(SESSION_ID, TENANT, 'hello-user');
    const arg = mocks.insertRunningTurn.mock.calls[0]?.[0] as {
      userPromptText?: string;
      userMessageId?: string;
    };
    expect(arg.userPromptText).toBe('hello-user');
    expect(arg.userMessageId).toMatch(/^\d{19}$/);
    const started = mocks.sseEmit.mock.calls[0]?.[2] as { payload: { userMessageId?: string } };
    expect(started.payload.userMessageId).toBe(arg.userMessageId);
  });

  test('each call returns a different turnId', async () => {
    const { service } = buildTurnService();
    const t1 = await service.startTurn(SESSION_ID, TENANT, 'p1');
    const t2 = await service.startTurn(SESSION_ID, TENANT, 'p2');
    expect(t1).not.toBe(t2);
  });
});

describe('TurnService.startTurn — error paths', () => {
  test('error chunk from tachu → mapper emits turn.failed + DB.markTurnError (no duplicate emit)', async () => {
    const chunks: StreamChunkPayload[] = [
      {
        type: 'error',
        error: new HostError('TACHU_FAIL', 'failure inside engine', { retryable: false }),
      },
    ];
    const { service, mocks } = buildTurnService({ chunks });
    await service.startTurn(SESSION_ID, TENANT, 'prompt');
    await new Promise((r) => setTimeout(r, 50));
    const schemas = schemasFromSse(mocks.sseEmit.mock.calls);
    const failedCount = schemas.filter((s) => s === 'turn-failed-v1').length;
    expect(failedCount).toBe(1);
    expect(mocks.markTurnError.mock.calls.length).toBe(1);
  });

  test('runStream itself throws → catch path emits turn.failed and DB.markTurnError', async () => {
    const runStream = mock(async function* (): AsyncIterable<StreamChunk> {
      throw new Error('engine crashed');
      // eslint-disable-next-line no-unreachable
      yield {} as StreamChunk;
    });
    const { service, mocks } = buildTurnService({ runStream });
    await service.startTurn(SESSION_ID, TENANT, 'prompt');
    await new Promise((r) => setTimeout(r, 50));
    const schemas = schemasFromSse(mocks.sseEmit.mock.calls);
    expect(schemas.includes('turn-failed-v1')).toBe(true);
    expect(mocks.markTurnError.mock.calls.length).toBe(1);
  });
});

describe('TurnService.startTurn — conflicts', () => {
  test('throws RESOURCE_CONFLICT_SESSION_BUSY when lock returns false', async () => {
    const { service } = buildTurnService({ lockAcquire: false });
    await expect(service.startTurn(SESSION_ID, TENANT, 'Hello')).rejects.toMatchObject({
      code: 'RESOURCE_CONFLICT_SESSION_BUSY',
    });
  });

  test('503 when Redis lock throws unavailable', async () => {
    const err = new AgenticEngineError(503, 'UNAVAILABLE_LOCK_SERVICE', 'Redis down');
    const { service } = buildTurnService({ lockAcquire: err });
    await expect(service.startTurn(SESSION_ID, TENANT, 'x')).rejects.toMatchObject({
      httpStatus: 503,
    });
  });
});

describe('TurnService.startTurn — idempotency', () => {
  test('returns cached turnId when Idempotency-Key hits Redis', async () => {
    const cached = JSON.stringify({ turnId: '1000000000000000002' });
    const { service, mocks } = buildTurnService({ redisGet: cached });
    const turnId = await service.startTurn(SESSION_ID, TENANT, 'Hello', {
      idempotencyKey: 'idem-1',
    });
    expect(turnId).toBe('1000000000000000002');
    expect(mocks.release.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});

describe('TurnService — usage.llm_call outbox emission', () => {
  test('emits usage.llm_call to outbox after successful turn', async () => {
    const outboxAppend = mock(async () => {});
    const { service } = buildTurnService({ outboxAppend });
    await service.startTurn(SESSION_ID, TENANT, 'prompt');
    await new Promise((r) => setTimeout(r, 50));
    expect(outboxAppend.mock.calls.length).toBe(1);
    const call = outboxAppend.mock.calls[0] as unknown as [
      unknown,
      {
        channel: string;
        eventType: string;
        tenant: number;
        target: string | null;
        payloadJson: { sessionId: string; turnId: string; promptTokens: number };
      },
    ];
    const row = call[1];
    expect(row.channel).toBe('usage_event');
    expect(row.eventType).toBe('usage.llm_call');
    expect(row.tenant).toBe(TENANT);
    expect(row.target).toBe('agentic-usage-events');
    expect(row.payloadJson.sessionId).toBe(SESSION_ID);
  });

  test('outbox failure does not break turn completion', async () => {
    const outboxAppend = mock(async () => {
      throw new Error('outbox down');
    });
    const { service, mocks } = buildTurnService({ outboxAppend });
    await service.startTurn(SESSION_ID, TENANT, 'prompt');
    await new Promise((r) => setTimeout(r, 50));
    expect(mocks.completeDb.mock.calls.length).toBe(1);
    expect(
      schemasFromSse(mocks.sseEmit.mock.calls).includes('turn-completed-v1'),
    ).toBe(true);
  });
});

describe('TurnService.cancel / complete', () => {
  test('cancelTurn calls engine.cancel(sessionId, reason) and DB.cancelTurn + SSE turn.cancelled', async () => {
    const { service, mocks } = buildTurnService();
    await service.cancelTurn('1000000000000000005', TENANT, 'USER_REQUEST');

    expect(mocks.cancel.mock.calls.length).toBe(1);
    const cancelArg = mocks.cancel.mock.calls[0] as unknown as [string, string?];
    expect(cancelArg[0]).toBe(SESSION_ID);
    expect(mocks.cancelDb.mock.calls.length).toBe(1);
    const schemas = schemasFromSse(mocks.sseEmit.mock.calls);
    expect(schemas.includes('turn-cancelled-v1')).toBe(true);
  });

  test('completeTurn writes token usage envelope and emits SSE', async () => {
    const { service, mocks } = buildTurnService();
    await service.completeTurn('1000000000000000006', TENANT, '1000000000000000007', {
      input: 1,
      output: 2,
      total: 3,
    });

    expect(mocks.completeDb.mock.calls.length).toBe(1);
    const schemas = schemasFromSse(mocks.sseEmit.mock.calls);
    expect(schemas.includes('turn-completed-v1')).toBe(true);
  });
});
