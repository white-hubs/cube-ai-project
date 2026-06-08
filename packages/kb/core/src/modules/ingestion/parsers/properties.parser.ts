import { BadRequestException, Injectable } from '@dangao/bun-server'
import type { ParsedDocumentContent, ParserInput } from '../../common/document-types'
import { PropertiesGroupChunker, type PropertyEntry } from '../chunkers/properties-group.chunker'
import type { DocumentParser } from './parser'

function parseProperties(text: string): PropertyEntry[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#') && !line.startsWith('!'))
    .map((line) => {
      const separatorIndex = line.search(/[:=]/)
      if (separatorIndex < 0) {
        return { key: line, value: '' }
      }
      return {
        key: line.slice(0, separatorIndex).trim(),
        value: line.slice(separatorIndex + 1).trim(),
      }
    })
    .filter((entry) => entry.key !== '')
}

@Injectable()
export class PropertiesParser implements DocumentParser {
  public readonly supportedExtensions = ['properties']
  public readonly supportedMimeTypes = ['text/properties', 'application/x-java-properties', 'text/x-java-properties']
  public readonly supported = true

  public constructor(private readonly propertiesGroupChunker: PropertiesGroupChunker) {}

  public async parse(input: ParserInput): Promise<ParsedDocumentContent> {
    const entries = parseProperties(await input.file.text())
    if (entries.length === 0) {
      throw new BadRequestException(`PROPERTIES 文件未提取到 key-value 内容: ${input.filename}`)
    }
    const chunks = this.propertiesGroupChunker.chunk(input.filename, entries)
    return {
      text: chunks.map((chunk) => chunk.displayText).join('\n\n'),
      sourceType: 'properties',
      fileName: input.filename,
      chunks,
    }
  }
}
