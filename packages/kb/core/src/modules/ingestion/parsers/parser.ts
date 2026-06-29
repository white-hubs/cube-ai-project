import type { ParsedDocumentContent, ParserInput } from "../../common/document-types";

export interface DocumentParser {
  readonly supportedExtensions: string[];
  readonly supportedMimeTypes: string[];
  readonly supported: boolean;
  parse(input: ParserInput): Promise<ParsedDocumentContent>;
}
