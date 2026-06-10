import { describe, test } from 'bun:test';

const includeWorkspaceTests = process.env.CUBE_ENGINE_INCLUDE_WORKSPACE_TESTS === '1';

if (includeWorkspaceTests) {
  await import('../../../../../infra/bun-server-ext/outbox/test/integration/outbox-flow.testcontainers.test.ts');
} else {
  describe.skip('migrated workspace coverage: packages/bun-server-ext-outbox/test/integration/outbox-flow.testcontainers.test.ts', () => {
    test('set CUBE_ENGINE_INCLUDE_WORKSPACE_TESTS=1 to run from engine', () => {});
  });
}
