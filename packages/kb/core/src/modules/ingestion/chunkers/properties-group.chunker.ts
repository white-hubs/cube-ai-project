import { Injectable } from '@dangao/bun-server'
import type { ParsedDocumentChunk } from '../../common/document-types'

export interface PropertyEntry {
  key: string
  value: string
}

function slugify(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

function inferNamespace(key: string): string {
  if (key.includes('.')) {
    return key.split('.')[0] ?? 'default'
  }
  if (key.includes('_')) {
    return key.split('_')[0] ?? 'default'
  }
  return 'default'
}

@Injectable()
export class PropertiesGroupChunker {
  public chunk(filename: string, entries: PropertyEntry[]): ParsedDocumentChunk[] {
    const grouped = new Map<string, PropertyEntry[]>()
    for (const entry of entries) {
      const namespace = inferNamespace(entry.key)
      const bucket = grouped.get(namespace) ?? []
      bucket.push(entry)
      grouped.set(namespace, bucket)
    }

    return Array.from(grouped.entries()).map(([propertyNamespace, group], index) => {
      const displayText = group.map((entry) => `${entry.key}=${entry.value}`).join('\n')
      return {
        chunkIndex: index,
        displayText,
        embeddingText: [
          `文件: ${filename}`,
          `命名空间: ${propertyNamespace}`,
          ...group.map((entry) => `${entry.key}=${entry.value}`),
        ].join('\n'),
        sectionId: `properties:${slugify(propertyNamespace) || 'default'}`,
        headingPath: [propertyNamespace],
        pageNo: null,
        chunkType: 'properties-group',
        orderInSection: index,
        captionText: null,
        pictureDescription: null,
        propertyNamespace,
        keywords: group.flatMap((entry) => [entry.key, entry.value]).filter((value) => value.trim() !== ''),
      }
    })
  }
}
