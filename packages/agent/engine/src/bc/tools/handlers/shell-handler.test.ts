/**
 * ShellHandler 单测。
 */
import { describe, test, expect } from 'bun:test';
import type { SafetyModule } from '@tachu/core';
import { ShellHandler } from './shell-handler';
import { AgenticEngineError } from '../../../infra/errors/agentic-error';
import type { ToolHandlerCtx } from '../tool-context';

const safetyPass: Pick<SafetyModule, 'checkBaseline'> = {
  checkBaseline: async () => ({ passed: true, violations: [] }),
};

const MOCK_CTX: ToolHandlerCtx = {
  traceId: 'test-trace',
  signal:  new AbortController().signal,
  auth:    { tenant: 1, user: { userId: '1', scopes: [] } },
  session: { id: '1234567890123456789', turnId: '1234567890123456788' },
};

describe('ShellHandler', () => {
  test('kind === shell', () => {
    expect(new ShellHandler(safetyPass as SafetyModule).kind).toBe('shell');
  });

  test('黑名单命令 rm → PERMISSION_DENIED', async () => {
    const handler = new ShellHandler(safetyPass as SafetyModule);
    await expect(handler.invoke({ command: 'rm -rf /' }, MOCK_CTX)).rejects.toThrow(
      AgenticEngineError,
    );
    try {
      await handler.invoke({ command: 'rm -rf /' }, MOCK_CTX);
    } catch (e) {
      expect((e as AgenticEngineError).code).toContain('PERMISSION_DENIED');
    }
  });

  test('echo hello → exitCode 0 且 stdout 含 hello', async () => {
    const handler = new ShellHandler(safetyPass as SafetyModule);
    const out = await handler.invoke({ command: 'echo', args: ['hello'] }, MOCK_CTX);
    expect(out.exitCode).toBe(0);
    expect(out.stdout.trim()).toBe('hello');
  });

  test('Safety 基线拦截 → INVALID_ARGUMENT_SAFETY_REJECTED', async () => {
    const handler = new ShellHandler({
      checkBaseline: async () => ({
        passed: false,
        violations: [
          { policyId: 'x', severity: 'error', message: 'no shell for you' },
        ],
      }),
    } as unknown as SafetyModule);
    await expect(
      handler.invoke({ command: 'echo', args: ['x'] }, MOCK_CTX),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT_SAFETY_REJECTED' });
  });
});
