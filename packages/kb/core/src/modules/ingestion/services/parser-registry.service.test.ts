import { describe, expect, test } from "bun:test";

import { PropertiesGroupChunker } from "../chunkers/properties-group.chunker";
import { TableRowWindowChunker } from "../chunkers/table-row-window.chunker";
import { VttWindowChunker } from "../chunkers/vtt-window.chunker";
import { AudioParser } from "../parsers/audio.parser";
import { CsvParser } from "../parsers/csv.parser";
import { DoclingParser } from "../parsers/docling.parser";
import { DocxParser } from "../parsers/docx.parser";
import { HtmlParser } from "../parsers/html.parser";
import { MarkdownParser } from "../parsers/markdown.parser";
import { MdxParser } from "../parsers/mdx.parser";
import { PdfParser } from "../parsers/pdf.parser";
import { PptxParser } from "../parsers/pptx.parser";
import { PropertiesParser } from "../parsers/properties.parser";
import { TxtParser } from "../parsers/txt.parser";
import { UnsupportedFormatParser } from "../parsers/unsupported-format.parser";
import { VideoParser } from "../parsers/video.parser";
import { VttParser } from "../parsers/vtt.parser";
import { XlsParser } from "../parsers/xls.parser";
import { XlsxParser } from "../parsers/xlsx.parser";
import { ParserRegistryService } from "./parser-registry.service";

class FakeDoclingClient {
  public async parseAndChunk() {
    return {
      chunks: [],
      fileName: "report.txt",
      sourceType: "txt",
      text: "hello",
    };
  }
}

describe("ParserRegistryService", () => {
  function createService(): ParserRegistryService {
    const tableRowWindowChunker = new TableRowWindowChunker();
    const vttWindowChunker = new VttWindowChunker();
    const propertiesGroupChunker = new PropertiesGroupChunker();
    return new ParserRegistryService(
      new DoclingParser(new FakeDoclingClient() as never),
      new TxtParser(),
      new MarkdownParser(),
      new HtmlParser(),
      new PdfParser(),
      new DocxParser(),
      new XlsxParser(tableRowWindowChunker),
      new XlsParser(tableRowWindowChunker),
      new CsvParser(tableRowWindowChunker),
      new PptxParser(),
      new VttParser(vttWindowChunker),
      new PropertiesParser(propertiesGroupChunker),
      new MdxParser(new FakeDoclingClient() as never),
      new AudioParser(),
      new VideoParser(),
      new UnsupportedFormatParser(),
    );
  }

  test("routes txt to local txt parser instead of docling", () => {
    const service = createService();

    const parser = service.getParser("report.txt", "text/plain");

    expect(parser).toBeInstanceOf(TxtParser);
    expect(service.isSupported("report.txt", "text/plain")).toBe(true);
  });

  test("does not use a fallback parser for txt because local parsing is primary", () => {
    const service = createService();

    const parser = service.getFallbackParser("report.txt", "text/plain");

    expect(parser).toBeNull();
  });

  test("selects docling parser by mime type for pdf", () => {
    const service = createService();

    const parser = service.getParser("unknown.bin", "application/pdf");

    expect(parser).toBeInstanceOf(DoclingParser);
  });

  test("falls back to unsupported parser for unimplemented types", () => {
    const service = createService();

    const parser = service.getParser("voice.mp3", "audio/mpeg");

    expect(parser).toBeInstanceOf(UnsupportedFormatParser);
    expect(service.isSupported("voice.mp3", "audio/mpeg")).toBe(false);
  });

  test("does not return unsupported parser as a fallback parser", () => {
    const service = createService();

    const parser = service.getFallbackParser("voice.mp3", "audio/mpeg");

    expect(parser).toBeNull();
  });

  test("routes spreadsheet formats to table parsers before docling", () => {
    const service = createService();

    expect(service.getParser("report.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBeInstanceOf(
      XlsxParser,
    );
    expect(service.getParser("report.xls", "application/vnd.ms-excel")).toBeInstanceOf(XlsParser);
    expect(service.getParser("report.csv", "text/csv")).toBeInstanceOf(CsvParser);
    expect(service.getFallbackParser("report.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBeNull();
  });

  test("routes special text formats to dedicated parsers", () => {
    const service = createService();

    expect(service.getParser("captions.vtt", "text/vtt")).toBeInstanceOf(VttParser);
    expect(service.getParser("application.properties", "text/plain")).toBeInstanceOf(PropertiesParser);
    expect(service.getParser("page.mdx", "text/markdown")).toBeInstanceOf(MdxParser);
  });

  test("keeps docling as the primary parser for rich document formats", () => {
    const service = createService();

    expect(service.getParser("report.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBeInstanceOf(
      DoclingParser,
    );
    expect(service.getParser("guide.md", "text/markdown")).toBeInstanceOf(DoclingParser);
    expect(service.getParser("page.html", "text/html")).toBeInstanceOf(DoclingParser);
    expect(
      service.getFallbackParser("report.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ).toBeInstanceOf(DocxParser);
  });
});
