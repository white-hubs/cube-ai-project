import { describe, test, expect } from 'bun:test';
import {
  SseEventSchema,
  SseEventIdSchema,
  TurnStartedEventSchema,
  MessageDeltaEventSchema,
  ReasoningStepEventSchema,
  ReasoningDeltaEventSchema,
  ToolCallStartedEventSchema,
  ToolCallCompletedEventSchema,
  GrantRequestEventSchema,
  PingEventV2Schema,
  DrainModeEventSchema,
  IntentRoutingEventSchema,
  EffectiveRouteResolvedEventSchema,
} from './events';

/**
 * Unit tests for SSE event discriminated union.
 * Schema discriminator: `schema: "<name>-v{N}"` (lowercase-kebab-v{n})
 * Ref: docs/detailed-design/08-sdk/contracts.md §4.3
 *      P1-09 design doc + Phase 2.B merge note (P1-06 6-event variant superseded by P1-09 13-event canonical)
 */

const VALID_TURN_SFID = '1820000000000000657';
const VALID_MESSAGE_SFID = '1820000000000000658';
const VALID_GRANT_SFID = '1820000000000000659';
const VALID_EVENT_ID = `${VALID_TURN_SFID}:000001`;

describe('SseEventIdSchema', () => {
  test('accepts valid SFID:seq6 format', () => {
    expect(SseEventIdSchema.safeParse(VALID_EVENT_ID).success).toBe(true);
  });

  test('rejects missing seq part', () => {
    expect(SseEventIdSchema.safeParse(VALID_TURN_SFID).success).toBe(false);
  });

  test('rejects seq with less than 6 digits', () => {
    expect(SseEventIdSchema.safeParse(`${VALID_TURN_SFID}:0001`).success).toBe(false);
  });

  test('rejects non-numeric turn id', () => {
    expect(SseEventIdSchema.safeParse('abc:000001').success).toBe(false);
  });
});

describe('TurnStartedEventSchema', () => {
  test('parses valid turn-started-v1', () => {
    const result = TurnStartedEventSchema.safeParse({
      schema:        'turn-started-v1',
      turnId:        VALID_TURN_SFID,
      turnNo:        1,
      startTime:     Date.now(),
      userMessageId: VALID_MESSAGE_SFID,
    });
    expect(result.success).toBe(true);
  });

  test('rejects wrong schema literal', () => {
    expect(TurnStartedEventSchema.safeParse({
      schema:        'turn-started-v2',
      turnId:        VALID_TURN_SFID,
      turnNo:        1,
      startTime:     Date.now(),
      userMessageId: VALID_MESSAGE_SFID,
    }).success).toBe(false);
  });
});

describe('IntentRoutingEventSchema', () => {
  test('parses intent-routing-v1', () => {
    const r = IntentRoutingEventSchema.safeParse({
      schema: 'intent-routing-v1',
      turnId: VALID_TURN_SFID,
      state: 'empty',
    });
    expect(r.success).toBe(true);
  });
});

describe('EffectiveRouteResolvedEventSchema', () => {
  test('parses effective-route-resolved-v1', () => {
    const result = EffectiveRouteResolvedEventSchema.safeParse({
      schema: 'effective-route-resolved-v1',
      turnId: VALID_TURN_SFID,
      requested: {
        modelCode: 'gpt-4o-mini',
        providerCode: 'openai',
      },
      effective: {
        modelCode: 'gpt-4.1-vision',
        providerCode: 'openai',
        providerId: 'provider-1',
      },
      reason: 'IMAGE_CAPABILITY_REROUTE',
    });
    expect(result.success).toBe(true);
  });
});

describe('MessageDeltaEventSchema', () => {
  test('parses message-delta-v1 with text delta', () => {
    const result = MessageDeltaEventSchema.safeParse({
      schema:    'message-delta-v1',
      turnId:    VALID_TURN_SFID,
      messageId: VALID_MESSAGE_SFID,
      seqInTurn: 1,
      delta:     { type: 'text', text: 'Hello' },
    });
    expect(result.success).toBe(true);
  });

  test('rejects legacy reasoning delta variant (ADR-0021: reasoning moved to reasoning-delta-v1)', () => {
    const result = MessageDeltaEventSchema.safeParse({
      schema:    'message-delta-v1',
      turnId:    VALID_TURN_SFID,
      messageId: VALID_MESSAGE_SFID,
      seqInTurn: 2,
      delta:     { type: 'reasoning', reasoning: 'thinking…' },
    });
    expect(result.success).toBe(false);
  });
});

