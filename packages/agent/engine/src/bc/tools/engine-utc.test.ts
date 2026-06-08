import { describe, expect, test } from 'bun:test';
import {
  appendEngineUtcClockBlock,
  ENGINE_UTC_CLOCK_APPEND_PREFIX,
  formatEngineUtcClockAppend,
} from './engine-utc';

describe('appendEngineUtcClockBlock', () => {
  test('非空 system 末尾追加 session-start UTC 块（含 iso / epochMs 与 currentDate 提示）', () => {
    const t = 1_700_000_000_000;
    const iso = new Date(t).toISOString();
    const out = appendEngineUtcClockBlock('You are a helpful assistant.', t);
    expect(out.startsWith('You are a helpful assistant.\n\n---\n')).toBe(true);
    expect(out).toContain('Session-start time (UTC)');
    expect(out).toContain(`iso=${iso}`);
    expect(out).toContain('epochMs=1700000000000');
    expect(out).toContain('`currentDate` tool');
    expect(out).toContain('calendar boundaries in UTC');
  });

  test('空白 system 不注入（原样返回）', () => {
    expect(appendEngineUtcClockBlock('   ', 1)).toBe('   ');
  });

  test('formatEngineUtcClockAppend 以 toISOString 输出 Z 后缀', () => {
    const s = formatEngineUtcClockAppend(0);
    expect(s.startsWith(ENGINE_UTC_CLOCK_APPEND_PREFIX)).toBe(true);
    expect(s).toContain('Session-start time (UTC)');
    expect(s).toContain('1970-01-01T00:00:00.000Z');
    expect(s).toContain('epochMs=0');
  });
});
