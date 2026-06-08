import { Injectable } from '@dangao/bun-server'
import type { ParsedDocumentContent, ParserInput } from '../../common/document-types'
import { DoclingClient } from '../infrastructure/docling/docling.client'
import type { DocumentParser } from './parser'

function preprocessMdx(input: string): string {
  return input
    .replace(/^[ \t]*import\s.+$/gmu, '')
    .replace(/^[ \t]*export\s.+$/gmu, '')
    .replace(/<[^>\n]+\/>/g, ' ')
    .replace(/<([A-Z][^>\n]*)>[\s\S]*?<\/[A-Z][^>]*>/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function replaceExtension(filename: string, extension: string): string {
  return filename.replace(/\.[^.]+$/u, extension)
}

@Injectable()
export class MdxParser implements DocumentParser {
  public readonly supportedExtensions = ['mdx']
  public readonly supportedMimeTypes = ['text/mdx', 'application/mdx']
  public readonly supported = true

  public constructor(private readonly doclingClient: DoclingClient) {}

  public async parse(input: ParserInput): Promise<ParsedDocumentContent> {
    const normalizedMarkdown = preprocessMdx(await input.file.text())
    const markdownFile = new File([normalizedMarkdown], replaceExtension(input.filename, '.md'), {
      type: 'text/markdown',
    })
    return this.doclingClient.parseAndChunk({
      file: markdownFile,
      filename: markdownFile.name,
      mimeType: markdownFile.type,
      chunkingOptions: input.chunkingOptions,
    })
  }
}
