import { describe, test } from 'bun:test';

const includeWorkspaceTests = process.env.CUBE_ENGINE_INCLUDE_WORKSPACE_TESTS === '1';

if (includeWorkspaceTests) {
  await import('../../../sdk-client/test/integration/end-to-end.testcontainers.test.ts');
} else {
  describe.skip('migrated workspace coverage: packages/sdk-core/test/integration/end-to-end.testcontainers.test.ts', () => {
    test('set CUBE_ENGINE_INCLUDE_WORKSPACE_TESTS=1 to run from engine', () => {});
  });
}
