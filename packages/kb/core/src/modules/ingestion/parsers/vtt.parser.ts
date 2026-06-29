import { BadRequestException, Injectable } from "@dangao/bun-server";

import { type ParsedDocumentContent, type ParserInput } from "../../common/document-types";
import { type VttCueRecord, VttWindowChunker } from "../chunkers/vtt-window.chunker";
import { type DocumentParser } from "./parser";

const TIME_RANGE_PATTERN = /^(\d{2}:\d{2}:\d{2}\.\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}\.\d{3})$/u;

function parseVtt(text: string): VttCueRecord[] {
  const lines = text.replaceAll(/\r\n?/gu, "\n").split("\n");
  const cues: VttCueRecord[] = [];
  let lineIndex = 0;

  while (lineIndex < lines.length) {
    const current = lines[lineIndex]?.trim() ?? "";
    if (current === "" || current === "WEBVTT") {
      lineIndex += 1;
      continue;
    }

    let cueIndex = cues.length + 1;
    let timingLine = current;
    if (!current.includes("-->")) {
      cueIndex = Number.parseInt(current, 10) || cueIndex;
      lineIndex += 1;
      timingLine = lines[lineIndex]?.trim() ?? "";
    }

    const match = timingLine.match(TIME_RANGE_PATTERN);
    if (!match) {
      lineIndex += 1;
      continue;
    }

    lineIndex += 1;
    const textLines: string[] = [];
    while (lineIndex < lines.length && (lines[lineIndex]?.trim() ?? "") !== "") {
      textLines.push(lines[lineIndex] ?? "");
      lineIndex += 1;
    }

    const cueText = textLines.join(" ").trim();
    if (cueText !== "") {
      const startTime = match[1];
      const endTime = match[2];
      if (!startTime || !endTime) {
        continue;
      }
      cues.push({
        cueIndex,
        endTime,
        startTime,
        text: cueText,
      });
    }
  }

  return cues;
}

@Injectable()
export class VttParser implements DocumentParser {
  public readonly supportedExtensions = ["vtt"];
  public readonly supportedMimeTypes = ["text/vtt"];
  public readonly supported = true;

  public constructor(private readonly vttWindowChunker: VttWindowChunker) {}

  public async parse(input: ParserInput): Promise<ParsedDocumentContent> {
    const cues = parseVtt(await input.file.text());
    if (cues.length === 0) {
      throw new BadRequestException(`VTT 文件未提取到 cue 内容: ${input.filename}`);
    }
    const chunks = this.vttWindowChunker.chunk(input.filename, cues);
    return {
      chunks,
      fileName: input.filename,
      sourceType: "vtt",
      text: chunks.map((chunk) => chunk.displayText).join("\n\n"),
    };
  }
}
