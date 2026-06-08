import { Injectable } from '@dangao/bun-server'
import type { ParsedDocumentChunk } from '../../common/document-types'

export interface VttCueRecord {
  cueIndex: number
  startTime: string
  endTime: string
  text: string
}

function slugify(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

@Injectable()
export class VttWindowChunker {
  public chunk(filename: string, cues: VttCueRecord[]): ParsedDocumentChunk[] {
    const sectionId = `vtt:${slugify(filename) || 'captions'}`
    return cues.map((cue, index) => ({
      chunkIndex: index,
      displayText: `[${cue.startTime} --> ${cue.endTime}]\n${cue.text}`,
      embeddingText: `文件: ${filename}\n时间: ${cue.startTime} --> ${cue.endTime}\n内容: ${cue.text}`,
      sectionId,
      headingPath: [filename],
      pageNo: null,
      chunkType: 'vtt-cue-window',
      orderInSection: index,
      captionText: null,
      pictureDescription: null,
      startTime: cue.startTime,
      endTime: cue.endTime,
      cueIndex: cue.cueIndex,
      keywords: cue.text.split(/\s+/).filter((token) => token.trim() !== ''),
    }))
  }
}
