import { Injectable } from '@dangao/bun-server'
import type { ParsedDocumentContent, ParserInput } from '../../common/document-types'
import type { DocumentParser } from './parser'
import { stripMarkdown } from './parser-utils'

@Injectable()
export class MarkdownParser implements DocumentParser {
  public readonly supportedExtensions = ['md', 'markdown']
  public readonly supportedMimeTypes = ['text/markdown', 'text/x-markdown']
  public readonly supported = true

  public async parse(input: ParserInput): Promise<ParsedDocumentContent> {
    const text = await input.file.text()

    return {
      text: stripMarkdown(text),
      sourceType: 'markdown',
      fileName: input.filename,
    }
  }
}
