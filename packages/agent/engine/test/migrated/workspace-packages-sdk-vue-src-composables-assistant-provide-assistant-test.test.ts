import { describe, test } from 'bun:test';

const includeWorkspaceTests = process.env.CUBE_ENGINE_INCLUDE_WORKSPACE_TESTS === '1';

if (includeWorkspaceTests) {
  await import('../../../sdk-client-vue/src/composables/assistant/provide-assistant.test.ts');
} else {
  describe.skip('migrated workspace coverage: packages/sdk-vue/src/composables/assistant/provide-assistant.test.ts', () => {
    test('set CUBE_ENGINE_INCLUDE_WORKSPACE_TESTS=1 to run from engine', () => {});
  });
}
