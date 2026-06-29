import { BadRequestException } from "@dangao/bun-server";
import * as XLSX from "xlsx";
import { type WorkBook, type WorkSheet } from "xlsx";

import { type ChunkingOptions, type ParsedDocumentContent } from "../../common/document-types";
import { type TableRowWindowChunker } from "../chunkers/table-row-window.chunker";

export interface BuildStructuredTableContentInput {
  filename: string;
  sourceType: string;
  workbook: WorkBook;
  chunkingOptions?: ChunkingOptions;
  chunker: TableRowWindowChunker;
}

interface WorkbookSheetVisibility {
  Hidden?: number;
  name?: string;
}

function normalizeCell(value: string | number | boolean | null | undefined): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function normalizeHeaders(row: string[]): string[] {
  return row.map((header, index) => {
    const trimmed = header.trim();
    return trimmed !== "" ? trimmed : `column_${index + 1}`;
  });
}

function normalizeRow(row: (string | number | boolean | null)[]): string[] {
  return row.map((cell) => normalizeCell(cell));
}

function readSheetRows(worksheet: WorkSheet): string[][] {
  const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(worksheet, {
    blankrows: false,
    defval: "",
    header: 1,
    raw: false,
  });

  return rows.map((row) => normalizeRow(row)).filter((row) => row.some((cell) => cell !== ""));
}

function trimTrailingEmptyColumns(rows: string[][]): string[][] {
  const maxColumnIndex = rows.reduce((currentMax, row) => {
    const lastNonEmptyIndex = row.reduce((rowMax, cell, index) => (cell.trim() !== "" ? index : rowMax), -1);
    return Math.max(currentMax, lastNonEmptyIndex);
  }, -1);

  if (maxColumnIndex < 0) {
    return rows;
  }

  return rows.map((row) => row.slice(0, maxColumnIndex + 1));
}

function isHiddenSheet(workbook: WorkBook, sheetName: string): boolean {
  const workbookSheets = workbook.Workbook?.Sheets as WorkbookSheetVisibility[] | undefined;
  const matchedSheet = workbookSheets?.find((sheet) => sheet.name === sheetName);
  return (matchedSheet?.Hidden ?? 0) !== 0;
}

function buildReferenceSheetHeaders(rows: string[][]): string[] {
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return Array.from({ length: columnCount }, (_ignore, index) => {
    const fallbackValue = rows.map((row) => (row[index] ?? "").trim()).find((value) => value !== "");
    return fallbackValue ?? `option_${index + 1}`;
  });
}

export function buildStructuredTableContent(input: BuildStructuredTableContentInput): ParsedDocumentContent {
  const chunks = input.workbook.SheetNames.flatMap((sheetName, sheetIndex) => {
    const worksheet = input.workbook.Sheets[sheetName];
    if (!worksheet) {
      return [];
    }
    const rows = trimTrailingEmptyColumns(readSheetRows(worksheet));
    if (rows.length === 0) {
      return [];
    }
    const hiddenSheet = isHiddenSheet(input.workbook, sheetName);
    const [headerRow, ...bodyRows] = rows;
    const headers = hiddenSheet ? buildReferenceSheetHeaders(rows) : normalizeHeaders(headerRow ?? []);
    const normalizedRows = (hiddenSheet ? rows : bodyRows.length > 0 ? bodyRows : [headerRow ?? []])
      .map((row) => headers.map((_, index) => row[index] ?? ""))
      .filter((row) => row.some((cell) => cell.trim() !== ""));
    if (normalizedRows.length === 0) {
      return [];
    }
    return input.chunker.chunk(
      {
        filename: input.filename,
        headers,
        headingPath: [sheetName],
        rows: normalizedRows,
        sheetName,
        sourceType: input.sourceType,
        tableId: `${input.sourceType}-table-${sheetIndex}`,
      },
      input.chunkingOptions,
    );
  });

  if (chunks.length === 0) {
    throw new BadRequestException(`表格文件未提取到有效内容: ${input.filename}`);
  }

  return {
    chunks,
    fileName: input.filename,
    sourceType: input.sourceType,
    text: chunks.map((chunk) => chunk.displayText).join("\n\n"),
  };
}
