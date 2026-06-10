import { describe, test } from 'bun:test';

const includeWorkspaceTests = process.env.CUBE_ENGINE_INCLUDE_WORKSPACE_TESTS === '1';

if (includeWorkspaceTests) {
  await import('../../../../platform-adapters/ghcloud/src/flow/flow.adapter.test.ts');
} else {
  describe.skip('migrated workspace coverage: packages/platform-adapters-ghcloud/src/flow/flow.adapter.test.ts', () => {
    test('set CUBE_ENGINE_INCLUDE_WORKSPACE_TESTS=1 to run from engine', () => {});
  });
}
