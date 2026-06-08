import { describe, expect, test } from 'bun:test'
import { PropertiesGroupChunker } from '../chunkers/properties-group.chunker'
import { VttWindowChunker } from '../chunkers/vtt-window.chunker'
import { MdxParser } from './mdx.parser'
import { PropertiesParser } from './properties.parser'
import { VttParser } from './vtt.parser'

class FakeDoclingClient {
  public readonly inputs: Array<{ filename: string; mimeType: string; text: string }> = []

  public async parseAndChunk(input: { file: File; filename: string; mimeType: string }) {
    this.inputs.push({
      filename: input.filename,
      mimeType: input.mimeType,
      text: await input.file.text(),
    })
    return {
      text: 'Docling normalized text',
      sourceType: 'markdown',
      fileName: input.filename,
      chunks: [
        {
          chunkIndex: 0,
          displayText: 'Docling normalized text',
          embeddingText: 'Heading\nDocling normalized text',
          sectionId: 'heading:docling',
          headingPath: ['Heading'],
          pageNo: null,
          chunkType: 'paragraph',
          orderInSection: 0,
          captionText: null,
          pictureDescription: null,
        },
      ],
    }
  }
}

describe('special parsers', () => {
  test('vtt parser groups cues into time-window chunks', async () => {
    const parser = new VttParser(new VttWindowChunker())
    const file = new File([
      'WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.000\nHello team\n\n2\n00:00:03.000 --> 00:00:05.000\nSystem ready\n',
    ], 'demo.vtt', { type: 'text/vtt' })

    const result = await parser.parse({
      file,
      filename: file.name,
      mimeType: file.type,
    })

    expect(result.chunks).toHaveLength(2)
    expect(result.chunks?.[0]).toEqual(expect.objectContaining({
      chunkType: 'vtt-cue-window',
      cueIndex: 1,
      startTime: '00:00:00.000',
      endTime: '00:00:02.000',
    }))
    expect(result.chunks?.[1]?.embeddingText).toContain('System ready')
  })

  test('properties parser groups keys by namespace', async () => {
    const parser = new PropertiesParser(new PropertiesGroupChunker())
    const file = new File([
      'db.url=jdbc:mysql://localhost/app\n' +
      'db.user=root\n' +
      'redis.host=127.0.0.1\n',
    ], 'application.properties', { type: 'text/plain' })

    const result = await parser.parse({
      file,
      filename: file.name,
      mimeType: file.type,
    })

    expect(result.chunks).toHaveLength(2)
    expect(result.chunks?.[0]).toEqual(expect.objectContaining({
      chunkType: 'properties-group',
      propertyNamespace: 'db',
    }))
    expect(result.chunks?.[0]?.embeddingText).toContain('db.url=jdbc:mysql://localhost/app')
    expect(result.chunks?.[1]?.propertyNamespace).toBe('redis')
  })

  test('mdx parser strips jsx noise before delegating to docling', async () => {
    const doclingClient = new FakeDoclingClient()
    const parser = new MdxParser(doclingClient as never)
    const file = new File([
      '# Hello\n\n<Card title="demo">content</Card>\n\nexport const meta = { title: "demo" }\n',
    ], 'demo.mdx', { type: 'text/mdx' })

    const result = await parser.parse({
      file,
      filename: file.name,
      mimeType: file.type,
    })

    expect(doclingClient.inputs).toHaveLength(1)
    expect(doclingClient.inputs[0]?.filename).toBe('demo.md')
    expect(doclingClient.inputs[0]?.mimeType).toBe('text/markdown')
    expect(doclingClient.inputs[0]?.text).toContain('# Hello')
    expect(doclingClient.inputs[0]?.text).not.toContain('<Card')
    expect(doclingClient.inputs[0]?.text).not.toContain('export const meta')
    expect(result.chunks?.[0]?.displayText).toBe('Docling normalized text')
  })
})
