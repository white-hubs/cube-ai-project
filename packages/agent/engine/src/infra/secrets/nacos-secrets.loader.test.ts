import { describe, test, expect } from "bun:test";

import { AgenticEngineError } from "../errors/agentic-error";
import { NacosSecretsLoader } from "./nacos-secrets.loader";

const dummyConfig = {
  nacosAddress: "http://localhost:8848",
  nacosNamespace: "test",
  nacosUsername: "nacos",
  nacosPassword: "nacos",
};

describe("NacosSecretsLoader", () => {
  test("load() with empty nacos address uses env AGENTIC_SECRET_* only", async () => {
    const prev = process.env.AGENTIC_SECRET_DEV;
    process.env.AGENTIC_SECRET_DEV = "x";
    const loader = new NacosSecretsLoader({
      ...dummyConfig,
      nacosAddress: "",
    });
    await loader.load();
    expect(loader.get("DEV")).toBe("x");
    if (prev === undefined) {
      delete process.env.AGENTIC_SECRET_DEV;
    } else {
      process.env.AGENTIC_SECRET_DEV = prev;
    }
  });

  test("get() on missing key throws UNAVAILABLE_SECRET_NOT_FOUND", () => {
    const loader = new NacosSecretsLoader(dummyConfig);
    try {
      loader.get("DB_PASSWORD");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AgenticEngineError);
      expect((e as AgenticEngineError).code).toBe("UNAVAILABLE_SECRET_NOT_FOUND");
    }
  });

  test("get() returns value after seedForTest()", () => {
    const loader = new NacosSecretsLoader(dummyConfig);
    loader.seedForTest({ DB_PASSWORD: "hunter2" });
    expect(loader.get("DB_PASSWORD")).toBe("hunter2");
  });

  test("listAliases() returns all seeded keys", () => {
    const loader = new NacosSecretsLoader(dummyConfig);
    loader.seedForTest({ DB_PASSWORD: "pw", REDIS_AUTH: "secret" });
    const aliases = loader.listAliases();
    expect(aliases).toContain("DB_PASSWORD");
    expect(aliases).toContain("REDIS_AUTH");
    expect(aliases).toHaveLength(2);
  });

  test("get() error contains refAlias", () => {
    const loader = new NacosSecretsLoader(dummyConfig);
    try {
      loader.get("MISSING_KEY");
      expect.unreachable();
    } catch (e) {
      expect(String((e as Error).message)).toContain("MISSING_KEY");
    }
  });

  test("getPublicKey() returns null when no keys loaded", () => {
    const loader = new NacosSecretsLoader(dummyConfig);
    expect(loader.getPublicKey("kid-1")).toBeNull();
  });

  test("verifyAcceptedKids() returns empty array initially", () => {
    const loader = new NacosSecretsLoader(dummyConfig);
    expect(loader.verifyAcceptedKids()).toEqual([]);
  });
});
