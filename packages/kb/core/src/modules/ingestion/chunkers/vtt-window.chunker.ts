import { Injectable } from "@dangao/bun-server";

import type { ParsedDocumentChunk } from "../../common/document-types";

export interface VttCueRecord {
  cueIndex: number;
  startTime: string;
  endTime: string;
  text: string;
}

function slugify(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replaceAll(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");
}

@Injectable()
export class VttWindowChunker {
  public chunk(filename: string, cues: VttCueRecord[]): ParsedDocumentChunk[] {
    const sectionId = `vtt:${slugify(filename) || "captions"}`;
    return cues.map((cue, index) => ({
      captionText: null,
      chunkIndex: index,
      chunkType: "vtt-cue-window",
      cueIndex: cue.cueIndex,
      displayText: `[${cue.startTime} --> ${cue.endTime}]\n${cue.text}`,
      embeddingText: `文件: ${filename}\n时间: ${cue.startTime} --> ${cue.endTime}\n内容: ${cue.text}`,
      endTime: cue.endTime,
      headingPath: [filename],
      keywords: cue.text.split(/\s+/u).filter((token) => token.trim() !== ""),
      orderInSection: index,
      pageNo: null,
      pictureDescription: null,
      sectionId,
      startTime: cue.startTime,
    }));
  }
}
