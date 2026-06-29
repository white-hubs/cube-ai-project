import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import {
  DEFAULT_CONNECTION_PROFILE,
  PROFILE_STORAGE_KEY,
  buildSdkClientConfig,
  loadConnectionProfile,
  normalizeProxyOrigin,
  normalizeSdkPathPrefix,
  persistConnectionSettings,
  saveConnectionProfile,
} from "./connection-profile";

const registeredHappyDom = globalThis.document === undefined;
if (registeredHappyDom) {
  GlobalRegistrator.register();
}

afterAll(async () => {
  if (registeredHappyDom) {
    await GlobalRegistrator.unregister();
  }
});

describe("connection-profile", () => {
  beforeAll(() => {
    localStorage.clear();
  });

  beforeEach(() => {
    localStorage.clear();
  });

  test("loadConnectionProfile returns defaults when storage is empty", () => {
    expect(loadConnectionProfile()).toEqual(DEFAULT_CONNECTION_PROFILE);
  });

  test("saveConnectionProfile persists and reloads headers", () => {
    const profile = {
      ...DEFAULT_CONNECTION_PROFILE,
      headers: { authorization: "Bearer tok", tenant: "99", terminal: "playground" },
    };
    saveConnectionProfile(profile);
    expect(localStorage.getItem(PROFILE_STORAGE_KEY)).not.toBeNull();
    expect(loadConnectionProfile().headers.tenant).toBe("99");
  });

  test("loadConnectionProfile migrates legacy browserBase field", () => {
    localStorage.setItem(
      PROFILE_STORAGE_KEY,
      JSON.stringify({
        browserBase: "/api/ai-center",
        headers: DEFAULT_CONNECTION_PROFILE.headers,
        proxyTarget: "http://127.0.0.1:3000",
      }),
    );
    expect(loadConnectionProfile().sdkPathPrefix).toBe("/api/ai-center");
  });

  test("buildSdkClientConfig assembles agent client baseUrl under sdk path prefix", () => {
    const cfg = buildSdkClientConfig(loadConnectionProfile(), "agent", "client");
    expect(cfg.baseUrl).toBe("/api/agent");
    expect(typeof cfg.headers).toBe("function");
  });

  test("buildSdkClientConfig honors custom sdk path prefix", () => {
    const profile = {
      ...DEFAULT_CONNECTION_PROFILE,
      sdkPathPrefix: "/api/ai-center",
    };
    const cfg = buildSdkClientConfig(profile, "agent", "client");
    expect(cfg.baseUrl).toBe("/api/ai-center/agent");
  });

  test("buildSdkClientConfig honors pathPrefix override for flow console", () => {
    const profile = {
      ...DEFAULT_CONNECTION_PROFILE,
      pathPrefixOverrides: { "flow-console": "/flow/custom-console" },
    };
    const cfg = buildSdkClientConfig(profile, "flow", "console");
    expect(cfg.baseUrl).toBe("/api");
    expect(cfg.pathPrefix).toBe("/flow/custom-console");
  });

  test("normalizeProxyOrigin strips path from pasted upstream URL", () => {
    expect(normalizeProxyOrigin("http://192.168.0.133:40201/api")).toBe("http://192.168.0.133:40201");
    expect(normalizeProxyOrigin("http://127.0.0.1:3000/")).toBe("http://127.0.0.1:3000");
  });

  test("normalizeSdkPathPrefix trims trailing slash", () => {
    expect(normalizeSdkPathPrefix("/api/ai-center/")).toBe("/api/ai-center");
    expect(normalizeSdkPathPrefix("api")).toBe("/api");
  });

  test("persistConnectionSettings saves normalized upstream and prefix", () => {
    const profile = {
      ...DEFAULT_CONNECTION_PROFILE,
      proxyTarget: "",
      sdkPathPrefix: "/api/ai-center/",
    };
    const next = persistConnectionSettings(profile, {
      proxyTarget: "http://127.0.0.1:3000/api",
      sdkPathPrefix: "/api/ai-center/",
    });
    expect(next.proxyTarget).toBe("http://127.0.0.1:3000");
    expect(next.sdkPathPrefix).toBe("/api/ai-center");
    expect(loadConnectionProfile().proxyTarget).toBe("http://127.0.0.1:3000");
    expect(loadConnectionProfile().sdkPathPrefix).toBe("/api/ai-center");
  });
});
