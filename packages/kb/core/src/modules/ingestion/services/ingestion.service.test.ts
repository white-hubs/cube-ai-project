import { describe, expect, test } from 'bun:test'
import { IngestionService } from './ingestion.service'
import { OverlapTextChunker } from '../chunkers/overlap-text.chunker'

function sumChunkTextLengths(chunks: unknown[] | undefined): number {
  if (!Array.isArray(chunks)) {
    return 0
  }
  return chunks.reduce<number>(
    (sum, chunk) => sum + String((chunk as { text: string }).text ?? '').length,
    0,
  )
}

class FakePrimaryParser {
  public async parse() {
    return {
      text: 'Doc title\n\nAlpha body',
      sourceType: 'pdf',
      fileName: 'demo.pdf',
      chunks: [
        {
          chunkIndex: 0,
          displayText: 'Alpha body',
          embeddingText: 'Doc title\nAlpha body',
          sectionId: 'sec-1',
          headingPath: ['Doc title'],
          pageNo: 1,
          chunkType: 'paragraph',
          orderInSection: 0,
          captionText: null,
          pictureDescription: null,
        },
      ],
    }
  }
}

class FakeStructuredTableParser {
  public async parse() {
    return {
      text: '工作表: SheetA',
      sourceType: 'xlsx',
      fileName: 'demo.xlsx',
      chunks: [
        {
          chunkIndex: 0,
          displayText: '工作表: SheetA\n行范围: 1-1\n\n| name | value |\n| --- | --- |\n| alpha | 42 |',
          embeddingText: '文件: demo.xlsx\n工作表: SheetA\n表头: name, value\n行范围: 1-1\n第1行: name=alpha; value=42',
          sectionId: 'sheet:sheeta',
          headingPath: ['SheetA'],
          pageNo: null,
          chunkType: 'table-row-window',
          orderInSection: 0,
          captionText: null,
          pictureDescription: null,
          sheetName: 'SheetA',
          tableId: 'xlsx-table-0',
          rowStart: 1,
          rowEnd: 1,
          headers: ['name', 'value'],
          keywords: ['name', 'value', 'alpha', '42'],
        },
      ],
    }
  }
}

class FakeSpecialChunkParser {
  public async parse() {
    return {
      text: '[00:00:00.000 --> 00:00:02.000]\nHello team',
      sourceType: 'vtt',
      fileName: 'demo.vtt',
      chunks: [
        {
          chunkIndex: 0,
          displayText: '[00:00:00.000 --> 00:00:02.000]\nHello team',
          embeddingText: '文件: demo.vtt\n时间: 00:00:00.000 --> 00:00:02.000\n内容: Hello team',
          sectionId: 'vtt:demo-vtt',
          headingPath: ['demo.vtt'],
          pageNo: null,
          chunkType: 'vtt-cue-window',
          orderInSection: 0,
          captionText: null,
          pictureDescription: null,
          startTime: '00:00:00.000',
          endTime: '00:00:02.000',
          cueIndex: 1,
          keywords: ['Hello', 'team'],
        },
      ],
    }
  }
}

class FakeFallbackParser {
  public parseCalls = 0

  public async parse() {
    this.parseCalls += 1
    return {
      text: 'fallback plain text',
      sourceType: 'txt',
      fileName: 'demo.txt',
    }
  }
}

class FakeBlockFriendlyTextParser {
  public async parse() {
    return {
      text: [
        '### 指令 1',
        '',
        `切换模型时间 { action: 'changeModelTime' params: { value: 'day' } }`,
        '',
        '### 指令 2',
        '',
        `切换模型天气 { action: 'changeModelWeather' params: { value: 'Sunny' } }`,
      ].join('\n'),
      sourceType: 'txt',
      fileName: 'sdk.txt',
    }
  }
}

class FakeThrowingParser {
  public async parse(): Promise<never> {
    throw new Error('docling unavailable')
  }
}

class FakeEmptyStructuredParser {
  public async parse() {
    return {
      text: '',
      sourceType: 'pdf',
      fileName: 'demo.pdf',
      chunks: [
        {
          chunkIndex: 0,
          displayText: '',
          embeddingText: '',
          sectionId: 'sec-1',
          headingPath: ['Doc title'],
          pageNo: 1,
          chunkType: 'paragraph',
          orderInSection: 0,
          captionText: null,
          pictureDescription: null,
        },
      ],
    }
  }
}

