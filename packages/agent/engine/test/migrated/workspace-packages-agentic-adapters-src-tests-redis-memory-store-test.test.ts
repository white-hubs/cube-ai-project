import { describe, test } from 'bun:test';

const includeWorkspaceTests = process.env.CUBE_ENGINE_INCLUDE_WORKSPACE_TESTS === '1';

if (includeWorkspaceTests) {
  await import('../../src/adapters/__tests__/redis-memory-store.test.ts');
} else {
  describe.skip('migrated workspace coverage: packages/agentic-adapters/src/__tests__/redis-memory-store.test.ts', () => {
    test('set CUBE_ENGINE_INCLUDE_WORKSPACE_TESTS=1 to run from engine', () => {});
  });
}