describe('ReasoningStepEventSchema', () => {
  const VALID_STEP_SFID = '1820000000000000700';
  const PARENT_STEP_SFID = '1820000000000000701';

  test('parses phase START without parentStepId', () => {
    const result = ReasoningStepEventSchema.safeParse({
      schema:        'reasoning-step-v1',
      turnId:        VALID_TURN_SFID,
      stepId:        VALID_STEP_SFID,
      kind:          'phase',
      event:         'START',
      label:         '任务规划',
      phase:         'planning',
      time:          Date.now(),
    });
    expect(result.success).toBe(true);
  });

  test('parses model-reasoning START with parentStepId', () => {
    const result = ReasoningStepEventSchema.safeParse({
      schema:        'reasoning-step-v1',
      turnId:        VALID_TURN_SFID,
      stepId:        VALID_STEP_SFID,
      parentStepId:  PARENT_STEP_SFID,
      kind:          'model-reasoning',
      event:         'START',
      label:         '模型思考',
      time:          Date.now(),
    });
    expect(result.success).toBe(true);
  });

  test('parses END with ok=false + error', () => {
    const result = ReasoningStepEventSchema.safeParse({
      schema:        'reasoning-step-v1',
      turnId:        VALID_TURN_SFID,
      stepId:        VALID_STEP_SFID,
      kind:          'phase',
      event:         'END',
      label:         '执行中',
      phase:         'execution',
      ok:            false,
      error:         { code: 'TURN_INTERRUPTED', message: 'aborted by client' },
      time:          Date.now(),
    });
    expect(result.success).toBe(true);
  });

  test('rejects unknown phase value', () => {
    expect(ReasoningStepEventSchema.safeParse({
      schema:        'reasoning-step-v1',
      turnId:        VALID_TURN_SFID,
      stepId:        VALID_STEP_SFID,
      kind:          'phase',
      event:         'START',
      label:         'X',
      phase:         'unknown-phase',
      time:          Date.now(),
    }).success).toBe(false);
  });
});

describe('ReasoningDeltaEventSchema', () => {
  const VALID_STEP_SFID = '1820000000000000800';

  test('parses model-source delta with seqInStep >= 1', () => {
    const result = ReasoningDeltaEventSchema.safeParse({
      schema:    'reasoning-delta-v1',
      turnId:    VALID_TURN_SFID,
      stepId:    VALID_STEP_SFID,
      seqInStep: 1,
      text:      '正在分析…',
      source:    'model',
    });
    expect(result.success).toBe(true);
  });

  test('rejects seqInStep=0 (must be positive)', () => {
    expect(ReasoningDeltaEventSchema.safeParse({
      schema:    'reasoning-delta-v1',
      turnId:    VALID_TURN_SFID,
      stepId:    VALID_STEP_SFID,
      seqInStep: 0,
      text:      'x',
      source:    'model',
    }).success).toBe(false);
  });
});

describe('ToolCallStartedEventSchema', () => {
  test('parses valid tool-call-started-v1', () => {
    const result = ToolCallStartedEventSchema.safeParse({
      schema:     'tool-call-started-v1',
      turnId:     VALID_TURN_SFID,
      toolCallId: 'tc_01HZ8XYZ',
      toolName:   'search',
      args:       { q: 'test' },
      meta:       { execution: 'REMOTE', consent: 'ON_FIRST_USE' },
    });
    expect(result.success).toBe(true);
  });

  test('preserves optional parentStepId for reasoning tree attachment', () => {
    const parentStepId = '1820000000000000701';
    const result = ToolCallStartedEventSchema.safeParse({
      schema:       'tool-call-started-v1',
      turnId:       VALID_TURN_SFID,
      parentStepId,
      toolCallId:   'tc_01HZ8XYZ',
      toolName:     'search',
      args:         { q: 'test' },
      meta:         { execution: 'REMOTE', consent: 'ON_FIRST_USE' },
    });
    expect(result.success).toBe(true);
    expect((result as { data?: { parentStepId?: string } }).data?.parentStepId).toBe(parentStepId);
  });
});