class FakeParserRegistry {
  public primaryParser: unknown
  public fallbackParser: unknown = null

  public getParser() {
    return this.primaryParser
  }

  public getFallbackParser() {
    return this.fallbackParser
  }
}

class FakeOverlapTextChunker {
  public calls: Array<Record<string, unknown>> = []

  public splitText(text: string, chunkingOptions?: { separator?: string }) {
    return typeof chunkingOptions?.separator === 'string' ? text.split(chunkingOptions.separator) : [text]
  }

  public async chunkDocument(input: Record<string, unknown>) {
    this.calls.push(input)
    return [
      {
        chunkId: '11-0',
        documentId: "11",
        chunkIndex: 0,
        text: 'fallback plain text',
        embeddingText: 'fallback plain text',
        projectId: 'p8',
        sourceType: 'txt',
        fileName: 'demo.txt',
        sectionId: 'document-root',
        headingPath: [],
        pageNo: null,
        chunkType: 'paragraph',
        orderInSection: 0,
        captionText: null,
        pictureDescription: null,
      },
    ]
  }
}

class FakeVectorizationService {
  public calls: Array<{ documentId: string; chunks: unknown[] }> = []

  public async indexDocumentChunks(documentId: string, chunks: unknown[]) {
    this.calls.push({ documentId, chunks })
  }
}

