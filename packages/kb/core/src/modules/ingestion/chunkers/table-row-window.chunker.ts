import { Injectable } from '@dangao/bun-server'
import type { ChunkingOptions, ParsedDocumentChunk, TableChunkMode } from '../../common/document-types'

export interface TableRowWindowChunkInput {
  filename: string
  sourceType: string
  sheetName: string
  tableId?: string
  headers: string[]
  rows: string[][]
  headingPath?: string[]
}

const DEFAULT_ROWS_PER_CHUNK = 3
const DEFAULT_ROW_OVERLAP = 1

function slugify(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizeCell(value: string | undefined, index: number): string {
  const trimmed = (value ?? '').trim()
  return trimmed !== '' ? trimmed : `column_${index + 1}`
}

function buildRowSummary(headers: string[], row: string[], rowNumber: number): string {
  const pairs = headers
    .map((header, cellIndex) => ({ header, value: (row[cellIndex] ?? '').trim() }))
    .filter((entry) => entry.value !== '')
    .map((entry) => `${entry.header}=${entry.value}`)
    .join('; ')
  return pairs === '' ? `第${rowNumber}行: 空记录` : `第${rowNumber}行: ${pairs}`
}

function buildRowSignalSummary(headers: string[], row: string[]): string {
  return headers
    .map((header, cellIndex) => ({ header, value: (row[cellIndex] ?? '').trim() }))
    .filter((entry) => entry.value !== '')
    .slice(0, 2)
    .map((entry) => `${entry.header}=${entry.value}`)
    .join('; ')
}

function buildDisplayText(input: {
  sheetName: string
  headers: string[]
  rows: string[][]
  rowStart: number
  rowEnd: number
}): string {
  const rowTexts = input.rows.map((row, index) => buildRowSummary(input.headers, row, input.rowStart + index))
  const headerLine = input.rows.length > 1 ? [`表头: ${input.headers.join(', ')}`] : []
  return [
    `工作表: ${input.sheetName}`,
    `行范围: ${input.rowStart}-${input.rowEnd}`,
    '',
    ...headerLine,
    ...rowTexts,
  ].join('\n')
}

function buildEmbeddingText(input: {
  filename: string
  sheetName: string
  headers: string[]
  rows: string[][]
  rowStart: number
  rowEnd: number
}): string {
  const rowTexts = input.rows.map((row, index) => buildRowSummary(input.headers, row, input.rowStart + index))
  const signalTexts = input.rows
    .map((row) => buildRowSignalSummary(input.headers, row))
    .filter((summary) => summary !== '')

  return [
    ...rowTexts,
    ...(signalTexts.length > 0 ? ['', `关键词: ${signalTexts.join(' | ')}`] : []),
    `工作表: ${input.sheetName}`,
    `表头: ${input.headers.join(', ')}`,
    `文件: ${input.filename}`,
    `行范围: ${input.rowStart}-${input.rowEnd}`,
  ].join('\n')
}

function buildKeywords(headers: string[], rows: string[][]): string[] {
  const values = new Set<string>(headers)
  for (const row of rows) {
    for (const cell of row) {
      const normalized = cell.trim()
      if (normalized !== '' && normalized.length <= 64) {
        values.add(normalized)
      }
    }
  }
  return Array.from(values)
}

function countNonEmptyCells(row: string[]): number {
  return row.filter((cell) => cell.trim() !== '').length
}

function getColumnValues(rows: string[][], columnIndex: number): string[] {
  return rows
    .map((row) => (row[columnIndex] ?? '').trim())
    .filter((value) => value !== '')
}

function calculateNonEmptyRatio(rows: string[][], columnIndex: number): number {
  if (rows.length === 0) {
    return 0
  }
  return getColumnValues(rows, columnIndex).length / rows.length
}

function resolveTableChunkMode(chunkingOptions?: ChunkingOptions): TableChunkMode {
  return chunkingOptions?.tableChunkMode ?? 'auto'
}

function calculateDistinctRatio(values: string[]): number {
  if (values.length === 0) {
    return 0
  }
  return new Set(values).size / values.length
}

function calculateKeyColumnCount(rows: string[][], columnIndexes: number[]): number {
  return columnIndexes.filter((columnIndex) => {
    const nonEmptyRatio = calculateNonEmptyRatio(rows, columnIndex)
    const distinctRatio = calculateDistinctRatio(getColumnValues(rows, columnIndex))
    return nonEmptyRatio >= 0.9 && distinctRatio >= 0.8
  }).length
}

function shouldUseSingleRowChunks(headers: string[], rows: string[][]): boolean {
  if (rows.length === 0) {
    return false
  }

  const headerCount = headers.length
  const averageFilledCells = rows.reduce((sum, row) => sum + countNonEmptyCells(row), 0) / rows.length
  const sparsity = 1 - (averageFilledCells / headers.length)
  const firstColumnDistinctRatio = calculateDistinctRatio(getColumnValues(rows, 0))
  const firstColumnNonEmptyRatio = calculateNonEmptyRatio(rows, 0)
  const maxFilledCellsForSingleRow = Math.max(2.5, headerCount * 0.45)
  const keyColumnCount = calculateKeyColumnCount(rows, [0, 1, 2].filter((index) => index < headerCount))

  if (firstColumnNonEmptyRatio >= 0.95
    && averageFilledCells <= maxFilledCellsForSingleRow
    && sparsity >= 0.55
    && firstColumnDistinctRatio >= 0.8) {
    return true
  }

  return headerCount >= 8
    && firstColumnNonEmptyRatio >= 0.95
    && keyColumnCount >= 2
    && averageFilledCells <= headerCount * 0.75
    && firstColumnDistinctRatio >= 0.8
}

function resolveRowsPerChunk(chunkingOptions: ChunkingOptions | undefined, headers: string[], rows: string[][]): number {
  const tableChunkMode = resolveTableChunkMode(chunkingOptions)
  if (tableChunkMode === 'row') {
    return 1
  }
  if (tableChunkMode === 'auto' && shouldUseSingleRowChunks(headers, rows)) {
    return 1
  }

  const headerCount = headers.length
  const chunkSize = chunkingOptions?.chunkSize ?? 800
  let rowsPerChunk = DEFAULT_ROWS_PER_CHUNK
  if (chunkSize <= 220) {
    rowsPerChunk = 1
  } else if (chunkSize <= 480) {
    rowsPerChunk = 2
  }

  if (headerCount >= 10) {
    return Math.min(rowsPerChunk, 2)
  }
  if (headerCount >= 6) {
    return Math.min(rowsPerChunk, DEFAULT_ROWS_PER_CHUNK)
  }
  return rowsPerChunk
}

function resolveRowOverlap(headerCount: number, rowsPerChunk: number): number {
  if (rowsPerChunk <= 2) {
    return 0
  }
  if (headerCount >= 6) {
    return 0
  }
  return Math.min(DEFAULT_ROW_OVERLAP, rowsPerChunk - 1)
}

@Injectable()
export class TableRowWindowChunker {
  public chunk(input: TableRowWindowChunkInput, chunkingOptions?: ChunkingOptions): ParsedDocumentChunk[] {
    const normalizedHeaders = input.headers.map(normalizeCell)
    const rowsPerChunk = resolveRowsPerChunk(chunkingOptions, normalizedHeaders, input.rows)
    const rowOverlap = resolveRowOverlap(normalizedHeaders.length, rowsPerChunk)
    const headingPath = input.headingPath?.length ? input.headingPath : [input.sheetName]
    const sectionId = `sheet:${slugify(input.sheetName) || 'sheet'}`
    const chunks: ParsedDocumentChunk[] = []

    for (let startIndex = 0; startIndex < input.rows.length; startIndex += Math.max(rowsPerChunk - rowOverlap, 1)) {
      const slice = input.rows.slice(startIndex, startIndex + rowsPerChunk)
      if (slice.length === 0) {
        continue
      }
      const rowStart = startIndex + 1
      const rowEnd = rowStart + slice.length - 1
      const displayText = buildDisplayText({
        sheetName: input.sheetName,
        headers: normalizedHeaders,
        rows: slice,
        rowStart,
        rowEnd,
      })
      chunks.push({
        chunkIndex: chunks.length,
        displayText,
        embeddingText: buildEmbeddingText({
          filename: input.filename,
          sheetName: input.sheetName,
          headers: normalizedHeaders,
          rows: slice,
          rowStart,
          rowEnd,
        }),
        sectionId,
        headingPath,
        pageNo: null,
        chunkType: 'table-row-window',
        orderInSection: chunks.length,
        captionText: null,
        pictureDescription: null,
        sheetName: input.sheetName,
        tableId: input.tableId ?? `${sectionId}:table-0`,
        rowStart,
        rowEnd,
        headers: normalizedHeaders,
        keywords: buildKeywords(normalizedHeaders, slice),
      })
      if (rowEnd >= input.rows.length) {
        break
      }
    }

    return chunks
  }
}
