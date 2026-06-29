import { describe, expect, test } from "bun:test";

import { createKbClient } from "./client";

describe("KbClient", () => {
  test("search POST /kb/search — 返回 kb-core {items} 格式", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      capturedUrl = url;
      capturedInit = init;
      return Response.json({
        items: [{ headingPath: ["Section 1"], keywords: ["hello"], score: 0.9, text: "hello" }],
      });
    };

    const client = createKbClient({
      baseUrl: "http://ai-center.test",
      fetchImpl: fetchImpl as typeof fetch,
    });
    const result = await client.search({ query: "hello", topK: 3 });

    expect(capturedUrl).toBe("http://ai-center.test/kb/search");
    expect(capturedInit?.method).toBe("POST");
    expect(JSON.parse(String(capturedInit?.body))).toEqual({ query: "hello", topK: 3 });
    expect(result.items[0]?.text).toBe("hello");
    expect(result.items[0]?.score).toBe(0.9);
    expect(result.items[0]?.headingPath).toEqual(["Section 1"]);
  });

  test("searchByDocuments POST /kb/search/by-documents — 返回 kb-core {items} 格式", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      capturedUrl = url;
      capturedInit = init;
      return Response.json({
        items: [{ headingPath: [], keywords: [], score: 0.85, text: "matched chunk" }],
      });
    };

    const client = createKbClient({
      baseUrl: "http://ai-center.test",
      fetchImpl: fetchImpl as typeof fetch,
    });
    const result = await client.searchByDocuments({
      documents: [{ documentId: "doc-1", topK: 5 }],
      query: "test",
    });

    expect(capturedUrl).toBe("http://ai-center.test/kb/search/by-documents");
    expect(capturedInit?.method).toBe("POST");
    expect(result.items[0]?.text).toBe("matched chunk");
    expect(result.items[0]?.score).toBe(0.85);
  });

  test("searchByDirectory POST /kb/search/by-directory — 返回 kb-core {items} 格式", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      capturedUrl = url;
      capturedInit = init;
      return Response.json({
        items: [{ headingPath: null, keywords: null, score: 0.7, text: "dir chunk" }],
      });
    };

    const client = createKbClient({
      baseUrl: "http://ai-center.test",
      fetchImpl: fetchImpl as typeof fetch,
    });
    const result = await client.searchByDirectory({
      directoryId: "dir-1",
      query: "dir query",
      topK: 3,
    });

    expect(capturedUrl).toBe("http://ai-center.test/kb/search/by-directory");
    expect(capturedInit?.method).toBe("POST");
    expect(result.items[0]?.text).toBe("dir chunk");
    expect(result.items[0]?.score).toBe(0.7);
  });
});
