import { z } from 'zod';
import { SfidSchema, SessionIdSchema } from '../common/ids';
import { EpochMsSchema } from '../common/time';
import { parseTenantDescriptorId } from '../descriptor/tenant-descriptor';

/**
 * 会话绑定的 agent 引用：19 位系统 SFID、租户 `agt_` 前缀 id、或系统裸 name。
 * ref: ADR-0016 §5；engine `buildSnapshots` 按前缀分流。
 */
export const AgentRefSchema = z
  .string()
  .min(1)
  .max(128)
  .superRefine((ref, ctx) => {
    if (SfidSchema.safeParse(ref).success) return;
    const tenantRef = parseTenantDescriptorId(ref);
    if (tenantRef) {
      if (tenantRef.kind === 'agent') return;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'agentId tenant ref must use agt_ prefix',
      });
      return;
    }
    if (/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(ref)) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'agentId must be a 19-digit SFID, tenant agt_ ref, or system agent name',
    });
  });
export type AgentRef = z.infer<typeof AgentRefSchema>;

/** 会话用途：`chat` 正常对话历史；`debug` 智能体创建/编辑页调试预览（与 chat 隔离）。 */
export const SessionPurposeSchema = z.enum(['chat', 'debug']);
export type SessionPurpose = z.infer<typeof SessionPurposeSchema>;

/** GET /sessions 按用途过滤；缺省仅返回 chat，不含 debug。 */
export const SessionPurposeFilterSchema = z.enum(['chat', 'debug', 'ALL']);
export type SessionPurposeFilter = z.infer<typeof SessionPurposeFilterSchema>;

/**
 * Session status: 3-state machine (regulation §5.2 UPPERCASE).
 * PAUSED / EXPIRED removed; ARCHIVED replaces soft-delete status.
 * ref: docs/detailed-design/05-session/lifecycle.md §2.1
 */
export const SessionStatusSchema = z.enum(['ACTIVE', 'CLOSED', 'ARCHIVED']);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

/**
 * Session DTO (camelCase; no `tenant` field per regulation §API-4).
 * ref: docs/detailed-design/05-session/README.md §2.2
 */
export const SessionSchema = z.object({
  id: SessionIdSchema,
  status: SessionStatusSchema,
  /** Agent descriptor ref（系统 SFID / 裸 name / 租户 agt_） */
  agentId: AgentRefSchema,
  /** External user id (VARCHAR 64) */
  userId: z.string().max(64),
  title: z.string().max(200).nullable(),
  purpose: SessionPurposeSchema.default('chat'),
  createTime: EpochMsSchema,
  updateTime: EpochMsSchema,
});
export type Session = z.infer<typeof SessionSchema>;

/**
 * POST /v1/sessions request body.
 * `tenant` MUST NOT be in the body (regulation §API-4).
 * ref: docs/detailed-design/01-api/session.md §S1
 */
export const CreateSessionRequestSchema = z.object({
  agentId: AgentRefSchema,
  title: z.string().max(200).optional(),
  /** Optional default model for this session snapshot */
  modelCode: z.string().max(128).optional(),
  /** Optional provider disambiguation */
  providerCode: z.string().max(128).optional(),
  providerId: z.string().max(128).optional(),
  /**
   * `debug` = 智能体调试预览会话，不入正常对话历史列表。
   * 缺省 `chat`。
   */
  purpose: SessionPurposeSchema.optional(),
  /**
   * 租户 agent 指定版本（作者调试已发布版本等）；缺省由 RunnableAgentResolver 解析 head/货架版本。
   * `0` = 草稿 head 哨兵。
   */
  agentVersionNo: z.number().int().nonnegative().optional(),
  /** Initial cross-turn context (≤16KB; regulation OQ-SE-2) */
  context: z
    .object({
      systemSuffix: z.string().max(8000).optional(),
    })
    .catchall(z.unknown())
    .optional(),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

/**
 * Per-turn runtime references carried by POST /v1/sessions/:sessionId/messages.
 * These references are selected by the end user for the current message only;
 * they are not a session default and should not leak into later turns.
 */
export const RuntimeKnowledgeBaseRefSchema = z.object({
  kbId: z.string().min(1).max(128),
  displayName: z.string().min(1).max(200).optional(),
});
export type RuntimeKnowledgeBaseRef = z.infer<typeof RuntimeKnowledgeBaseRefSchema>;

export const RuntimeUserSkillRefSchema = z.object({
  skillId: z.string().min(1).max(128),
  displayName: z.string().min(1).max(200).optional(),
});
export type RuntimeUserSkillRef = z.infer<typeof RuntimeUserSkillRefSchema>;

export const RuntimeRefsSchema = z.object({
  knowledgeBases: z.array(RuntimeKnowledgeBaseRefSchema).max(10).optional(),
  userSkills: z.array(RuntimeUserSkillRefSchema).max(10).optional(),
});
export type RuntimeRefs = z.infer<typeof RuntimeRefsSchema>;

export const TextMessageBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});
export type TextMessageBlock = z.infer<typeof TextMessageBlockSchema>;

