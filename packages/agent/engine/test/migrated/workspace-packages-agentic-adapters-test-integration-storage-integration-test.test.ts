import { describe, test } from 'bun:test';

const includeWorkspaceTests = process.env.CUBE_ENGINE_INCLUDE_WORKSPACE_TESTS === '1';

if (includeWorkspaceTests) {
  await import('../../src/adapters/test/integration/storage.integration.test.ts');
} else {
  describe.skip('migrated workspace coverage: packages/agentic-adapters/test/integration/storage.integration.test.ts', () => {
    test('set CUBE_ENGINE_INCLUDE_WORKSPACE_TESTS=1 to run from engine', () => {});
  });
}
