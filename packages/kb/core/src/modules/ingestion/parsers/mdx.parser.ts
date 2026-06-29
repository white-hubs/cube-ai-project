import { Injectable } from "@dangao/bun-server";

import { type ParsedDocumentContent, type ParserInput } from "../../common/document-types";
import { DoclingClient } from "../infrastructure/docling/docling.client";
import { type DocumentParser } from "./parser";

function preprocessMdx(input: string): string {
  return input
    .replaceAll(/^[ \t]*import\s.+$/gmu, "")
    .replaceAll(/^[ \t]*export\s.+$/gmu, "")
    .replaceAll(/<[^>\n]+\/>/gu, " ")
    .replaceAll(/<([A-Z][^>\n]*)>[\s\S]*?<\/[A-Z][^>]*>/gu, " ")
    .replaceAll(/\n{3,}/gu, "\n\n")
    .trim();
}

function replaceExtension(filename: string, extension: string): string {
  return filename.replace(/\.[^.]+$/u, extension);
}

@Injectable()
export class MdxParser implements DocumentParser {
  public readonly supportedExtensions = ["mdx"];
  public readonly supportedMimeTypes = ["text/mdx", "application/mdx"];
  public readonly supported = true;

  public constructor(private readonly doclingClient: DoclingClient) {}

  public async parse(input: ParserInput): Promise<ParsedDocumentContent> {
    const normalizedMarkdown = preprocessMdx(await input.file.text());
    const markdownFile = new File([normalizedMarkdown], replaceExtension(input.filename, ".md"), {
      type: "text/markdown",
    });
    return this.doclingClient.parseAndChunk({
      chunkingOptions: input.chunkingOptions,
      file: markdownFile,
      filename: markdownFile.name,
      mimeType: markdownFile.type,
    });
  }
}
