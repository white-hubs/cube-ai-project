import { BadRequestException, HttpException } from "@dangao/bun-server";
import { describe, expect, it } from "bun:test";

import type { Cube2FileClients } from "./cube2-file-client";
import { Cube2ProviderIconStore } from "./cube2-provider-icon-store";

interface FakeFile {
  endpointPath?: string;
  path?: string;
  name?: string;
}

function makeStore(options: {
  induceValue?: boolean;
  file?: FakeFile | undefined;
  onInduce?: (request: { sceneCode: string; businessKey: bigint; fileId: bigint }) => void;
  onGetById?: (request: { id: bigint }) => void;
}) {
  const fileClients = {
    getFileCoreClient: async () => ({
      getById: async (request: { id: bigint }) => {
        options.onGetById?.(request);
        return { file: options.file };
      },
    }),
    getFileOperateClient: async () => ({
      fileInduceSingle: async (request: { sceneCode: string; businessKey: bigint; fileId: bigint }) => {
        options.onInduce?.(request);
        return { value: options.induceValue ?? true };
      },
    }),
  } as unknown as Cube2FileClients;
  return new Cube2ProviderIconStore(fileClients);
}

describe("Cube2ProviderIconStore", () => {
  it("returns trimmed fallbackIconUrl directly when iconFileId is empty", async () => {
    const store = makeStore({
      onInduce: () => {
        throw new Error("must not call file service");
      },
    });
    expect(
      await store.persistProviderIcon({
        fallbackIconUrl: "  https://cdn.example/icon.png  ",
        iconFileId: null,
        providerId: "1",
      }),
    ).toBe("https://cdn.example/icon.png");

    expect(await store.persistProviderIcon({ fallbackIconUrl: "   ", iconFileId: "  ", providerId: "1" })).toBeNull();
  });

  it("rejects non-numeric iconFileId with BadRequestException before any rpc", async () => {
    const store = makeStore({
      onInduce: () => {
        throw new Error("must not call file service");
      },
    });
    await expect(
      store.persistProviderIcon({
        fallbackIconUrl: null,
        iconFileId: "abc-123",
        providerId: "1",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("binds file via fileInduceSingle with scene code and BigInt ids, then resolves endpointPath", async () => {
    let induceArgs: { sceneCode: string; businessKey: bigint; fileId: bigint } | undefined;
    let getByIdArgs: { id: bigint } | undefined;
    const store = makeStore({
      file: { endpointPath: " https://files.example/p.png ", name: "p.png", path: "/raw" },
      induceValue: true,
      onGetById: (request) => {
        getByIdArgs = request;
      },
      onInduce: (request) => {
        induceArgs = request;
      },
    });

    const url = await store.persistProviderIcon({
      fallbackIconUrl: null,
      iconFileId: "123456789123456789",
      providerId: "987654321987654321",
    });

    expect(url).toBe("https://files.example/p.png");
    expect(induceArgs?.sceneCode).toBe("AI_APPLICATION::LLM_PROVIDER::ICON");
    expect(induceArgs?.businessKey).toBe(987654321987654321n);
    expect(induceArgs?.fileId).toBe(123456789123456789n);
    expect(getByIdArgs?.id).toBe(123456789123456789n);
  });

  it("falls back endpointPath → path → name → fallbackIconUrl", async () => {
    expect(
      await makeStore({ file: { endpointPath: " ", name: "icon.png", path: "/raw/icon.png" } }).persistProviderIcon({
        fallbackIconUrl: null,
        iconFileId: "2",
        providerId: "1",
      }),
    ).toBe("/raw/icon.png");

    expect(
      await makeStore({ file: { name: "icon.png" } }).persistProviderIcon({
        fallbackIconUrl: null,
        iconFileId: "2",
        providerId: "1",
      }),
    ).toBe("icon.png");

    expect(
      await makeStore({ file: undefined }).persistProviderIcon({
        fallbackIconUrl: "https://cdn.example/fallback.png",
        iconFileId: "2",
        providerId: "1",
      }),
    ).toBe("https://cdn.example/fallback.png");
  });

  it("throws 500 when induce does not confirm persistence", async () => {
    const store = makeStore({ induceValue: false });
    const promise = store.persistProviderIcon({
      fallbackIconUrl: null,
      iconFileId: "2",
      providerId: "1",
    });
    await expect(promise).rejects.toBeInstanceOf(HttpException);
    await expect(promise).rejects.toThrow("供应商图标持久化失败");
  });

  it("throws 500 when no icon url can be resolved at all", async () => {
    const store = makeStore({ file: {}, induceValue: true });
    await expect(store.persistProviderIcon({ fallbackIconUrl: null, iconFileId: "2", providerId: "1" })).rejects.toThrow(
      "供应商图标地址解析失败",
    );
  });
});
