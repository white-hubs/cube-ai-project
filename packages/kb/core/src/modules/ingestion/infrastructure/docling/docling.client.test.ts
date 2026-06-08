import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { DoclingClient } from './docling.client'
import { makeMockAppConfig } from '../../../../test-helpers/mock-app-config'

describe('DoclingClient', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = mock() as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('posts file to official docling-serve hybrid chunk endpoint and normalizes chunks', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          chunks: [
            {
              filename: 'demo.pdf',
              chunk_index: 0,
              text: 'Doc title\nAlpha body',
              raw_text: 'Alpha body',
              headings: ['Doc title'],
              captions: ['Figure 1'],
              doc_items: ['#/texts/0'],
              page_numbers: [1],
              metadata: {
                kind: 'picture',
                picture_description: 'An annotated architecture diagram.',
              },
            },
          ],
          documents: [
            {
              content: {
                filename: 'demo.pdf',
                text_content: 'Doc title\n\nAlpha body',
              },
              status: 'success',
              errors: [],
              timings: {},
            },
          ],
          processing_time: 0.12,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    const client = new DoclingClient(makeMockAppConfig(), {
      baseUrl: 'http://127.0.0.1:3900',
      timeoutMs: 5_000,
      apiKey: 'secret',
      enablePictureDescription: true,
      maxChunkTokens: 256,
    })

    const file = new File(['hello'], 'demo.pdf', { type: 'application/pdf' })
    const result = await client.parseAndChunk({
      file,
      filename: file.name,
      mimeType: file.type,
      chunkingOptions: {
        chunkSize: 128,
      } as never,
    } as never)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('http://127.0.0.1:3900/v1/chunk/hybrid/file')
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>)?.Authorization).toBe('Bearer secret')
    const body = init?.body as FormData
    expect(body.get('target_type')).toBe('inbody')
    expect(body.get('include_converted_doc')).toBe('true')
    expect(body.get('convert_do_picture_description')).toBe('true')
    expect(body.get('chunking_include_raw_text')).toBe('true')
    expect(body.get('chunking_merge_peers')).toBe('true')
    expect(body.get('chunking_max_tokens')).toBe('128')
    expect(result.text).toBe('Doc title\n\nAlpha body')
    expect(result.chunks).toEqual([
      {
        chunkIndex: 0,
        displayText: 'Alpha body',
        embeddingText: 'Doc title\nAlpha body',
        sectionId: 'heading:doc-title',
        headingPath: ['Doc title'],
        pageNo: 1,
        chunkType: 'picture',
        orderInSection: 0,
        captionText: 'Figure 1',
        pictureDescription: 'An annotated architecture diagram.',
      },
    ])
  })

  test('retries without picture description when docling model is missing', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          "Model 'HuggingFaceTB/SmolVLM-256M-Instruct' not found in artifacts_path.",
          { status: 404, headers: { 'content-type': 'text/plain' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            chunks: [
              {
                filename: 'demo.pdf',
                chunk_index: 0,
                text: 'Doc title\nAlpha body',
                raw_text: 'Alpha body',
                headings: ['Doc title'],
                captions: null,
                doc_items: ['#/texts/0'],
                page_numbers: [1],
                metadata: null,
              },
            ],
            documents: [
              {
                content: {
                  filename: 'demo.pdf',
                  text_content: 'Doc title\n\nAlpha body',
                },
                status: 'success',
                errors: [],
                timings: {},
              },
            ],
            processing_time: 0.12,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )

    const client = new DoclingClient(makeMockAppConfig(), {
      baseUrl: 'http://127.0.0.1:5001',
      timeoutMs: 5_000,
      enablePictureDescription: true,
      maxChunkTokens: 256,
    })

    const file = new File(['hello'], 'demo.pdf', { type: 'application/pdf' })
    const result = await client.parseAndChunk({
      file,
      filename: file.name,
      mimeType: file.type,
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstBody = fetchMock.mock.calls[0]?.[1]?.body as FormData
    const secondBody = fetchMock.mock.calls[1]?.[1]?.body as FormData
    expect(firstBody.get('convert_do_picture_description')).toBe('true')
    expect(secondBody.get('convert_do_picture_description')).toBe('false')
    expect(result.text).toBe('Doc title\n\nAlpha body')
    expect(result.chunks?.[0]?.displayText).toBe('Alpha body')
  })
})