describe('IngestionService', () => {
  test('previews document chunks without calling vectorization service', async () => {
    const parserRegistry = new FakeParserRegistry()
    parserRegistry.primaryParser = new FakePrimaryParser()
    const overlapTextChunker = new FakeOverlapTextChunker()
    const vectorizationService = new FakeVectorizationService()
    const service = new IngestionService(
      parserRegistry as never,
      overlapTextChunker as never,
      vectorizationService as never,
    )

    const file = new File(['hello'], 'demo.pdf', { type: 'application/pdf' })
    const chunks = await service.previewDocumentChunks({
      document: { id: "11", name: 'demo.pdf', mime_type: 'application/pdf', project_id: 'p8' },
      file,
    } as never)

    expect(chunks).toHaveLength(1)
    expect(vectorizationService.calls).toHaveLength(0)
    expect(chunks[0]?.text).toBe('Alpha body')
  })

  test('uses structured chunks returned by parser without calling local chunker', async () => {
    const parserRegistry = new FakeParserRegistry()
    parserRegistry.primaryParser = new FakePrimaryParser()
    const overlapTextChunker = new FakeOverlapTextChunker()
    const vectorizationService = new FakeVectorizationService()
    const service = new IngestionService(
      parserRegistry as never,
      overlapTextChunker as never,
      vectorizationService as never,
    )

    const file = new File(['hello'], 'demo.pdf', { type: 'application/pdf' })
    const result = await service.ingestDocument({
      document: { id: "11", name: 'demo.pdf', mime_type: 'application/pdf', project_id: 'p8' },
      file,
    })

    expect(result.chunkCount).toBe(1)
    expect(result.totalCharCount).toBe(sumChunkTextLengths(vectorizationService.calls[0]?.chunks))
    expect(overlapTextChunker.calls).toHaveLength(0)
    expect(vectorizationService.calls).toHaveLength(1)
    expect(vectorizationService.calls[0]?.chunks).toEqual([
      expect.objectContaining({
        chunkId: '11-0',
        documentId: "11",
        chunkIndex: 0,
        text: 'Alpha body',
        embeddingText: '标题路径: Doc title\n正文: Alpha body',
        projectId: 'p8',
        sourceType: 'pdf',
        fileName: 'demo.pdf',
        sectionId: 'sec-1',
        headingPath: ['Doc title'],
        pageNo: 1,
        chunkType: 'paragraph',
        orderInSection: 0,
        captionText: null,
        pictureDescription: null,
        sheetName: null,
        tableId: null,
        rowStart: null,
        rowEnd: null,
        startTime: null,
        endTime: null,
        cueIndex: null,
        propertyNamespace: null,
        retrievalProfile: 'semantic-qa',
      }),
    ])
  })

  test('re-chunks docling structured chunks with runtime separator and overlap options', async () => {
    const parserRegistry = new FakeParserRegistry()
    parserRegistry.primaryParser = new FakePrimaryParser()
    const overlapTextChunker = new FakeOverlapTextChunker()
    const vectorizationService = new FakeVectorizationService()
    const service = new IngestionService(
      parserRegistry as never,
      overlapTextChunker as never,
      vectorizationService as never,
    )

    parserRegistry.primaryParser = {
      async parse() {
        return {
          text: 'alpha###beta###gamma',
          sourceType: 'pdf',
          fileName: 'demo.pdf',
          chunks: [
            {
              chunkIndex: 0,
              displayText: 'alpha###beta###gamma',
              embeddingText: 'Doc title\nalpha###beta###gamma',
              sectionId: 'sec-1',
              headingPath: ['Doc title'],
              pageNo: 1,
              chunkType: 'paragraph',
              orderInSection: 0,
              captionText: null,
              pictureDescription: null,
            },
          ],
        }
      },
    }

    const file = new File(['hello'], 'demo.pdf', { type: 'application/pdf' })
    const result = await service.ingestDocument({
      document: { id: "11", name: 'demo.pdf', mime_type: 'application/pdf', project_id: 'p8' },
      file,
      chunkingOptions: {
        separator: '###',
        chunkSize: 8,
        chunkOverlap: 0,
      } as never,
    } as never)

    expect(result.chunkCount).toBe(3)
    expect(result.totalCharCount).toBe(sumChunkTextLengths(vectorizationService.calls[0]?.chunks))
    expect(overlapTextChunker.calls).toHaveLength(0)
    expect(vectorizationService.calls[0]?.chunks).toEqual([
      expect.objectContaining({
        chunkId: '11-0',
        text: 'alpha',
        embeddingText: '标题路径: Doc title\n正文: alpha',
        retrievalProfile: 'semantic-qa',
      }),
      expect.objectContaining({
        chunkId: '11-1',
        text: 'beta',
        embeddingText: '标题路径: Doc title\n正文: beta',
        retrievalProfile: 'semantic-qa',
      }),
      expect.objectContaining({
        chunkId: '11-2',
        text: 'gamma',
        embeddingText: '标题路径: Doc title\n正文: gamma',
        retrievalProfile: 'semantic-qa',
      }),
    ])
  })

  test('falls back to local parser and chunker when docling parser fails', async () => {
    const parserRegistry = new FakeParserRegistry()
    parserRegistry.primaryParser = new FakeThrowingParser()
    parserRegistry.fallbackParser = new FakeFallbackParser()
    const overlapTextChunker = new FakeOverlapTextChunker()
    const vectorizationService = new FakeVectorizationService()
    const service = new IngestionService(
      parserRegistry as never,
      overlapTextChunker as never,
      vectorizationService as never,
    )

    const file = new File(['hello'], 'demo.txt', { type: 'text/plain' })
    const result = await service.ingestDocument({
      document: { id: "11", name: 'demo.txt', mime_type: 'text/plain', project_id: 'p8' },
      file,
    })

    expect(result.chunkCount).toBe(1)
    expect(result.totalCharCount).toBe(sumChunkTextLengths(vectorizationService.calls[0]?.chunks))
    expect(overlapTextChunker.calls).toHaveLength(1)
    expect(vectorizationService.calls).toHaveLength(1)
  })

  test('falls back to legacy parser when docling returns empty structured chunks', async () => {
    const parserRegistry = new FakeParserRegistry()
    parserRegistry.primaryParser = new FakeEmptyStructuredParser()
    parserRegistry.fallbackParser = new FakeFallbackParser()
    const overlapTextChunker = new FakeOverlapTextChunker()
    const vectorizationService = new FakeVectorizationService()
    const service = new IngestionService(
      parserRegistry as never,
      overlapTextChunker as never,
      vectorizationService as never,
    )

    const file = new File(['hello'], 'demo.txt', { type: 'text/plain' })
    const result = await service.ingestDocument({
      document: { id: "11", name: 'demo.txt', mime_type: 'text/plain', project_id: 'p8' },
      file,
    })

    expect(result.chunkCount).toBe(1)
    expect(result.totalCharCount).toBe(sumChunkTextLengths(vectorizationService.calls[0]?.chunks))
    expect(overlapTextChunker.calls).toHaveLength(1)
    expect(vectorizationService.calls).toHaveLength(1)
  })

  test('uses block mode for txt fallback chunking when requested', async () => {
    const parserRegistry = new FakeParserRegistry()
    parserRegistry.primaryParser = new FakeThrowingParser()
    parserRegistry.fallbackParser = new FakeBlockFriendlyTextParser()
    const overlapTextChunker = new OverlapTextChunker({
      chunkSize: 256,
      chunkOverlap: 20,
    })
    const vectorizationService = new FakeVectorizationService()
    const service = new IngestionService(
      parserRegistry as never,
      overlapTextChunker as never,
      vectorizationService as never,
    )

    const file = new File(['hello'], 'sdk.txt', { type: 'text/plain' })
    const result = await service.ingestDocument({
      document: { id: "14", name: 'sdk.txt', mime_type: file.type, project_id: 'p8' },
      file,
      chunkingOptions: { chunkSize: 256, chunkOverlap: 20, textChunkMode: 'block' } as never,
    })

    expect(result.chunkCount).toBe(2)
    expect(result.totalCharCount).toBe(sumChunkTextLengths(vectorizationService.calls[0]?.chunks))
    expect(vectorizationService.calls[0]?.chunks).toEqual([
      expect.objectContaining({
        chunkId: '14-0',
        text: expect.stringContaining('### 指令 1'),
        embeddingText: expect.stringContaining('### 指令 1'),
      }),
      expect.objectContaining({
        chunkId: '14-1',
        text: expect.stringContaining('### 指令 2'),
        embeddingText: expect.stringContaining('### 指令 2'),
      }),
    ])
  })

  test('keeps structured table chunks intact and preserves table metadata', async () => {
    const parserRegistry = new FakeParserRegistry()
    parserRegistry.primaryParser = new FakeStructuredTableParser()
    const overlapTextChunker = new FakeOverlapTextChunker()
    const vectorizationService = new FakeVectorizationService()
    const service = new IngestionService(
      parserRegistry as never,
      overlapTextChunker as never,
      vectorizationService as never,
    )

    const file = new File(['hello'], 'demo.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const result = await service.ingestDocument({
      document: { id: "12", name: 'demo.xlsx', mime_type: file.type, project_id: 'p8' },
      file,
      chunkingOptions: { separator: '###', chunkSize: 80, chunkOverlap: 0 } as never,
    })

    expect(result.chunkCount).toBe(1)
    expect(result.totalCharCount).toBe(sumChunkTextLengths(vectorizationService.calls[0]?.chunks))
    expect(overlapTextChunker.calls).toHaveLength(0)
    expect(vectorizationService.calls[0]?.chunks[0]).toEqual(expect.objectContaining({
      chunkType: 'table-row-window',
      sheetName: 'SheetA',
      tableId: 'xlsx-table-0',
      rowStart: 1,
      rowEnd: 1,
      headers: ['name', 'value'],
      keywords: ['name', 'value', 'alpha', '42'],
      embeddingText: '文件: demo.xlsx\n工作表: SheetA\n表头: name, value\n行范围: 1-1\n第1行: name=alpha; value=42',
    }))
  })

  test('keeps special chunks intact and preserves cue metadata', async () => {
    const parserRegistry = new FakeParserRegistry()
    parserRegistry.primaryParser = new FakeSpecialChunkParser()
    const overlapTextChunker = new FakeOverlapTextChunker()
    const vectorizationService = new FakeVectorizationService()
    const service = new IngestionService(
      parserRegistry as never,
      overlapTextChunker as never,
      vectorizationService as never,
    )

    const file = new File(['hello'], 'demo.vtt', { type: 'text/vtt' })
    const result = await service.ingestDocument({
      document: { id: "13", name: 'demo.vtt', mime_type: file.type, project_id: 'p8' },
      file,
      chunkingOptions: { separator: '\n\n', chunkSize: 80, chunkOverlap: 0 } as never,
    })

    expect(result.chunkCount).toBe(1)
    expect(result.totalCharCount).toBe(sumChunkTextLengths(vectorizationService.calls[0]?.chunks))
    expect(overlapTextChunker.calls).toHaveLength(0)
    expect(vectorizationService.calls[0]?.chunks[0]).toEqual(expect.objectContaining({
      chunkType: 'vtt-cue-window',
      startTime: '00:00:00.000',
      endTime: '00:00:02.000',
      cueIndex: 1,
      keywords: ['Hello', 'team'],
    }))
  })
})
