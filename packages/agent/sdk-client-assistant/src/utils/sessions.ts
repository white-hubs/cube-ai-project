/**
 * Session list helpers (UI 决策；Q12 用户明确要求进 SDK utils)。
 * Ported from ghcloud `assistant-chat.utils.ts`.
 */
import type {
  AssistantSessionSummary,
  GroupedSessions,
} from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;

export function groupSessionsByDate(
  sessions: AssistantSessionSummary[],
  now: number = Date.now(),
): GroupedSessions {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const todayStart = startOfToday.getTime();
  const yesterdayStart = todayStart - DAY_MS;
  const groups: GroupedSessions = { today: [], yesterday: [], earlier: [] };
  for (const session of sessions) {
    if (session.updatedAt >= todayStart) {
      groups.today.push(session);
      continue;
    }
    if (session.updatedAt >= yesterdayStart) {
      groups.yesterday.push(session);
      continue;
    }
    groups.earlier.push(session);
  }
  return groups;
}

export function filterSessionsByKeyword(
  sessions: AssistantSessionSummary[],
  keyword: string,
): AssistantSessionSummary[] {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) return sessions;
  return sessions.filter((s) => s.title.toLowerCase().includes(normalized));
}

/**
 * 默认占位 title 判别：空 / "新会话*" / "未命名*"。
 * 可被 `ProvideAssistantOptions.isPlaceholderTitle` 覆盖。
 */
export function isPlaceholderSessionTitle(title: string): boolean {
  if (title === '') return true;
  if (/^新会话/.test(title)) return true;
  if (/^未命名/.test(title)) return true;
  return false;
}
