import { BadRequestException, Injectable } from '@dangao/bun-server'
import mammoth from 'mammoth'
import type { ParsedDocumentContent, ParserInput } from '../../common/document-types'
import { normalizePlainText } from './parser-utils'
import type { DocumentParser } from './parser'

@Injectable()
export class DocxParser implements DocumentParser {
  public readonly supportedExtensions = ['docx']
  public readonly supportedMimeTypes = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ]
  public readonly supported = true

  public async parse(input: ParserInput): Promise<ParsedDocumentContent> {
    const result = await mammoth.extractRawText({
      buffer: Buffer.from(await input.file.arrayBuffer()),
    })
    const text = normalizePlainText(result.value)
    if (!text) {
      throw new BadRequestException(`DOCX 文件未提取到文本内容: ${input.filename}`)
    }
    return {
      text,
      sourceType: 'docx',
      fileName: input.filename,
    }
  }
}
