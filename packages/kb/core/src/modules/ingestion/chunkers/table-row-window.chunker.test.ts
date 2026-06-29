import { describe, expect, test } from "bun:test";

import { TableRowWindowChunker } from "./table-row-window.chunker";

describe("TableRowWindowChunker", () => {
  test("chunks rows with headers", () => {
    const ch = new TableRowWindowChunker();
    const chunks = ch.chunk(
      {
        filename: "f.xlsx",
        headers: ["A", "B"],
        rows: [
          ["1", "2"],
          ["3", "4"],
        ],
        sheetName: "S1",
        sourceType: "xlsx",
      },
      { tableChunkMode: "row" },
    );
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0]!.sheetName).toBe("S1");
    expect(chunks[0]!.chunkType).toBe("table-row-window");
    expect(chunks[0]!.displayText).toContain("工作表");
  });
});
