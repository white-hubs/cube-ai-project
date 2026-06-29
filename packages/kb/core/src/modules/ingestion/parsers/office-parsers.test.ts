import { describe, expect, test } from "bun:test";
import JSZip from "jszip";
import * as XLSX from "xlsx";

import { TableRowWindowChunker } from "../chunkers/table-row-window.chunker";
import { CsvParser } from "./csv.parser";
import { DocxParser } from "./docx.parser";
import { PptxParser } from "./pptx.parser";
import { XlsParser } from "./xls.parser";
import { XlsxParser } from "./xlsx.parser";

function createDocxBuffer(text: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.folder("_rels")?.file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.folder("word")?.file(
    "document.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>${text}</w:t></w:r></w:p>
  </w:body>
</w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

function createPptxBuffer(lines: string[]): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>${lines.map((line) => `<a:t>${line}</a:t>`).join("")}</p:spTree></p:cSld>
</p:sld>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

describe("office parsers", () => {
  const tableRowWindowChunker = new TableRowWindowChunker();

  test("docx parser extracts text", async () => {
    const file = new File([await createDocxBuffer("Hello DOCX")], "demo.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const parser = new DocxParser();
    const result = await parser.parse({
      file,
      filename: file.name,
      mimeType: file.type,
    });
    expect(result.text).toContain("Hello DOCX");
    expect(parser.supported).toBe(true);
  });

  test("xlsx parser emits row-window table chunks across sheets", async () => {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["name", "value"],
      ["alpha", "42"],
      ["beta", "43"],
    ]);
    XLSX.utils.book_append_sheet(workbook, worksheet, "SheetA");
    const file = new File([XLSX.write(workbook, { bookType: "xlsx", type: "buffer" })], "demo.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const parser = new XlsxParser(tableRowWindowChunker);
    const result = await parser.parse({
      chunkingOptions: { chunkOverlap: 1, chunkSize: 160 },
      file,
      filename: file.name,
      mimeType: file.type,
    });
    expect(result.text).toContain("SheetA");
    expect(result.chunks).toHaveLength(2);
    expect(result.chunks?.[0]).toEqual(
      expect.objectContaining({
        chunkType: "table-row-window",
        headers: ["name", "value"],
        rowEnd: 1,
        rowStart: 1,
        sheetName: "SheetA",
      }),
    );
    expect(result.chunks?.[0]?.displayText).not.toContain("表头:");
    expect(result.chunks?.[0]?.displayText).toContain("第1行: name=alpha; value=42");
    expect(result.chunks?.[0]?.displayText).not.toContain("| --- |");
    expect(result.chunks?.[0]?.embeddingText).toContain("name=alpha");
    expect(result.chunks?.[1]?.embeddingText).toContain("name=beta");
  });

  test("xls parser reads legacy workbooks through the unified table path", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["device", "status"],
        ["A-1", "ok"],
      ]),
      "Legacy",
    );
    const file = new File([XLSX.write(workbook, { bookType: "xls", type: "buffer" })], "demo.xls", {
      type: "application/vnd.ms-excel",
    });
    const parser = new XlsParser(tableRowWindowChunker);
    const result = await parser.parse({
      file,
      filename: file.name,
      mimeType: file.type,
    });

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks?.[0]?.sheetName).toBe("Legacy");
    expect(result.chunks?.[0]?.embeddingText).toContain("device=A-1");
  });

  test("csv parser emits structured table chunks", async () => {
    const file = new File(["device,status\nA-1,ok\nA-2,fail\n"], "demo.csv", {
      type: "text/csv",
    });
    const parser = new CsvParser(tableRowWindowChunker);
    const result = await parser.parse({
      chunkingOptions: { chunkOverlap: 1, chunkSize: 120 },
      file,
      filename: file.name,
      mimeType: file.type,
    });

    expect(result.chunks).toHaveLength(2);
    expect(result.chunks?.[0]).toEqual(
      expect.objectContaining({
        chunkType: "table-row-window",
        headers: ["device", "status"],
        rowEnd: 1,
        rowStart: 1,
        sheetName: "demo",
      }),
    );
    expect(result.chunks?.[1]?.embeddingText).toContain("device=A-2");
  });

  test("wide sparse xlsx tables split into single-row chunks and omit empty cells in embedding text", async () => {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([
      [
        "设备编码",
        "设备名称",
        "工作天数",
        "设备故障次数",
        "MTBF(h)",
        "设备维修时间",
        "MTTR(h)",
        "其他因素停机(h)",
        "设备实际运行时间(h)",
        "MTTF(h)",
      ],
      ["5d10--35", "研发中心6号265VBRS", "364", "", "", "", "", "", "", ""],
      ["LYY-12F-JK-006_D", "研发中心3号265CBRS", "364", "", "", "", "", "", "", ""],
      ["5d10--39-just-test", "研发中心1号264VBRS", "364", "", "", "", "", "", "", ""],
      ["5d10--40", "研发中心7号264VBRN", "364", "", "", "", "", "", "", ""],
      ["LYY-12F-JK-007_D", "研发中心2号265VBRN", "364", "", "", "", "", "", "", ""],
      ["5d10--34", "研发中心5号265CBRN1", "364", "", "", "", "", "", "", ""],
      ["5a9e970f-9658-4fa1-84fc-80c30a91e87a", "研发中心5号265CBRN_192.168.2.15", "364", "", "", "", "", "", "", ""],
    ]);
    XLSX.utils.book_append_sheet(workbook, worksheet, "可靠性分析");
    const file = new File([XLSX.write(workbook, { bookType: "xlsx", type: "buffer" })], "可靠性分析.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const parser = new XlsxParser(tableRowWindowChunker);
    const result = await parser.parse({
      chunkingOptions: { chunkOverlap: 50, chunkSize: 1024 },
      file,
      filename: file.name,
      mimeType: file.type,
    });

    expect(result.chunks).toHaveLength(7);
    expect(result.chunks?.map((chunk) => `${chunk.rowStart}-${chunk.rowEnd}`)).toEqual(["1-1", "2-2", "3-3", "4-4", "5-5", "6-6", "7-7"]);
    expect(result.chunks?.[0]?.embeddingText).toStartWith("第1行: 设备编码=5d10--35; 设备名称=研发中心6号265VBRS; 工作天数=364");
    expect(result.chunks?.[0]?.embeddingText).toContain("关键词: 设备编码=5d10--35; 设备名称=研发中心6号265VBRS");
    expect(result.chunks?.[0]?.embeddingText).toContain("工作表: 可靠性分析");
    expect(result.chunks?.[0]?.embeddingText).not.toContain("设备故障次数=");
    expect(result.chunks?.[3]?.embeddingText).toContain("第4行: 设备编码=5d10--40; 设备名称=研发中心7号264VBRN; 工作天数=364");
  });

  test("wide sparse xlsx tables with generic headers still split into single-row chunks", async () => {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["col_a", "col_b", "col_c", "col_d", "col_e", "col_f", "col_g", "col_h"],
      ["a-001", "name-1", "364", "", "", "", "", ""],
      ["a-002", "name-2", "364", "", "", "", "", ""],
      ["a-003", "name-3", "364", "", "", "", "", ""],
      ["a-004", "name-4", "364", "", "", "", "", ""],
    ]);
    XLSX.utils.book_append_sheet(workbook, worksheet, "SheetA");
    const file = new File([XLSX.write(workbook, { bookType: "xlsx", type: "buffer" })], "generic.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const parser = new XlsxParser(tableRowWindowChunker);
    const result = await parser.parse({
      chunkingOptions: { chunkOverlap: 50, chunkSize: 1024 },
      file,
      filename: file.name,
      mimeType: file.type,
    });

    expect(result.chunks?.map((chunk) => `${chunk.rowStart}-${chunk.rowEnd}`)).toEqual(["1-1", "2-2", "3-3", "4-4"]);
    expect(result.chunks?.[0]?.embeddingText).toContain("第1行: col_a=a-001; col_b=name-1; col_c=364");
  });

  test("narrow sparse xlsx entity tables auto-split into single-row chunks", async () => {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["*空间名称", "空间状态", "占地面积(平米)", "区域介绍"],
      ["一号楼", "已售", "1000.00000", "介绍"],
      ["一号楼/4F", "", "", ""],
      ["一号楼/3F", "", "", ""],
      ["一号楼/顶层", "", "", ""],
      ["一号楼/9F", "", "", ""],
      ["一号楼/8F", "", "", ""],
    ]);
    XLSX.utils.book_append_sheet(workbook, worksheet, "空间");
    const file = new File([XLSX.write(workbook, { bookType: "xlsx", type: "buffer" })], "空间.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const parser = new XlsxParser(tableRowWindowChunker);
    const result = await parser.parse({
      chunkingOptions: { chunkOverlap: 50, chunkSize: 1024, tableChunkMode: "auto" },
      file,
      filename: file.name,
      mimeType: file.type,
    });

    expect(result.chunks?.map((chunk) => `${chunk.rowStart}-${chunk.rowEnd}`)).toEqual(["1-1", "2-2", "3-3", "4-4", "5-5", "6-6"]);
    expect(result.chunks?.[0]?.embeddingText).toContain("第1行: *空间名称=一号楼; 空间状态=已售; 占地面积(平米)=1000.00000; 区域介绍=介绍");
    expect(result.chunks?.[1]?.embeddingText).toContain("第2行: *空间名称=一号楼/4F");
  });

  test("tableChunkMode row forces single-row chunks for dense tables", async () => {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["name", "status", "owner", "region"],
      ["alpha", "ready", "ops-a", "cn"],
      ["beta", "ready", "ops-b", "cn"],
      ["gamma", "ready", "ops-c", "sg"],
    ]);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Assets");
    const file = new File([XLSX.write(workbook, { bookType: "xlsx", type: "buffer" })], "assets.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const parser = new XlsxParser(tableRowWindowChunker);
    const result = await parser.parse({
      chunkingOptions: { chunkOverlap: 50, chunkSize: 1024, tableChunkMode: "row" },
      file,
      filename: file.name,
      mimeType: file.type,
    });

    expect(result.chunks?.map((chunk) => `${chunk.rowStart}-${chunk.rowEnd}`)).toEqual(["1-1", "2-2", "3-3"]);
  });

  test("tableChunkMode window keeps dense tables in multi-row windows", async () => {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["name", "status", "owner", "region"],
      ["alpha", "ready", "ops-a", "cn"],
      ["beta", "ready", "ops-b", "cn"],
      ["gamma", "ready", "ops-c", "sg"],
    ]);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Assets");
    const file = new File([XLSX.write(workbook, { bookType: "xlsx", type: "buffer" })], "assets.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const parser = new XlsxParser(tableRowWindowChunker);
    const result = await parser.parse({
      chunkingOptions: { chunkOverlap: 50, chunkSize: 1024, tableChunkMode: "window" },
      file,
      filename: file.name,
      mimeType: file.type,
    });

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks?.[0]?.rowStart).toBe(1);
    expect(result.chunks?.[0]?.rowEnd).toBe(3);
    expect(result.chunks?.[0]?.displayText).toContain("表头: name, status, owner, region");
  });

  test("dense import template tables auto-split into single-row chunks when each row is an entity", async () => {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([
      [
        "设备ID",
        "设备编码",
        "设备名称",
        "产品ID",
        "产品名称",
        "产品品类名称",
        "维护部门",
        "区域",
        "维护人员",
        "设备位置",
        "采购日期",
        "生产日期",
        "采购单价",
        "使用寿命",
        "设备标签",
      ],
      [
        "1859874296584765440",
        "21",
        "干货区广播",
        "1859854017871511552",
        "广播",
        "环境广播",
        "",
        "干果区",
        "",
        "108.989458,34.312424",
        "",
        "",
        "108.989458,34.312424",
        "",
        "",
      ],
      [
        "1859874296597348352",
        "19",
        "水果区广播",
        "1859854017871511552",
        "广播",
        "环境广播",
        "",
        "精品水果区",
        "",
        "108.990455,34.311758",
        "",
        "",
        "108.990455,34.311758",
        "",
        "",
      ],
    ]);
    XLSX.utils.book_append_sheet(workbook, worksheet, "批量导入模板");
    const file = new File([XLSX.write(workbook, { bookType: "xlsx", type: "buffer" })], "template.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const parser = new XlsxParser(tableRowWindowChunker);
    const result = await parser.parse({
      chunkingOptions: { chunkOverlap: 50, chunkSize: 1024, tableChunkMode: "auto" },
      file,
      filename: file.name,
      mimeType: file.type,
    });

    expect(result.chunks?.map((chunk) => `${chunk.rowStart}-${chunk.rowEnd}`)).toEqual(["1-1", "2-2"]);
    expect(result.chunks?.[0]?.embeddingText).toContain("第1行: 设备ID=1859874296584765440; 设备编码=21; 设备名称=干货区广播");
    expect(result.chunks?.[1]?.embeddingText).toContain("第2行: 设备ID=1859874296597348352; 设备编码=19; 设备名称=水果区广播");
  });

  test("xlsx parser keeps hidden reference sheets and trims trailing synthetic columns", async () => {
    const workbook = XLSX.utils.book_new();
    const templateSheet = XLSX.utils.aoa_to_sheet([
      ["设备ID", "设备名称"],
      ["1001", "广播"],
    ]);
    const referenceSheet = XLSX.utils.aoa_to_sheet([
      ["合规风控部", "办公室人力", "招商拓展部", "收费稽查组", "", "", ""],
      ["蔬果交易部", "收费结算中心", "肉类交易部", "产业链部", "客户服务中心", "纪检监察室", "计划财务部"],
    ]);
    XLSX.utils.book_append_sheet(workbook, templateSheet, "批量导入模板");
    XLSX.utils.book_append_sheet(workbook, referenceSheet, "REF");
    workbook.Workbook = {
      Sheets: [
        { Hidden: 0, name: "批量导入模板" },
        { Hidden: 1, name: "REF" },
      ],
    };
    const file = new File([XLSX.write(workbook, { bookType: "xlsx", type: "buffer" })], "template.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const parser = new XlsxParser(tableRowWindowChunker);
    const result = await parser.parse({
      chunkingOptions: { chunkOverlap: 50, chunkSize: 1024, tableChunkMode: "auto" },
      file,
      filename: file.name,
      mimeType: file.type,
    });

    expect(result.chunks?.map((chunk) => chunk.sheetName)).toEqual(["批量导入模板", "REF"]);
    expect(result.text).toContain("工作表: REF");
    expect(result.text).toContain("第1行: 合规风控部=合规风控部; 办公室人力=办公室人力");
    expect(result.text).not.toContain("| --- |");
    expect(result.text).not.toContain("column_5");
    expect(result.text).not.toContain("column_6");
    expect(result.text).not.toContain("column_7");
  });

  test("pptx parser extracts slide texts", async () => {
    const file = new File([await createPptxBuffer(["Intro", "Overview"])], "demo.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    const parser = new PptxParser();
    const result = await parser.parse({
      file,
      filename: file.name,
      mimeType: file.type,
    });
    expect(result.text).toContain("Slide 1");
    expect(result.text).toContain("Intro");
    expect(result.text).toContain("Overview");
  });
});
