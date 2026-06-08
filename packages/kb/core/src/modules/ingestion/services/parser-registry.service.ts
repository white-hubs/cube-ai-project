import { Injectable } from '@dangao/bun-server'
import { AudioParser } from '../parsers/audio.parser'
import { DoclingParser } from '../parsers/docling.parser'
import { DocxParser } from '../parsers/docx.parser'
import { HtmlParser } from '../parsers/html.parser'
import { MarkdownParser } from '../parsers/markdown.parser'
import { CsvParser } from '../parsers/csv.parser'
import { MdxParser } from '../parsers/mdx.parser'
import type { DocumentParser } from '../parsers/parser'
import { PdfParser } from '../parsers/pdf.parser'
import { PptxParser } from '../parsers/pptx.parser'
import { PropertiesParser } from '../parsers/properties.parser'
import { TxtParser } from '../parsers/txt.parser'
import { UnsupportedFormatParser } from '../parsers/unsupported-format.parser'
import { VideoParser } from '../parsers/video.parser'
import { VttParser } from '../parsers/vtt.parser'
import { XlsParser } from '../parsers/xls.parser'
import { XlsxParser } from '../parsers/xlsx.parser'

interface ParserRoute {
  readonly extensions: string[]
  readonly mimeTypes: string[]
  readonly primary: DocumentParser
  readonly fallback: DocumentParser | null
}

@Injectable()
export class ParserRegistryService {
  private readonly routes: ParserRoute[]
  private readonly unsupportedParser: UnsupportedFormatParser

  public constructor(
    doclingParser: DoclingParser,
    txtParser: TxtParser,
    markdownParser: MarkdownParser,
    htmlParser: HtmlParser,
    pdfParser: PdfParser,
    docxParser: DocxParser,
    xlsxParser: XlsxParser,
    xlsParser: XlsParser,
    csvParser: CsvParser,
    pptxParser: PptxParser,
    vttParser: VttParser,
    propertiesParser: PropertiesParser,
    mdxParser: MdxParser,
    audioParser: AudioParser,
    videoParser: VideoParser,
    unsupportedFormatParser: UnsupportedFormatParser,
  ) {
    this.unsupportedParser = unsupportedFormatParser
    this.routes = [
      this.createRoute(txtParser, txtParser, null),
      this.createRoute(markdownParser, doclingParser, markdownParser),
      this.createRoute(htmlParser, doclingParser, htmlParser),
      this.createRoute(pdfParser, doclingParser, pdfParser),
      this.createRoute(docxParser, doclingParser, docxParser),
      this.createRoute(pptxParser, doclingParser, pptxParser),
      this.createRoute(xlsxParser, xlsxParser, null),
      this.createRoute(xlsParser, xlsParser, null),
      this.createRoute(csvParser, csvParser, null),
      this.createRoute(vttParser, vttParser, null),
      this.createRoute(propertiesParser, propertiesParser, null),
      this.createRoute(mdxParser, mdxParser, null),
      this.createRoute(audioParser, audioParser, null),
      this.createRoute(videoParser, videoParser, null),
    ]
  }

  public getParser(filename: string, mimeType?: string | null): DocumentParser {
    return this.resolveRoute(filename, mimeType)?.primary ?? this.unsupportedParser
  }

  public isSupported(filename: string, mimeType?: string | null): boolean {
    return this.getParser(filename, mimeType).supported
  }

  public getFallbackParser(filename: string, mimeType?: string | null): DocumentParser | null {
    return this.resolveRoute(filename, mimeType)?.fallback ?? null
  }

  private getExtension(filename: string): string {
    const segments = filename.toLowerCase().split('.')
    return segments.length > 1 ? (segments.pop() ?? '') : ''
  }

  private createRoute(referenceParser: DocumentParser, primary: DocumentParser, fallback: DocumentParser | null): ParserRoute {
    return {
      extensions: [...referenceParser.supportedExtensions],
      mimeTypes: [...referenceParser.supportedMimeTypes],
      primary,
      fallback,
    }
  }

  private resolveRoute(filename: string, mimeType?: string | null): ParserRoute | null {
    const normalizedExtension = this.getExtension(filename)
    const normalizedMimeType = (mimeType ?? '').toLowerCase()

    const extensionRoute = normalizedExtension === ''
      ? null
      : this.routes.find((candidate) => candidate.extensions.includes(normalizedExtension))
    if (extensionRoute) {
      return extensionRoute
    }

    if (normalizedMimeType === '') {
      return null
    }

    return this.routes.find((candidate) => candidate.mimeTypes.includes(normalizedMimeType)) ?? null
  }
}
