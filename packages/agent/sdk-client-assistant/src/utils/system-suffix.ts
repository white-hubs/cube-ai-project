/**
 * Build a system-prompt suffix from recent user/assistant turns.
 * Ported from ghcloud `assistant-chat.utils.ts` (ADR-0008 §D4 utils-A).
 *
 * 该工具在 ghcloud 中用于"会话上下文延续" — engine 不持久化对话上下文，
 * 业务侧把最近 N 轮拼成 systemSuffix 在 `createSession({context:{systemSuffix}})` 注入。
 */
import type { AssistantMessage } from '../types';

export function buildSystemSuffixFromMessages(
  messages: AssistantMessage[],
  maxTurns: number,
): string {
  const normalizedTurns = Number.isFinite(maxTurns)
    ? Math.max(1, Math.floor(maxTurns))
    : 1;
  const visibleMessages = messages.filter(
    (m) => m.role === 'user' || m.role === 'assistant',
  );
  if (visibleMessages.length === 0) return '';

  const turns: Array<{ user: string; assistant: string }> = [];
  let pendingUser: string | null = null;
  for (const message of visibleMessages) {
    if (message.role === 'user') {
      if (pendingUser != null) {
        turns.push({ user: pendingUser, assistant: '' });
      }
      pendingUser = message.content.trim();
      continue;
    }
    if (pendingUser != null) {
      turns.push({
        user: pendingUser,
        assistant: message.content.trim(),
      });
      pendingUser = null;
    }
  }
  if (pendingUser != null) {
    turns.push({ user: pendingUser, assistant: '' });
  }

  const selected = turns.slice(-normalizedTurns);
  const lines = selected.flatMap((turn, index) => {
    const turnNumber = index + 1;
    return [
      `第${turnNumber}轮`,
      `用户：${turn.user || '（空）'}`,
      `助手：${turn.assistant || '（空）'}`,
    ];
  });
  return `以下为最近对话上下文，请承接上下文继续回答：\n${lines.join('\n')}`;
}
