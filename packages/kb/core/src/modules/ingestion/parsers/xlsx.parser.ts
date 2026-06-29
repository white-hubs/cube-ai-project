import { BadRequestException, Injectable } from "@dangao/bun-server";
import * as XLSX from "xlsx";

import { type ParsedDocumentContent, type ParserInput } from "../../common/document-types";
import { TableRowWindowChunker } from "../chunkers/table-row-window.chunker";
import { type DocumentParser } from "./parser";
import { buildStructuredTableContent } from "./table-parser-utils";

@Injectable()
export class XlsxParser implements DocumentParser {
  public readonly supportedExtensions = ["xlsx"];
  public readonly supportedMimeTypes = ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];
  public readonly supported = true;

  public constructor(private readonly tableRowWindowChunker: TableRowWindowChunker) {}

  public async parse(input: ParserInput): Promise<ParsedDocumentContent> {
    const workbook = XLSX.read(Buffer.from(await input.file.arrayBuffer()), { type: "buffer" });
    if (workbook.SheetNames.length === 0) {
      throw new BadRequestException(`XLSX 文件未提取到工作表内容: ${input.filename}`);
    }
    return buildStructuredTableContent({
      chunker: this.tableRowWindowChunker,
      chunkingOptions: input.chunkingOptions,
      filename: input.filename,
      sourceType: "xlsx",
      workbook,
    });
  }
}
