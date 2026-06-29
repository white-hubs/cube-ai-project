/**
 * 历史占位：Descriptor + Nacos 集成已迁至 Testcontainers。
 *
 *   USE_NACOS_TESTCONTAINERS=1 bun test packages/agent/engine/test/integration/descriptor-nacos.testcontainers.test.ts
 *   bun run test:nacos-containers
 *
 * 实现：`descriptor-nacos.testcontainers.test.ts`；基础设施：`@cube-ai/test-infra`（`nacos/nacos-server:v3.1.0`）。
 */
import { describe } from "bun:test";

describe.skip("Descriptor Nacos（已迁移 → descriptor-nacos.testcontainers.test.ts）", () => {});
