import { describe, expect, test } from "bun:test";

import { createAgenticClient } from "./client";

describe("FilesApi", () => {
  test("upload POSTs /files and parses response", async () => {
    let path = "";
    let body: unknown;
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      path = new URL(url).pathname;
      body = init?.body ? JSON.parse(String(init.body)) : undefined;
      return Response.json(
        {
          fileId: "file_abc",
          mimeType: "image/png",
          previewUrl: "/files/file_abc/preview",
          sha256: "a".repeat(64),
          size: 8,
          status: "UNBOUND",
        },
        { status: 200 },
      );
    };

    const client = createAgenticClient({
      auth: { provider: () => "tok" },
      baseUrl: "http://engine.test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const uploaded = await client.files.upload({
      base64: "iVBORw0KGgo=",
      fileName: "tiny.png",
      mimeType: "image/png",
    });

    expect(path).toBe("/files");
    expect(body).toEqual({
      base64: "iVBORw0KGgo=",
      fileName: "tiny.png",
      mimeType: "image/png",
    });
    expect(uploaded).toEqual({
      fileId: "file_abc",
      mimeType: "image/png",
      previewUrl: "/files/file_abc/preview",
      sha256: "a".repeat(64),
      size: 8,
      status: "UNBOUND",
    });
  });
});
