import { Injectable } from '@dangao/bun-server'
import { DoclingClient } from '../infrastructure/docling/docling.client'
import type { ParsedDocumentContent, ParserInput } from '../../common/document-types'
import type { DocumentParser } from './parser'

const DOCLING_SUPPORTED_EXTENSIONS = ['md', 'markdown', 'html', 'htm', 'pdf', 'docx', 'pptx'] as const
const DOCLING_SUPPORTED_MIME_TYPES = [
  'text/markdown',
  'text/html',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const

@Injectable()
export class DoclingParser implements DocumentParser {
  public readonly supportedExtensions = [...DOCLING_SUPPORTED_EXTENSIONS]
  public readonly supportedMimeTypes = [...DOCLING_SUPPORTED_MIME_TYPES]
  public readonly supported = true

  public constructor(private readonly doclingClient: DoclingClient) {}

  public async parse(input: ParserInput): Promise<ParsedDocumentContent> {
    return this.doclingClient.parseAndChunk(input)
  }
}
