import { Injectable } from '@dangao/bun-server'
import * as XLSX from 'xlsx'
import type { ParsedDocumentContent, ParserInput } from '../../common/document-types'
import { TableRowWindowChunker } from '../chunkers/table-row-window.chunker'
import type { DocumentParser } from './parser'
import { buildStructuredTableContent } from './table-parser-utils'

function getFileStem(filename: string): string {
  const lower = filename.toLowerCase()
  const dotIndex = lower.lastIndexOf('.')
  return dotIndex > 0 ? filename.slice(0, dotIndex) : filename
}

@Injectable()
export class CsvParser implements DocumentParser {
  public readonly supportedExtensions = ['csv']
  public readonly supportedMimeTypes = ['text/csv', 'application/csv']
  public readonly supported = true

  public constructor(private readonly tableRowWindowChunker: TableRowWindowChunker) {}

  public async parse(input: ParserInput): Promise<ParsedDocumentContent> {
    const csvText = await input.file.text()
    const workbook = XLSX.read(csvText, { type: 'string' })
    if (workbook.SheetNames.length === 1 && workbook.SheetNames[0] === 'Sheet1') {
      const sheetName = getFileStem(input.filename)
      const defaultSheet = workbook.Sheets.Sheet1
      workbook.SheetNames[0] = sheetName
      if (defaultSheet) {
        workbook.Sheets[sheetName] = defaultSheet
      }
      delete workbook.Sheets.Sheet1
    }
    return buildStructuredTableContent({
      filename: input.filename,
      sourceType: 'csv',
      workbook,
      chunkingOptions: input.chunkingOptions,
      chunker: this.tableRowWindowChunker,
    })
  }
}
