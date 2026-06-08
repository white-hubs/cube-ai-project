import { MockRegistry } from '@/infra/mock-endpoint'

const r = MockRegistry.getInstance()
const iso = '2025-01-01T00:00:00.000Z'

/* documents */
r.define('kb.documents.preview', false, () => ({ chunkCount: 0, items: [] }))
r.define(
  'kb.documents.upload',
  false,
  () => ({
    documentId: crypto.randomUUID(),
    importJobId: 'mock-job',
    status: 'indexed',
    supportedForParsing: true,
  }),
)
r.define('kb.documents.list', false, () => ({ items: [] }))
r.define('kb.documents.previewById', false, () => ({ chunkCount: 0, items: [] }))
r.define('kb.documents.remove', false, () => ({ ok: true as const }))
r.define('kb.documents.listChunks', false, () => ({ items: [] }))
r.define('kb.documents.updateChunk', false, (_ctx, args) => {
  const chunkId = String((args as unknown[])[2] ?? 'mock-chunk')
  return {
    chunkId,
    chunkIndex: 0,
    text: 'mock',
    charCount: 4,
    recallCount: 0,
    embeddingText: 'mock',
    headingPath: [] as string[],
    sectionId: 'mock',
    pageNo: null as number | null,
    chunkType: 'text',
    orderInSection: 0,
    captionText: null,
    pictureDescription: null,
  }
})
r.define(
  'kb.documents.reindex',
  false,
  () => ({
    documentId: 'mock-doc',
    importJobId: 'mock-job',
    status: 'indexed',
    supportedForParsing: true,
  }),
)

/* directories */
r.define('kb.directories.create', false, () => ({ id: crypto.randomUUID() }))
r.define(
  'kb.directories.list',
  false,
  () => ({
    items: [] as unknown[],
    total: 0,
    pages: 0,
  }),
)
r.define('kb.directories.remove', false, () => ({ ok: true as const }))
r.define(
  'kb.directories.update',
  false,
  (_ctx: unknown, args: unknown) => ({
    id: String((args as unknown[])[0] ?? 'dir'),
    name: 'mock-dir',
    description: null as string | null,
    icon: null as string | null,
    documentCount: 0,
    totalSizeBytes: 0,
    updateTime: iso,
  }),
)
r.define(
  'kb.directories.updateByPost',
  false,
  (_ctx: unknown, args: unknown) => ({
    id: String((args as unknown[])[0] ?? 'dir'),
    name: 'mock-dir',
    description: null as string | null,
    icon: null as string | null,
    documentCount: 0,
    totalSizeBytes: 0,
    updateTime: iso,
  }),
)
r.define(
  'kb.directories.listDocuments',
  false,
  () => ({
    items: [] as unknown[],
    total: 0,
    pages: 0,
  }),
)

/* search */
r.define('kb.search.search', false, () => ({ items: [] }))
r.define('kb.search.searchByDocuments', false, () => ({ items: [] }))
r.define('kb.search.searchByDirectory', false, () => ({ items: [] }))
