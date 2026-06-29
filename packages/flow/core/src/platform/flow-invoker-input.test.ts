import { describe, expect, test } from "bun:test";

import { resolveFlowInvokeInput } from "./flow-platform-ports";

describe("resolveFlowInvokeInput", () => {
  test("prefers input over aliases", () => {
    expect(resolveFlowInvokeInput({ input: "a", query: "b" })).toBe("a");
  });

  test("falls back through common LLM alias keys", () => {
    expect(resolveFlowInvokeInput({ message: "m" })).toBe("m");
    expect(resolveFlowInvokeInput({ query: "q" })).toBe("q");
    expect(resolveFlowInvokeInput({ question: "who" })).toBe("who");
    expect(resolveFlowInvokeInput({ prompt: "p" })).toBe("p");
    expect(resolveFlowInvokeInput({ text: "t" })).toBe("t");
    expect(resolveFlowInvokeInput({ message: "m", query: "q" })).toBe("m");
    expect(resolveFlowInvokeInput({ query: "q", question: "who" })).toBe("q");
  });

  test("keeps explicit empty input", () => {
    expect(resolveFlowInvokeInput({ input: "", query: "q" })).toBe("");
  });

  test("returns empty when no text fields", () => {
    expect(resolveFlowInvokeInput(undefined)).toBe("");
    expect(resolveFlowInvokeInput({})).toBe("");
    expect(resolveFlowInvokeInput({ foo: "bar" })).toBe("");
  });
});
