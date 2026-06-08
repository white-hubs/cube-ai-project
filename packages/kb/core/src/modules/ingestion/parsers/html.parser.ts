import { Injectable } from '@dangao/bun-server'
import type { ParsedDocumentContent, ParserInput } from '../../common/document-types'
import type { DocumentParser } from './parser'
import { stripHtml } from './parser-utils'

@Injectable()
export class HtmlParser implements DocumentParser {
  public readonly supportedExtensions = ['html', 'htm']
  public readonly supportedMimeTypes = ['text/html', 'application/xhtml+xml']
  public readonly supported = true

  public async parse(input: ParserInput): Promise<ParsedDocumentContent> {
    const text = await input.file.text()

    return {
      text: stripHtml(text),
      sourceType: 'html',
      fileName: input.filename,
    }
  }
}
