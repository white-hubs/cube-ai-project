import { join } from 'node:path';

const pkgRoot = join(import.meta.dir, '../..');

export const flowCoreFixturePaths = {
  langflowApiAllPath: join(pkgRoot, 'data/langflow-api-all.json'),
  componentCatalogPath: join(pkgRoot, 'generated/cube-component-catalog.json'),
  mockLangflowDir: join(pkgRoot, 'test-fixtures/mock-langflow'),
  apiAllPath: join(pkgRoot, 'test-fixtures/mock-langflow/api-all.json'),
  goldenFlowPath: join(pkgRoot, 'test-fixtures/mock-langflow/flow-70982da6-602e-4aeb-a1b4-0e2079c6b172.json'),
  promptGoldenFlowPath: join(pkgRoot, 'test-fixtures/mock-langflow/flow-prompt-custom-fields-golden.json'),
};
