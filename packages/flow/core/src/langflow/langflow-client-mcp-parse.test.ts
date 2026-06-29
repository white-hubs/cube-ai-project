import { describe, expect, test } from "bun:test";

import { extractMcpServerNamesFromJson } from "./langflow-client";

describe("extractMcpServerNamesFromJson", () => {
  test("array of { name }", () => {
    expect(extractMcpServerNamesFromJson([{ name: "a" }, { name: "b" }])).toEqual(["a", "b"]);
  });

  test("array of strings", () => {
    expect(extractMcpServerNamesFromJson(["x", "y"])).toEqual(["x", "y"]);
  });

  test("{ data: array }", () => {
    expect(extractMcpServerNamesFromJson({ data: [{ name: "n" }] })).toEqual(["n"]);
  });

  test("{ mcpServers: { k: {} } }", () => {
    expect(extractMcpServerNamesFromJson({ mcpServers: { bar: {}, foo: {} } })).toEqual(["foo", "bar"]);
  });

  test("{ name } uses server_name fallback", () => {
    expect(extractMcpServerNamesFromJson([{ server_name: "z" }])).toEqual(["z"]);
  });
});
