import { describe, test, expect } from 'bun:test';
import { CreateSessionRequestSchema, RuntimeRefsSchema, StartTurnRequestSchema } from './session';

describe('CreateSessionRequestSchema', () => {
  test('accepts agentId with optional modelCode and context.systemSuffix', () => {
    const parsed = CreateSessionRequestSchema.safeParse({
      agentId: '1820345678901234567',
      modelCode: 'gpt-4.1',
      context: {
        systemSuffix: 'Please answer in concise bullet points.',
      },
    });
    expect(parsed.success).toBe(true);
  });

  test('rejects invalid context.systemSuffix type', () => {
    const parsed = CreateSessionRequestSchema.safeParse({
      agentId: '1820345678901234567',
      context: {
        systemSuffix: 123,
      },
    });
    expect(parsed.success).toBe(false);
  });
});

describe('RuntimeRefsSchema', () => {
  test('accepts per-message knowledge base and future user skill refs', () => {
    const parsed = RuntimeRefsSchema.safeParse({
      knowledgeBases: [{ kbId: 'kb-1', displayName: '产品知识库' }],
      userSkills: [{ skillId: 'skill-1', displayName: '周报 Skill' }],
    });
    expect(parsed.success).toBe(true);
  });

  test('limits knowledge base refs per turn', () => {
    const parsed = RuntimeRefsSchema.safeParse({
      knowledgeBases: Array.from({ length: 11 }, (_, i) => ({ kbId: `kb-${i}` })),
    });
    expect(parsed.success).toBe(false);
  });
});

describe('StartTurnRequestSchema', () => {
  test('accepts text plus image_ref with matching attachment', () => {
    const parsed = StartTurnRequestSchema.safeParse({
      content: {
        schema: 'message-content-v1',
        blocks: [
          { type: 'text', text: 'compare these' },
          { type: 'image_ref', attachmentId: 'att_01' },
        ],
      },
      attachments: [
        {
          attachmentId: 'att_01',
          kind: 'image',
          fileId: 'file_01',
          mimeType: 'image/png',
          size: 123,
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  test('accepts image-only content', () => {
    const parsed = StartTurnRequestSchema.safeParse({
      content: {
        schema: 'message-content-v1',
        blocks: [{ type: 'image_ref', attachmentId: 'att_01' }],
      },
      attachments: [
        {
          attachmentId: 'att_01',
          kind: 'image',
          fileId: 'file_01',
          mimeType: 'image/png',
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  test('rejects image_ref without matching attachment', () => {
    const parsed = StartTurnRequestSchema.safeParse({
      content: {
        schema: 'message-content-v1',
        blocks: [{ type: 'image_ref', attachmentId: 'att_missing' }],
      },
      attachments: [],
    });
    expect(parsed.success).toBe(false);
  });

  test('rejects unreferenced attachment', () => {
    const parsed = StartTurnRequestSchema.safeParse({
      content: {
        schema: 'message-content-v1',
        blocks: [{ type: 'text', text: 'hello' }],
      },
      attachments: [
        {
          attachmentId: 'att_01',
          kind: 'image',
          fileId: 'file_01',
          mimeType: 'image/png',
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  test('rejects more than four image refs in one message', () => {
    const parsed = StartTurnRequestSchema.safeParse({
      content: {
        schema: 'message-content-v1',
        blocks: [
          { type: 'image_ref', attachmentId: 'att_01' },
          { type: 'image_ref', attachmentId: 'att_02' },
          { type: 'image_ref', attachmentId: 'att_03' },
          { type: 'image_ref', attachmentId: 'att_04' },
          { type: 'image_ref', attachmentId: 'att_05' },
        ],
      },
      attachments: [
        { attachmentId: 'att_01', kind: 'image', fileId: 'file_01', mimeType: 'image/png' },
        { attachmentId: 'att_02', kind: 'image', fileId: 'file_02', mimeType: 'image/png' },
        { attachmentId: 'att_03', kind: 'image', fileId: 'file_03', mimeType: 'image/png' },
        { attachmentId: 'att_04', kind: 'image', fileId: 'file_04', mimeType: 'image/png' },
        { attachmentId: 'att_05', kind: 'image', fileId: 'file_05', mimeType: 'image/png' },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});
