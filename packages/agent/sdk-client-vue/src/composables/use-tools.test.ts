/**
 * useTools 单元测试（离线，纯响应式 — 不需要 DOM）：
 *   - 初始状态：descriptors=[] / loading=false / error=null
 *   - reload 成功：descriptors 落位 + loading true→false
 *   - 普通 Error 包装为 AgenticClientError；AgenticClientError 原样保留
 *   - 失败后再次 reload 成功 → error 清空
 */
import { describe, expect, test } from 'bun:test';
import type { AgenticClient } from '@cube-ai/agent-sdk-client';
import { AgenticClientError } from '@cube-ai/agent-sdk-client';
import type { PublicToolDescriptor } from '@cube-ai/contracts';
import { useTools } from './use-tools';

const DESCRIPTORS: PublicToolDescriptor[] = [
  {
    id: '40001',
    name: 'web_search',
    displayName: 'Web 搜索',
    summary: null,
    consent: 'NEVER',
    enabled: true,
  },
  {
    id: '40002',
    name: 'delete_file',
    displayName: '删除文件',
    summary: '危险操作',
    consent: 'EACH_CALL',
    enabled: false,
  },
];

function stubClient(list: () => Promise<PublicToolDescriptor[]>): {
  client: AgenticClient;
  calls: { count: number };
} {
  const calls = { count: 0 };
  const client = {
    tools: {
      list: async () => {
        calls.count++;
        return list();
      },
    },
  } as unknown as AgenticClient;
  return { client, calls };
}

describe('useTools', () => {
  test('初始状态：空列表 / 不 loading / 无 error，且不主动请求', () => {
    const { client, calls } = stubClient(async () => DESCRIPTORS);
    const api = useTools(client);
    expect(api.descriptors.value).toEqual([]);
    expect(api.loading.value).toBe(false);
    expect(api.error.value).toBeNull();
    expect(calls.count).toBe(0);
  });

  test('reload 成功：descriptors 落位 + loading 状态机', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { client, calls } = stubClient(async () => {
      await gate;
      return DESCRIPTORS;
    });
    const api = useTools(client);
    const pending = api.reload();
    expect(api.loading.value).toBe(true);
    release!();
    await pending;
    expect(api.loading.value).toBe(false);
    expect(api.descriptors.value).toEqual(DESCRIPTORS);
    expect(api.error.value).toBeNull();
    expect(calls.count).toBe(1);
  });

  test('普通 Error 包装为 AgenticClientError', async () => {
    const { client } = stubClient(async () => {
      throw new Error('list failed');
    });
    const api = useTools(client);
    await api.reload();
    expect(api.error.value).toBeInstanceOf(AgenticClientError);
    expect(api.error.value!.message).toContain('list failed');
    expect(api.loading.value).toBe(false);
    expect(api.descriptors.value).toEqual([]);
  });

  test('AgenticClientError 原样保留', async () => {
    const original = new AgenticClientError(
      'FORBIDDEN',
      403,
      'no access',
      null,
      null,
      Date.now(),
    );
    const { client } = stubClient(async () => {
      throw original;
    });
    const api = useTools(client);
    await api.reload();
    expect(api.error.value).toBe(original);
  });

  test('失败后再次 reload 成功 → error 清空、列表更新', async () => {
    let failing = true;
    const { client } = stubClient(async () => {
      if (failing) throw new Error('boom');
      return DESCRIPTORS;
    });
    const api = useTools(client);
    await api.reload();
    expect(api.error.value).not.toBeNull();

    failing = false;
    await api.reload();
    expect(api.error.value).toBeNull();
    expect(api.descriptors.value).toEqual(DESCRIPTORS);
  });
});
