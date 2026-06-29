import { describe, expect, test } from "bun:test";

import { convertPlainTextToMarkdownForIngestion, splitSdkStyleInstructionBlocks } from "./parser-utils";

describe("parser-utils", () => {
  test("splitSdkStyleInstructionBlocks splits paired brace blocks", () => {
    const first = `切换A { action: 'a' params: { x: 1 } }`;
    const second = `切换B { action: 'b' }`;
    const blocks = splitSdkStyleInstructionBlocks(`${first} ${second}`);

    expect(blocks).toEqual([first, second]);
  });

  test("convertPlainTextToMarkdownForIngestion preserves sdk blocks as markdown sections", () => {
    const first = `切换模型时间 { action: 'changeModelTime' params: { value: 'day' } }`;
    const second = `切换模型天气 { action: 'changeModelWeather' params: { value: 'Sunny' } }`;

    const markdown = convertPlainTextToMarkdownForIngestion(`${first} ${second}`);

    expect(markdown).toContain("### 指令 1");
    expect(markdown).toContain("### 指令 2");
    expect(markdown).toContain("changeModelTime");
    expect(markdown).toContain("changeModelWeather");
    expect(markdown).toContain("\n\n");
  });

  test("convertPlainTextToMarkdownForIngestion turns multiline plain text into list paragraphs", () => {
    const markdown = convertPlainTextToMarkdownForIngestion("line one\nline two\nline three");

    expect(markdown).toBe("- line one\n\n- line two\n\n- line three");
  });

  test("convertPlainTextToMarkdownForIngestion keeps existing blank-line paragraphs", () => {
    const markdown = convertPlainTextToMarkdownForIngestion("para one\n\npara two");

    expect(markdown).toBe("para one\n\npara two");
  });
});
