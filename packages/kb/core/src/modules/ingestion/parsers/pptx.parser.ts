import { BadRequestException, Injectable } from "@dangao/bun-server";
import JSZip from "jszip";

import { type ParsedDocumentContent, type ParserInput } from "../../common/document-types";
import { type DocumentParser } from "./parser";
import { normalizePlainText } from "./parser-utils";

const SLIDE_TEXT_PATTERN = /<a:t>([\s\S]*?)<\/a:t>/gu;

function decodeXmlEntities(input: string): string {
  return input.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'");
}

@Injectable()
export class PptxParser implements DocumentParser {
  public readonly supportedExtensions = ["pptx"];
  public readonly supportedMimeTypes = ["application/vnd.openxmlformats-officedocument.presentationml.presentation"];
  public readonly supported = true;

  public async parse(input: ParserInput): Promise<ParsedDocumentContent> {
    const zip = await JSZip.loadAsync(await input.file.arrayBuffer());
    const slideNames = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/iu.test(name))
      .toSorted((left, right) => left.localeCompare(right, undefined, { numeric: true }));

    const slides = await Promise.all(
      slideNames.map(async (slideName, index) => {
        const xml = await zip.files[slideName]?.async("string");
        if (!xml) {
          return "";
        }
        const texts = Array.from(xml.matchAll(SLIDE_TEXT_PATTERN))
          .map((match) => decodeXmlEntities(match[1] ?? "").trim())
          .filter((value) => value !== "");
        return texts.length > 0 ? `Slide ${index + 1}\n${texts.join("\n")}` : "";
      }),
    );

    const text = normalizePlainText(slides.filter((slide) => slide !== "").join("\n\n"));
    if (!text) {
      throw new BadRequestException(`PPTX 文件未提取到文本内容: ${input.filename}`);
    }
    return {
      fileName: input.filename,
      sourceType: "pptx",
      text,
    };
  }
}