export const ImageRefMessageBlockSchema = z.object({
  type: z.literal('image_ref'),
  attachmentId: z.string().min(1).max(128),
});
export type ImageRefMessageBlock = z.infer<typeof ImageRefMessageBlockSchema>;

export const MessageBlockSchema = z.union([TextMessageBlockSchema, ImageRefMessageBlockSchema]);
export type MessageBlock = z.infer<typeof MessageBlockSchema>;

export const MessageContentV1Schema = z.object({
  schema: z.literal('message-content-v1'),
  blocks: z.array(MessageBlockSchema),
});
export type MessageContentV1 = z.infer<typeof MessageContentV1Schema>;

export const ImageAttachmentSchema = z.object({
  attachmentId: z.string().min(1).max(128),
  kind: z.literal('image'),
  fileId: z.string().min(1).max(128),
  mimeType: z.string().min(1).max(128),
  size: z.number().int().positive().optional(),
  sha256: z.string().length(64).optional(),
  previewUrl: z.string().min(1).optional(),
});
export type ImageAttachment = z.infer<typeof ImageAttachmentSchema>;

const BaseStartTurnRequestSchema = z.object({
  content: MessageContentV1Schema,
  attachments: z.array(ImageAttachmentSchema).max(4).default([]),
  modelCode: z.string().max(128).optional(),
  /** Per-turn embedding model override (ADR-0008). */
  skillEmbeddingModelCode: z.string().max(128).optional(),
  providerCode: z.string().max(128).optional(),
  providerId: z.string().max(128).optional(),
  runtimeRefs: RuntimeRefsSchema.optional(),
});

export const StartTurnRequestSchema = BaseStartTurnRequestSchema.superRefine((value, ctx) => {
  const attachmentIds = new Set(value.attachments.map((attachment) => attachment.attachmentId));
  let imageRefCount = 0;
  const referencedAttachmentIds = new Set<string>();
  for (const block of value.content.blocks) {
    if (block.type !== 'image_ref') continue;
    imageRefCount += 1;
    referencedAttachmentIds.add(block.attachmentId);
    if (!attachmentIds.has(block.attachmentId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `image_ref attachmentId "${block.attachmentId}" must match an attachment`,
        path: ['attachments'],
      });
    }
  }
  if (imageRefCount > 4) {
    ctx.addIssue({
      code: 'too_big',
      origin: 'array',
      maximum: 4,
      inclusive: true,
      exact: false,
      message: 'A single message can reference at most 4 images',
      path: ['content', 'blocks'],
    });
  }
  for (const attachment of value.attachments) {
    if (!referencedAttachmentIds.has(attachment.attachmentId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `attachment "${attachment.attachmentId}" must be referenced by an image_ref block`,
        path: ['attachments'],
      });
    }
  }
});
export type StartTurnRequest = z.infer<typeof StartTurnRequestSchema>;

/**
 * POST /v1/sessions response (201).
 * ref: docs/detailed-design/05-session/lifecycle.md §2.2 S1
 */
export const CreateSessionResponseSchema = z.object({
  id: SessionIdSchema,
  status: z.literal('ACTIVE'),
  createTime: EpochMsSchema,
});
export type CreateSessionResponse = z.infer<typeof CreateSessionResponseSchema>;

/**
 * PATCH /v1/sessions/:sessionId request body.
 * ref: docs/detailed-design/01-api/session.md §S4
 */
export const UpdateSessionRequestSchema = z.object({
  status: z.enum(['ACTIVE', 'CLOSED']).optional(),
  title: z.string().max(200).optional(),
});
export type UpdateSessionRequest = z.infer<typeof UpdateSessionRequestSchema>;

/**
 * Turn status (persistent states; UPPERCASE per regulation §5.2).
 * ref: docs/detailed-design/05-session/lifecycle.md §3.2
 */
export const TurnStatusSchema = z.enum(['RUNNING', 'CLOSED', 'CANCELLED', 'ERROR']);
export type TurnStatus = z.infer<typeof TurnStatusSchema>;

/**
 * Turn DTO.
 * ref: docs/detailed-design/05-session/README.md §2.1
 */
export const TurnSchema = z.object({
  id: SfidSchema,
  sessionId: SessionIdSchema,
  turnNo: z.number().int().positive(),
  status: TurnStatusSchema,
  startTime: EpochMsSchema,
  closeTime: EpochMsSchema.nullable(),
});
export type Turn = z.infer<typeof TurnSchema>;