describe('ToolCallCompletedEventSchema', () => {
  test('parses success completion with output', () => {
    const result = ToolCallCompletedEventSchema.safeParse({
      schema:     'tool-call-completed-v1',
      turnId:     VALID_TURN_SFID,
      toolCallId: 'tc_01HZ8XYZ',
      toolName:   'search',
      durationMs: 120,
      ok:         true,
      output:     { hits: [] },
    });
    expect(result.success).toBe(true);
  });

  test('parses failure completion with error', () => {
    const result = ToolCallCompletedEventSchema.safeParse({
      schema:     'tool-call-completed-v1',
      turnId:     VALID_TURN_SFID,
      toolCallId: 'tc_01HZ8XYZ',
      toolName:   'search',
      durationMs: 50,
      ok:         false,
      error:      { code: 'TOOL_TIMEOUT', message: 'timed out', retryable: true },
    });
    expect(result.success).toBe(true);
  });

  test('preserves optional parentStepId for reasoning tree attachment', () => {
    const parentStepId = '1820000000000000701';
    const result = ToolCallCompletedEventSchema.safeParse({
      schema:       'tool-call-completed-v1',
      turnId:       VALID_TURN_SFID,
      parentStepId,
      toolCallId:   'tc_01HZ8XYZ',
      toolName:     'search',
      durationMs:   120,
      ok:           true,
      output:       { hits: [] },
    });
    expect(result.success).toBe(true);
    expect((result as { data?: { parentStepId?: string } }).data?.parentStepId).toBe(parentStepId);
  });
});

describe('UsageDeltaEventSchema', () => {
  test('parses usage-delta-v2 with structured attribution metadata', () => {
    const result = SseEventSchema.safeParse({
      schema: 'usage-delta-v2',
      turnId: VALID_TURN_SFID,
      usage: { input: 10, output: 8, total: 18 },
      cumulative: { input: 10, output: 8, total: 18 },
      attribution: {
        id: '2054102360564695999',
        kind: 'llm_call',
        parentId: '2054102360564695100',
        label: 'direct-answer',
        meta: { phase: 'execution' },
      },
      accuracy: 'estimated',
    });
    expect(result.success).toBe(true);
  });
});

describe('GrantRequestEventSchema', () => {
  test('parses valid grant-request-v1', () => {
    const result = GrantRequestEventSchema.safeParse({
      schema:         'grant-request-v1',
      turnId:         VALID_TURN_SFID,
      grantRequestId: VALID_GRANT_SFID,
      toolName:       'delete_file',
      reason:         'destructive op',
      argsPreview:    { path: '/tmp/x' },
      scopeHint:      'ONCE',
      expiresTime:    Date.now() + 60_000,
    });
    expect(result.success).toBe(true);
  });
});

describe('PingEventV2Schema / DrainModeEventSchema', () => {
  test('ping-v1 has only schema field', () => {
    expect(PingEventV2Schema.safeParse({ schema: 'ping-v1' }).success).toBe(true);
  });

  test('drain-mode-v1 carries reason + reconnectHintMs', () => {
    expect(DrainModeEventSchema.safeParse({
      schema:          'drain-mode-v1',
      reason:          'GRACEFUL_SHUTDOWN',
      reconnectHintMs: 5_000,
    }).success).toBe(true);
  });
});

describe('SseEventSchema discriminated union', () => {
  test('routes turn-started-v1 correctly', () => {
    const result = SseEventSchema.safeParse({
      schema:        'turn-started-v1',
      turnId:        VALID_TURN_SFID,
      turnNo:        1,
      startTime:     Date.now(),
      userMessageId: VALID_MESSAGE_SFID,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schema).toBe('turn-started-v1');
    }
  });

  test('rejects unknown schema literal', () => {
    expect(SseEventSchema.safeParse({
      schema: 'unknown-event-v1',
      turnId: VALID_TURN_SFID,
    }).success).toBe(false);
  });

  test('rejects removed turn-phase-v1 (ADR-0021)', () => {
    expect(SseEventSchema.safeParse({
      schema: 'turn-phase-v1',
      turnId: VALID_TURN_SFID,
      phase:  'PRE_LLM',
      event:  'START',
      ok:     true,
      time:   Date.now(),
    }).success).toBe(false);
  });

  test('routes reasoning-step-v1 + reasoning-delta-v1 correctly', () => {
    const VALID_STEP_SFID = '1820000000000000900';
    const stepEvent = SseEventSchema.safeParse({
      schema:        'reasoning-step-v1',
      turnId:        VALID_TURN_SFID,
      stepId:        VALID_STEP_SFID,
      kind:          'phase',
      event:         'START',
      label:         '执行中',
      phase:         'execution',
      time:          Date.now(),
    });
    expect(stepEvent.success).toBe(true);

    const deltaEvent = SseEventSchema.safeParse({
      schema:    'reasoning-delta-v1',
      turnId:    VALID_TURN_SFID,
      stepId:    VALID_STEP_SFID,
      seqInStep: 1,
      text:      'thinking…',
      source:    'model',
    });
    expect(deltaEvent.success).toBe(true);
  });

  test('rejects missing schema field', () => {
    expect(SseEventSchema.safeParse({
      turnId: VALID_TURN_SFID,
      turnNo: 1,
    }).success).toBe(false);
  });
});
