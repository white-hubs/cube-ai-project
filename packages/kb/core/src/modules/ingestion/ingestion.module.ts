import { Module } from "@dangao/bun-server";

import { APP_CONFIG_TOKEN, loadAppConfig } from "../../config/app.config";
import { OrmDatabaseModule } from "../../infrastructure/orm/orm-database.module";
import { VectorStoreModule } from "../vector-store/vector-store.module";
import { OverlapTextChunker } from "./chunkers/overlap-text.chunker";
import { PropertiesGroupChunker } from "./chunkers/properties-group.chunker";
import { TableRowWindowChunker } from "./chunkers/table-row-window.chunker";
import { VttWindowChunker } from "./chunkers/vtt-window.chunker";
import { DoclingClient } from "./infrastructure/docling/docling.client";
import { AudioParser } from "./parsers/audio.parser";
import { CsvParser } from "./parsers/csv.parser";
import { DoclingParser } from "./parsers/docling.parser";
import { DocxParser } from "./parsers/docx.parser";
import { HtmlParser } from "./parsers/html.parser";
import { MarkdownParser } from "./parsers/markdown.parser";
import { MdxParser } from "./parsers/mdx.parser";
import { PdfParser } from "./parsers/pdf.parser";
import { PptxParser } from "./parsers/pptx.parser";
import { PropertiesParser } from "./parsers/properties.parser";
import { TxtParser } from "./parsers/txt.parser";
import { UnsupportedFormatParser } from "./parsers/unsupported-format.parser";
import { VideoParser } from "./parsers/video.parser";
import { VttParser } from "./parsers/vtt.parser";
import { XlsParser } from "./parsers/xls.parser";
import { XlsxParser } from "./parsers/xlsx.parser";
import { IngestionService } from "./services/ingestion.service";
import { ParserRegistryService } from "./services/parser-registry.service";

export function createOverlapTextChunker(config: { ingestionChunkSize: number; ingestionChunkOverlap: number }): OverlapTextChunker {
  return new OverlapTextChunker({
    chunkOverlap: config.ingestionChunkOverlap,
    chunkSize: config.ingestionChunkSize,
  });
}

const appConfig = await loadAppConfig();

@Module({
  exports: [APP_CONFIG_TOKEN, ParserRegistryService, IngestionService, OverlapTextChunker],
  imports: [OrmDatabaseModule, VectorStoreModule],
  providers: [
    { provide: APP_CONFIG_TOKEN, useValue: appConfig },
    {
      provide: OverlapTextChunker,
      useFactory: () => createOverlapTextChunker(appConfig),
    },
    TableRowWindowChunker,
    VttWindowChunker,
    PropertiesGroupChunker,
    DoclingClient,
    CsvParser,
    DoclingParser,
    TxtParser,
    MarkdownParser,
    MdxParser,
    HtmlParser,
    PdfParser,
    DocxParser,
    PropertiesParser,
    VttParser,
    XlsParser,
    XlsxParser,
    PptxParser,
    AudioParser,
    VideoParser,
    UnsupportedFormatParser,
    ParserRegistryService,
    IngestionService,
  ],
})
export class IngestionModule {}
