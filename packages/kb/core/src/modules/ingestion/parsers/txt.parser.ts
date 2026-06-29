import { Injectable } from "@dangao/bun-server";

import { type ParsedDocumentContent, type ParserInput } from "../../common/document-types";
import { type DocumentParser } from "./parser";
import { convertPlainTextToMarkdownForIngestion } from "./parser-utils";

@Injectable()
export class TxtParser implements DocumentParser {
  public readonly supportedExtensions = ["txt"];
  public readonly supportedMimeTypes = ["text/plain"];
  public readonly supported = true;

  public async parse(input: ParserInput): Promise<ParsedDocumentContent> {
    const text = await input.file.text();

    return {
      fileName: input.filename,
      sourceType: "txt",
      text: convertPlainTextToMarkdownForIngestion(text),
    };
  }
}
