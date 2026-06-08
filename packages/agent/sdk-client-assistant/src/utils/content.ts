/**
 * Content / payload flattening helpers.
 * Ported from ghcloud `assistant-chat.utils.ts` (ADR-0008 §D4).
 */
import type { ImageAttachment } from '@cube-ai/contracts';

export function getDataString(
  data: Record<string, unknown>,
  keys: string[],
): string {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return value;
    }
  }
  return '';
}

export function joinContentBlockArray(blocks: unknown[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block == null || typeof block !== 'object' || Array.isArray(block)) {
      continue;
    }
    const b = block as Record<string, unknown>;
    if (typeof b.text === 'string' && b.text !== '') {
      parts.push(b.text);
    }
  }
  return parts.join('\n');
}

/**
 * 将助手消息的 content 规范为纯文本。
 * 支持：纯字符串、JSON 字符串 `[{"type":"text","text":"..."}]`、
 *      `message-content-v1` 对象、`blocks` 数组、嵌套 `content` 等。
 */
export function flattenAssistantContentPayload(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (t.startsWith('[')) {
      try {
        const parsed = JSON.parse(t) as unknown;
        if (Array.isArray(parsed)) {
          const joined = joinContentBlockArray(parsed);
          if (joined !== '') return joined;
        }
      } catch {
        /* 非 JSON 数组则按普通字符串返回 */
      }
    }
    return raw;
  }
  if (Array.isArray(raw)) return joinContentBlockArray(raw);
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (typeof o.text === 'string' && o.text.trim() !== '') return o.text;
    if (Array.isArray(o.blocks)) {
      const j = joinContentBlockArray(o.blocks);
      if (j !== '') return j;
    }
    const schema = o.schema;
    if (typeof schema === 'string' && schema.includes('message-content')) {
      const nested = flattenAssistantContentPayload(o.blocks ?? o.content);
      if (nested !== '') return nested;
    }
    if (o.content != null) {
      const inner = flattenAssistantContentPayload(o.content);
      if (inner !== '') return inner;
    }
  }
  return '';
}

function isImageAttachment(value: unknown): value is ImageAttachment {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.attachmentId === 'string' &&
    o.kind === 'image' &&
    typeof o.fileId === 'string' &&
    typeof o.mimeType === 'string'
  );
}

/** Parse `attachments` from a listMessages item (passthrough API field). */
export function parseMessageAttachments(raw: unknown): ImageAttachment[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out = raw.filter(isImageAttachment);
  return out.length > 0 ? out : undefined;
}
