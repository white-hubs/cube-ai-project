import { Injectable } from "@dangao/bun-server";

import { type ParsedDocumentContent, type ParserInput } from "../../common/document-types";
import { type DocumentParser } from "./parser";
import { extractPdfText } from "./parser-utils";

@Injectable()
export class PdfParser implements DocumentParser {
  public readonly supportedExtensions = ["pdf"];
  public readonly supportedMimeTypes = ["application/pdf"];
  public readonly supported = true;

  public async parse(input: ParserInput): Promise<ParsedDocumentContent> {
    const buffer = new Uint8Array(await input.file.arrayBuffer());
    const text = extractPdfText(buffer);

    return {
      fileName: input.filename,
      sourceType: "pdf",
      text,
    };
  }
}
