import { HttpException } from "@dangao/bun-server";
import { describe, expect, test } from "bun:test";

import { CUBE_FLOW_SCHEMA_VERSION, type CubeFlowGraph, type CubeFlowNode } from "../contracts/cube-flow";
import { isChatInputLfKey, isLlmLfKey, lfKeyFromCubeType, resolveLinearExecutionChain } from "./linear-chain";

function node(partial: Partial<CubeFlowNode> & Pick<CubeFlowNode, "id" | "cubeType">): CubeFlowNode {
  return {
    config: {},
    height: 1,
    lfNodeId: partial.id,
    width: 1,
    x: 0,
    y: 0,
    ...partial,
  };
}

function graph(nodes: CubeFlowNode[], edges: CubeFlowGraph["edges"]): CubeFlowGraph {
  return { edges, nodes, schemaVersion: CUBE_FLOW_SCHEMA_VERSION };
}

describe("linear-chain", () => {
  test("lfKeyFromCubeType strips cube.lf.", () => {
    expect(lfKeyFromCubeType("cube.lf.ChatInput")).toBe("ChatInput");
    expect(lfKeyFromCubeType("X")).toBe("X");
  });

  test("isChatInputLfKey and isLlmLfKey", () => {
    expect(isChatInputLfKey("ChatInput")).toBe(true);
    expect(isLlmLfKey("OpenAIModel")).toBe(true);
    expect(isLlmLfKey("FooLanguageModelBar")).toBe(true);
  });

  test("resolveLinearExecutionChain single path", () => {
    const g = graph(
      [node({ cubeType: "cube.lf.ChatInput", id: "a" }), node({ cubeType: "cube.lf.OpenAIModel", id: "b" })],
      [
        {
          id: "e1",
          source: "a",
          sourcePort: "o:x",
          target: "b",
          targetPort: "i:y",
        },
      ],
    );
    const chain = resolveLinearExecutionChain(g);
    expect(chain.map((n) => n.id)).toEqual(["a", "b"]);
  });

  test("reject zero or multiple sources", () => {
    const two = graph([node({ cubeType: "x", id: "a" }), node({ cubeType: "y", id: "b" })], []);
    expect(() => resolveLinearExecutionChain(two)).toThrow(HttpException);

    const merged = graph(
      [node({ cubeType: "x", id: "a" }), node({ cubeType: "y", id: "b" }), node({ cubeType: "z", id: "c" })],
      [
        { id: "1", source: "a", sourcePort: "o", target: "c", targetPort: "i" },
        { id: "2", source: "b", sourcePort: "o", target: "c", targetPort: "i" },
      ],
    );
    expect(() => resolveLinearExecutionChain(merged)).toThrow(HttpException);
  });

  test("reject branch and cycle", () => {
    const branch = graph(
      [node({ cubeType: "x", id: "a" }), node({ cubeType: "y", id: "b" }), node({ cubeType: "z", id: "c" })],
      [
        { id: "1", source: "a", sourcePort: "o", target: "b", targetPort: "i" },
        { id: "2", source: "a", sourcePort: "o", target: "c", targetPort: "i" },
      ],
    );
    expect(() => resolveLinearExecutionChain(branch)).toThrow(HttpException);

    const cycle = graph(
      [node({ cubeType: "x", id: "a" }), node({ cubeType: "y", id: "b" })],
      [
        { id: "1", source: "a", sourcePort: "o", target: "b", targetPort: "i" },
        { id: "2", source: "b", sourcePort: "o", target: "a", targetPort: "i" },
      ],
    );
    expect(() => resolveLinearExecutionChain(cycle)).toThrow(HttpException);
  });

  test("invalid edge target", () => {
    const g = graph([node({ cubeType: "x", id: "a" })], [{ id: "1", source: "a", sourcePort: "o", target: "missing", targetPort: "i" }]);
    expect(() => resolveLinearExecutionChain(g)).toThrow(HttpException);
  });
});
