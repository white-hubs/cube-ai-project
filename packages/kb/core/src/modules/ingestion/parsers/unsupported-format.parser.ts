import { BadRequestException, Injectable } from "@dangao/bun-server";

import type { ParsedDocumentContent, ParserInput } from "../../common/document-types";
import type { DocumentParser } from "./parser";

@Injectable()
export class UnsupportedFormatParser implements DocumentParser {
  public readonly supportedExtensions = ["docx", "xlsx", "pptx", "mp3", "mp4"];
  public readonly supportedMimeTypes = [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "audio/mpeg",
    "video/mp4",
  ];
  public readonly supported = false;

  public async parse(input: ParserInput): Promise<ParsedDocumentContent> {
    throw new BadRequestException(`当前文件类型暂未实现解析: ${input.filename}`);
  }
}
