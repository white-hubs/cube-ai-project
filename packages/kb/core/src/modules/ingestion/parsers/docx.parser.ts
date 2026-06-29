import { BadRequestException, Injectable } from "@dangao/bun-server";
import mammoth from "mammoth";

import { type ParsedDocumentContent, type ParserInput } from "../../common/document-types";
import { type DocumentParser } from "./parser";
import { normalizePlainText } from "./parser-utils";

@Injectable()
export class DocxParser implements DocumentParser {
  public readonly supportedExtensions = ["docx"];
  public readonly supportedMimeTypes = ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
  public readonly supported = true;

  public async parse(input: ParserInput): Promise<ParsedDocumentContent> {
    const result = await mammoth.extractRawText({
      buffer: Buffer.from(await input.file.arrayBuffer()),
    });
    const text = normalizePlainText(result.value);
    if (!text) {
      throw new BadRequestException(`DOCX 文件未提取到文本内容: ${input.filename}`);
    }
    return {
      fileName: input.filename,
      sourceType: "docx",
      text,
    };
  }
}
