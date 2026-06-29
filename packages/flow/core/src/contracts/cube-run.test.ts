import { describe, expect, test } from "bun:test";

import { normalizeRunBody } from "./cube-run";

describe("normalizeRunBody", () => {
  test("v1 string input and tweaks", () => {
    const n = normalizeRunBody({
      input: "hi",
      stream: true,
      tweaks: { n1: { k: 1 } },
    });
    expect(n.input).toBe("hi");
    expect(n.tweaks?.["n1"]).toEqual({ k: 1 });
    expect(n.stream).toBe(true);
  });

  test("v2 structured input merges params into tweaks", () => {
    const n = normalizeRunBody({
      input: {
        params: { nodeA: { temperature: 0.1 } },
        query: "q",
      },
      tweaks: { nodeA: { model: "x" } },
    });
    expect(n.input).toBe("q");
    expect(n.tweaks?.["nodeA"]).toEqual(expect.objectContaining({ model: "x", temperature: 0.1 }));
  });

  test("v2 structured input preserves uploaded file refs for ChatInput injection", () => {
    const n = normalizeRunBody({
      input: {
        files: [
          { file_path: "flow-1/2026-05-22_image.png", name: "image.png", mime: "image/png" },
          { path: "flow-1/2026-05-22_second.jpg", name: "second.jpg" },
        ],
        query: "describe image",
      },
    });

    expect(n.input).toBe("describe image");
    expect(n.input_files).toEqual([
      { file_path: "flow-1/2026-05-22_image.png", mime: "image/png", name: "image.png" },
      { name: "second.jpg", path: "flow-1/2026-05-22_second.jpg" },
    ]);
  });

  test("user_context and runtime_config passthrough", () => {
    const n = normalizeRunBody({
      input: "",
      runtime_config: { max_iterations: 3 },
      user_context: { user_id: "u1" },
    });
    expect(n.user_context.user_id).toBe("u1");
    expect(n.runtime_config.max_iterations).toBe(3);
  });

  test("top-level stream propagates to runtime_config when missing", () => {
    const n = normalizeRunBody({ input: "x", stream: false });
    expect(n.stream).toBe(false);
  });
});
