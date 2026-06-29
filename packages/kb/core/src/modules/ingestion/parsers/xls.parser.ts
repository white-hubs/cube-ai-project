import { Injectable } from "@dangao/bun-server";
import * as XLSX from "xlsx";

import { type ParsedDocumentContent, type ParserInput } from "../../common/document-types";
import { TableRowWindowChunker } from "../chunkers/table-row-window.chunker";
import { type DocumentParser } from "./parser";
import { buildStructuredTableContent } from "./table-parser-utils";

@Injectable()
export class XlsParser implements DocumentParser {
  public readonly supportedExtensions = ["xls"];
  public readonly supportedMimeTypes = ["application/vnd.ms-excel"];
  public readonly supported = true;

  public constructor(private readonly tableRowWindowChunker: TableRowWindowChunker) {}

  public async parse(input: ParserInput): Promise<ParsedDocumentContent> {
    const workbook = XLSX.read(Buffer.from(await input.file.arrayBuffer()), { type: "buffer" });
    return buildStructuredTableContent({
      chunker: this.tableRowWindowChunker,
      chunkingOptions: input.chunkingOptions,
      filename: input.filename,
      sourceType: "xls",
      workbook,
    });
  }
}
