/**
 * Extract helpers for `message-delta-v1` / `message-completed-v1` 等事件。
 * Ported from ghcloud `assistant-chat.utils.ts` (ADR-0008 §D4).
 */
import { flattenAssistantContentPayload, getDataString } from './content';

/**
 * `message-delta-v1`：`delta` 可能是字符串，或 `{ type: 'text', text }`。
 * 与服务端 contracts `MessageDeltaEventSchema` 收窄后一致。
 */
export function extractMessageDeltaChunk(data: Record<string, unknown>): string {
  const delta = data.delta;
  if (typeof delta === 'string' && delta !== '') {
    const flat = flattenAssistantContentPayload(delta);
    if (flat !== '') return flat;
  }
  if (delta != null && typeof delta === 'object' && !Array.isArray(delta)) {
    const nested = delta as Record<string, unknown>;
    if (typeof nested.text === 'string') return nested.text;
    const flatObj = flattenAssistantContentPayload(delta);
    if (flatObj !== '') return flatObj;
  }
  return getDataString(data, ['chunk', 'text']);
}

/**
 * 从 SSE 归一化后的 `data` 中提取助手落库消息 id。
 * 兼容顶层字段与一层嵌套 `data.*`。
 */
export function extractAssistantMessageId(
  data: Record<string, unknown>,
): string | null {
  const direct = getDataString(data, [
    'messageId',
    'message_id',
    'assistantMessageId',
  ]);
  if (direct !== '') return direct.trim();
  const inner = data.data;
  if (inner != null && typeof inner === 'object' && !Array.isArray(inner)) {
    const nested = getDataString(inner as Record<string, unknown>, [
      'messageId',
      'message_id',
      'assistantMessageId',
    ]);
    if (nested !== '') return nested.trim();
  }
  return null;
}

/**
 * 从 SSE `turnId` 字段（顶层或一层嵌套）提取。
 */
export function extractTurnId(data: Record<string, unknown>): string | null {
  const direct = getDataString(data, ['turnId', 'turn_id']);
  if (direct !== '') return direct.trim();
  const inner = data.data;
  if (inner != null && typeof inner === 'object' && !Array.isArray(inner)) {
    const nested = getDataString(inner as Record<string, unknown>, [
      'turnId',
      'turn_id',
    ]);
    if (nested !== '') return nested.trim();
  }
  return null;
}
