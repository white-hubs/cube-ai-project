import { isGlobalModule } from "@dangao/bun-server";
import { describe, expect, test } from "bun:test";

import { tenantContextAls } from "@cube-ai/tenant-context";

import { createEnvFallbackTenantResolver, parseTenantId } from "../../../../packages/llm/core/src/http/request-tenant";
import { AiCenterDomainHttpModule } from "./ai-center-domain-http.module";
import { AiCenterKbHttpModule } from "./ai-center-kb-http.module";

/**
 * 离线冒烟：两个 HTTP 域模块（DI 装配，重逻辑在工厂内、需 MySQL）至少应能
 * 离线 import 且保持 @Global 标记 —— 防止依赖图引入 import 期副作用或误删 @Global。
 */
describe("ai-center http modules (offline smoke)", () => {
  test("AiCenterDomainHttpModule is importable and marked @Global", () => {
    expect(typeof AiCenterDomainHttpModule).toBe("function");
    expect(isGlobalModule(AiCenterDomainHttpModule)).toBe(true);
  });

  test("AiCenterKbHttpModule is importable and marked @Global", () => {
    expect(typeof AiCenterKbHttpModule).toBe("function");
    expect(isGlobalModule(AiCenterKbHttpModule)).toBe(true);
  });
});

describe("ai-center LLM tenant resolver wiring", () => {
  test("resolveActive reads tenantContextAls tenant header (ghcloud execution-auth path)", () => {
    const resolve = createEnvFallbackTenantResolver(() => parseTenantId("58197260"));
    tenantContextAls.run({ tenantId: "58197260" }, () => {
      expect(resolve()).toBe(58197260);
    });
  });
});
