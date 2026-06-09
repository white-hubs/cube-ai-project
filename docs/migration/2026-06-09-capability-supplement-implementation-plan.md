# 能力补充 实现计划（Capability Supplement Implementation Plan）

> **For agentic workers:** 用 `executing-plans` / `subagent-driven-development` 逐任务实现。步骤用 `- [ ]` 复选框跟踪。每个任务自包含、可独立验收。
> 决策依据：[capability-supplement-plan.md](./capability-supplement-plan.md)、[ADR-0012 addendum](../adr/ADR-0012-addendum-tenant-single-isolation-no-project.md)、`CONTEXT.md`。

**Goal:** 把 5 项「上线阻断」能力补齐，使新系统达到真实租户生产切换可用。

**Architecture:** 单进程 `apps/ai-center` 组合根装配 `agent-engine` + `flow-core` + `kb-core` + `llm-core` + `platform-adapter-ghcloud`。身份唯一权威 = platform-adapter（JWT/tenant）；tenant 为单一隔离主键；catalog 为凭据/模型权威；fresh-start 不迁历史数据。

**Tech Stack:** Bun + `@dangao/bun-server`（NestJS 风格 DI）、TypeScript、`@connectrpc/connect`(gRPC)、MySQL(mysql2)、Qdrant、zod、`bun test`。

**根命令：** `bun run typecheck`（全仓）、`bun test <path>`（按包/目录）、`bun run test:offline`。

---

## 工作流总览与依赖

| WS | 名称 | 依赖 | 风险 | 可并行 |
|---|---|---|---|---|
| WS1 | 权威系统级 catalog seed | 无 | 低 | ✅ |
| WS2 | LLM provider 补全（anthropic + 文生图） | 无 | 中 | ✅ |
| WS3 | 多租户身份基座（identity 默认开 + tenant 注入） | 无 | 中 | ✅ |
| WS4 | project/flow 鉴权退役 + `project_id→tenant_id` 改名 | WS3 | **高** | 与 WS1/2/5 可并行，WS3 后做 |
| WS5 | KB 平台源文档桥（cube2 content gRPC） | 无 | 中 | ✅ |

**推荐顺序：** WS1 → WS2 → WS3 → WS5 →（最后做大改名）WS4。WS4 触面最广，放后面减少与其它 WS 的冲突；新文件在 WS4 时一并 tenant 化。

**全局收尾门禁（所有 WS 完成后）：**
- [ ] `bun run typecheck` 全仓绿
- [ ] `bun run test:offline` 绿
- [ ] `rg -n "project_id|projectId|currentProjectId|createFlowProjectLookup|allowed_tools" packages apps --glob '!**/*.test.ts'` 仅剩允许项（见 WS4 验收）
- [ ] 直连例外门禁：`rg -n "api\.openai\.com|dashscope\.aliyuncs\.com|anthropic\.com" --glob '!docs/**' --glob '!**/*.test.ts' packages apps` 命中项均在 `docs/direct-vendor-exceptions.md` 登记

---

## WS1 — 权威系统级 catalog seed

**背景：** fresh-start 下租户首访 `listProviders` 触发 lazy provisioning，把**系统模板**复制成租户副本。当前系统种子是 dev 占位（`CUBE_AI_CATALOG_DEV_SEED`）。需提供权威 seed（provider types / providers / models / match-rules），否则租户拿到空模板。

**File Structure:**
- Create: `packages/llm/core/src/catalog/repositories/system-seed.data.ts` — 权威系统种子常量（唯一职责：数据）。
- Create: `packages/llm/core/src/catalog/repositories/system-seed.data.test.ts` — seed 形状/不变量校验。
- Modify: `packages/llm/core/src/catalog/repositories/seed.ts` — 导出权威 seed 入口（复用现有 `upsertSystemCatalogMysql`）。
- Modify: `packages/llm/core/src/catalog/repositories/index.ts` — 导出新符号。
- Reference: `deploy/docker-compose/mysql/init/03-llm-catalog.sql`（列定义对账）、`packages/llm/core/src/catalog/repositories/row-types.ts`（行类型）。

### Task 1.1: 定位当前占位种子注入点

- [ ] **Step 1: 找到 dev 占位 seed 与注入处**

Run: `rg -n "CUBE_AI_CATALOG_DEV_SEED|upsertSystemCatalogMysql|upsertCatalogSeedMysql|DEV_SEED" packages/llm/core/src`
Expected: 命中 `LlmCatalogModule`（或 `mysql-catalog.store.ts`）里 dev 种子分支 + `seed.ts` 的 upsert 函数。记录文件:行号到本任务笔记。

- [ ] **Step 2: 读 `row-types.ts` 确认字段**

Run: `bun run --silent cat packages/llm/core/src/catalog/repositories/row-types.ts`（或用编辑器 Read）
Expected: 得到 `SystemTypeRow` / `SystemProviderRow` / `SystemModelRow` / `MatchRuleRow` 的精确字段名，供 seed 数据填值（禁止臆造字段）。

### Task 1.2: 编写权威 seed 数据 + 测试

- [ ] **Step 1: 写失败测试** `system-seed.data.test.ts`

```ts
import { describe, expect, it } from 'bun:test';
import { AUTHORITATIVE_SYSTEM_CATALOG_SEED } from './system-seed.data';

describe('AUTHORITATIVE_SYSTEM_CATALOG_SEED', () => {
  it('every provider references an existing type_code', () => {
    const types = new Set((AUTHORITATIVE_SYSTEM_CATALOG_SEED.types ?? []).map((t) => t.code));
    for (const p of AUTHORITATIVE_SYSTEM_CATALOG_SEED.providers ?? []) {
      expect(types.has(p.type_code)).toBe(true);
    }
  });

  it('every model references an existing provider_code and has endpoint_type', () => {
    const providers = new Set((AUTHORITATIVE_SYSTEM_CATALOG_SEED.providers ?? []).map((p) => p.provider_code));
    for (const m of AUTHORITATIVE_SYSTEM_CATALOG_SEED.models ?? []) {
      expect(providers.has(m.provider_code)).toBe(true);
      expect(typeof m.endpoint_type).toBe('string');
      expect(m.endpoint_type.length).toBeGreaterThan(0);
    }
  });

  it('match rules reference known endpoint_type values', () => {
    const known = new Set(['openai','openai_response','anthropic','gemini','azure_openai','new_api','openai_image','jina_rerank','ollama','geekai','dashscope','dashscope_text2image','volcengine_ark']);
    for (const r of AUTHORITATIVE_SYSTEM_CATALOG_SEED.matchRules ?? []) {
      expect(known.has(r.endpoint_type)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test packages/llm/core/src/catalog/repositories/system-seed.data.test.ts`
Expected: FAIL（`AUTHORITATIVE_SYSTEM_CATALOG_SEED` 未定义）

- [ ] **Step 3: 写 `system-seed.data.ts`**

按 Task 1.1 Step 2 拿到的真实行类型填充。**数据来源 = `03-llm-catalog.sql` 中既有的系统行 + 业务确认在用的厂商**（openai 兼容 / dashscope / volcengine_ark / anthropic / 文生图 等）。结构：

```ts
import type { SystemCatalogSeed } from './seed';

export const AUTHORITATIVE_SYSTEM_CATALOG_SEED: SystemCatalogSeed = {
  types: [
    // { code: 'openai', display_name: 'OpenAI 兼容', sort_order: 10, enabled: true, description: '...' },
    // … 按 row-types.ts 字段补全真实厂商类型
  ],
  providers: [
    // { provider_code, type_code, name, icon, … }
  ],
  models: [
    // { model_code, provider_code, display_name, api_base_url, endpoint_type, model_types, is_free, supports_test, … }
  ],
  matchRules: [
    // { match_type, pattern, native_family, endpoint_type, adapter_key, model_types, priority, … }
  ],
};
```

> 注：seed 行的字段集合必须与 `row-types.ts` 完全一致。逐条对照 `03-llm-catalog.sql` 的 INSERT/列定义；缺失字段补 null/默认值（不要新增列）。

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test packages/llm/core/src/catalog/repositories/system-seed.data.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/llm/core/src/catalog/repositories/system-seed.data.ts packages/llm/core/src/catalog/repositories/system-seed.data.test.ts
git commit -m "feat(llm-core): add authoritative system catalog seed data"
```

### Task 1.3: 用权威 seed 替换 dev 占位注入

- [ ] **Step 1: 改注入点**

在 Task 1.1 Step 1 定位的注入处，把占位 seed 换成 `AUTHORITATIVE_SYSTEM_CATALOG_SEED`，并加 env 开关 `CUBE_AI_CATALOG_SEED_SYSTEM=1`（默认在有 MySQL 时启动 warm-load 一次 `upsertSystemCatalogMysql(pool, AUTHORITATIVE_SYSTEM_CATALOG_SEED)`）。保留 dev 占位仅当显式 `CUBE_AI_CATALOG_DEV_SEED=1`。

- [ ] **Step 2: typecheck**

Run: `bun run --filter @cube-ai/llm-core typecheck`
Expected: PASS

- [ ] **Step 3: 回归 llm-core 单测**

Run: `bun test packages/llm/core/src/catalog`
Expected: PASS（既有 provisioning/metadata 测试不回归）

- [ ] **Step 4: 提交**

```bash
git add packages/llm/core/src
git commit -m "feat(llm-core): seed authoritative system catalog on warm-load (replaces dev placeholder)"
```

---

## WS2 — LLM provider 补全（anthropic + 文生图）

**背景：** `catalog-driven-provider.ts` 当前对 `anthropic`/`gemini`/`geekai`/`jina_rerank` 抛 `not yet supported`，对 `dashscope_text2image`/`openai_image` 错路由到 openai-compat（无异步轮询）。按裁决：补 **anthropic 原生 chat** + **文生图（dashscope-text2image、geekai-nano-banana）**；gemini/jina_rerank 不补。

**关键差异：** 新仓 provider 实现 `LlmProviderPort`（`chat/chatStream/embed`），**不是** 原仓的 `@tachu/core` `ProviderAdapter`。原仓代码作**逻辑参考**，按 `packages/llm/core/src/provider/openai-compat-provider.ts` 的范式重写。文生图无 chat 语义 → 走独立 `ImageGenerationPort`（见 Task 2.3）。

**File Structure:**
- Create: `packages/llm/core/src/provider/anthropic-provider.ts` (+ `.test.ts`) — 实现 `LlmProviderPort` 的 Anthropic Messages API。
- Create: `packages/llm/core/src/provider/image/dashscope-text2image-provider.ts` (+ `.test.ts`)
- Create: `packages/llm/core/src/provider/image/geekai-nano-banana-provider.ts` (+ `.test.ts`)
- Create: `packages/contracts/src/platform/image-generation.ts` (+ 在 `packages/contracts/src/platform/index.ts` 导出) — `ImageGenerationPort` + wire schema + DI token。
- Create: `packages/llm/core/src/provider/image/catalog-image-provider.ts` (+ `.test.ts`) — 按 endpointType 路由到具体文生图 provider。
- Modify: `packages/llm/core/src/provider/catalog-driven-provider.ts:103-110` — anthropic 改真实现；image endpointType 不再误路由。
- Modify: `packages/llm/core/src/index.ts` — 导出新 provider/port。
- Modify: `packages/agent/engine/src/bc/tools/handlers/qwen-image-handler.ts` — 改 delegate 到 `ImageGenerationPort`（消 env 直连旁路，env 仅 dev fallback）。
- Reference（仅逻辑参考，不直接 copy）：`cube-agentic-engine/packages/agentic-adapters/src/provider/{anthropic-provider,dashscope-text2image-provider,geekai-nano-banana-image-provider}.ts`。

### Task 2.1: anthropic provider（实现 LlmProviderPort）

- [ ] **Step 1: 读范式与契约**

Read: `packages/llm/core/src/provider/openai-compat-provider.ts`（class 形状、`LlmProviderError`、`chat/chatStream/embed` 签名）；`packages/contracts/src/platform/llm-provider.ts:125-128`（`LlmProviderPort`）；`packages/contracts/src/platform/llm-provider.ts` 中 `LlmChatRequest`/`LlmChatResponse`/`LlmStreamChunk` 形状。

- [ ] **Step 2: 写失败测试** `anthropic-provider.test.ts`

```ts
import { describe, expect, it } from 'bun:test';
import { AnthropicProvider } from './anthropic-provider';

function fakeFetch(body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
}

describe('AnthropicProvider', () => {
  it('maps a non-stream messages response to LlmChatResponse', async () => {
    const provider = new AnthropicProvider({
      baseURL: 'https://api.anthropic.com',
      apiKey: 'sk-test',
      model: 'claude-3-5-sonnet',
      fetchImpl: fakeFetch({
        content: [{ type: 'text', text: 'hello' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 3, output_tokens: 2 },
      }),
    });
    const res = await provider.chat({
      tenant: 1, modelCode: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.content).toContain('hello');
  });
});
```

> 注：`chat` 入参/出参字段以 Step 1 读到的真实 `LlmChatRequest`/`LlmChatResponse` 为准，按需调整断言字段名。

- [ ] **Step 3: 跑测试确认失败**

Run: `bun test packages/llm/core/src/provider/anthropic-provider.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 4: 实现 `anthropic-provider.ts`**

按 openai-compat-provider 范式实现 `class AnthropicProvider implements LlmProviderPort`，构造参数 `{ baseURL, apiKey, model, fetchImpl? }`。Messages API 映射逻辑参考原仓 `anthropic-provider.ts`（消息→`messages[]`、system 抽离、stream 事件 `content_block_delta`→`LlmStreamChunk`、`stop_reason`→finishReason、usage 映射）。错误统一抛 `LlmProviderError`。`embed` 抛 `UPSTREAM_LLM_UNAVAILABLE`（anthropic 无 embed）。

- [ ] **Step 5: 跑测试确认通过 + typecheck**

Run: `bun test packages/llm/core/src/provider/anthropic-provider.test.ts && bun run --filter @cube-ai/llm-core typecheck`
Expected: PASS

- [ ] **Step 6: 接入 catalog-driven 路由**

Modify `catalog-driven-provider.ts`：把 `case 'anthropic':` 从 throw 改为 `return { id:'anthropic', chat/chatStream/embed → new AnthropicProvider({ baseURL: cfg.apiBaseUrl, apiKey: cfg.apiKey, model: cfg.modelCode }) }`（仿 openai-compat 分支）。`gemini`/`jina_rerank` 保留 throw（不在范围）。

- [ ] **Step 7: 回归 + 提交**

Run: `bun test packages/llm/core/src/provider`
Expected: PASS

```bash
git add packages/llm/core/src/provider/anthropic-provider.ts packages/llm/core/src/provider/anthropic-provider.test.ts packages/llm/core/src/provider/catalog-driven-provider.ts packages/llm/core/src/index.ts
git commit -m "feat(llm-core): native anthropic chat provider + wire into catalog-driven routing"
```

### Task 2.2: 定义 ImageGenerationPort（contracts）

- [ ] **Step 1: 写失败测试** `packages/contracts/src/platform/image-generation.test.ts`

```ts
import { describe, expect, it } from 'bun:test';
import { ImageGenerationRequestSchema } from './image-generation';

describe('ImageGenerationRequestSchema', () => {
  it('parses a minimal text2image request', () => {
    const r = ImageGenerationRequestSchema.parse({ tenant: 1, modelCode: 'qwen-image', prompt: 'a cat' });
    expect(r.prompt).toBe('a cat');
  });
});
```

- [ ] **Step 2: 跑确认失败**

Run: `bun test packages/contracts/src/platform/image-generation.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 `image-generation.ts`**

```ts
import { z } from 'zod';

export const ImageGenerationRequestSchema = z.object({
  tenant: z.number(),
  modelCode: z.string(),
  prompt: z.string(),
  referenceImages: z.array(z.string()).optional(),
  n: z.number().int().positive().max(4).optional(),
  size: z.string().optional(),
  negativePrompt: z.string().optional(),
  seed: z.number().int().optional(),
});
export type ImageGenerationRequest = z.infer<typeof ImageGenerationRequestSchema>;

export interface GeneratedImage { url: string }
export interface ImageGenerationResult { requestId: string | null; model: string; images: GeneratedImage[] }

export interface ImageGenerationPort {
  generate(req: ImageGenerationRequest, signal?: AbortSignal): Promise<ImageGenerationResult>;
}

export const AGENTIC_PLATFORM_IMAGE_GENERATION_TOKEN = Symbol.for('agentic.adapter.platform.image-generation');
```

- [ ] **Step 4: 在 `packages/contracts/src/platform/index.ts` 导出**；跑测试 + contracts typecheck。

Run: `bun test packages/contracts/src/platform/image-generation.test.ts && bun run --filter @cube-ai/contracts typecheck`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/contracts/src/platform/image-generation.ts packages/contracts/src/platform/image-generation.test.ts packages/contracts/src/platform/index.ts
git commit -m "feat(contracts): add ImageGenerationPort + wire schema"
```

### Task 2.3: 文生图 provider（dashscope-text2image + geekai）+ catalog 路由

- [ ] **Step 1: 写失败测试** `catalog-image-provider.test.ts`

```ts
import { describe, expect, it } from 'bun:test';
import { createImageProviderFromRuntimeConfig } from './catalog-image-provider';

describe('createImageProviderFromRuntimeConfig', () => {
  it('routes dashscope_text2image to the dashscope provider', () => {
    const p = createImageProviderFromRuntimeConfig({
      modelCode: 'wan2.2-t2i', displayName: 'wan', endpointType: 'dashscope_text2image',
      apiBaseUrl: 'https://dashscope.aliyuncs.com', apiKey: 'k', modelTypes: ['image_generation'], isFree: false, providerCode: 'dashscope',
    });
    expect(p.id).toBe('dashscope-text2image');
  });
  it('routes geekai nano-banana to the geekai provider', () => {
    const p = createImageProviderFromRuntimeConfig({
      modelCode: 'nano-banana', displayName: 'nb', endpointType: 'geekai',
      apiBaseUrl: 'https://geekai.co', apiKey: 'k', modelTypes: ['image_generation'], isFree: false, providerCode: 'geekai',
    });
    expect(p.id).toBe('geekai-nano-banana');
  });
});
```

- [ ] **Step 2: 跑确认失败**

Run: `bun test packages/llm/core/src/provider/image/catalog-image-provider.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现两个 image provider**

`dashscope-text2image-provider.ts`：`class DashscopeText2ImageProvider implements ImageGenerationPort`，构造 `{ apiBaseUrl, apiKey, modelCode, fetchImpl? }`。逻辑参考原仓同名文件：POST `.../services/aigc/multimodal-generation/generation`，含**异步任务轮询**（提交→拿 task_id→轮询 task 状态→取 image url）。错误抛 `LlmProviderError`。
`geekai-nano-banana-provider.ts`：`class GeekaiNanoBananaProvider implements ImageGenerationPort`，逻辑参考原仓 `geekai-nano-banana-image-provider.ts`。
复用 `catalog-provider-routing.ts` 的 `normalizeDashscopeOpenAiBaseUrl` / `shouldUseGeekaiNanoBananaImageProvider` 判定。

- [ ] **Step 4: 实现 `catalog-image-provider.ts`**（按 endpointType 选 provider）+ `CatalogImageProvider implements ImageGenerationPort`（注入 `LlmCatalogPort`，`resolveModelRuntime`→选 provider，仿 `CatalogDrivenProvider` 的 TTL LRU 缓存）。

- [ ] **Step 5: 跑测试 + typecheck**

Run: `bun test packages/llm/core/src/provider/image && bun run --filter @cube-ai/llm-core typecheck`
Expected: PASS

- [ ] **Step 6: catalog-driven-provider 去误路由**

Modify `catalog-driven-provider.ts`：`dashscope_text2image` / `openai_image` 从 chat switch 移除，改为抛明确错误 `'image generation endpointType must use ImageGenerationPort, not chat provider'`（避免静默错路由到 openai-compat）。

- [ ] **Step 7: 回归 + 提交**

Run: `bun test packages/llm/core/src/provider`
Expected: PASS

```bash
git add packages/llm/core/src/provider/image packages/llm/core/src/provider/catalog-driven-provider.ts packages/llm/core/src/index.ts
git commit -m "feat(llm-core): catalog-driven image generation (dashscope-text2image + geekai), remove chat mis-route"
```

### Task 2.4: qwen-image-handler 改走 ImageGenerationPort

- [ ] **Step 1: 注册 image provider DI**

在 `packages/agent/engine/src/adapters/platform/`（或 `llm-provider.module`）新增/扩展 module 提供 `AGENTIC_PLATFORM_IMAGE_GENERATION_TOKEN` = `new CatalogImageProvider({ catalog: c.resolve(AGENTIC_PLATFORM_LLM_CATALOG_TOKEN) })`。在 `ai-center-assembler.ts` 已有的 `LlmProviderModule` 处一并 export 该 token。

- [ ] **Step 2: 改 handler delegate**

Modify `qwen-image-handler.ts`：构造时注入 `ImageGenerationPort`（resolve `AGENTIC_PLATFORM_IMAGE_GENERATION_TOKEN`）；`invoke` 改为 `port.generate({ tenant, modelCode, prompt, referenceImages, ... })`，删除 handler 内直接 `fetch` DashScope 的逻辑；env `DASHSCOPE_API_KEY`/`QWEN_IMAGE_MODEL` 仅当 catalog 无解析时的 dev fallback（保留登记于例外清单）。

- [ ] **Step 3: 回归 handler 单测**

Run: `bun test packages/agent/engine/src/bc/tools/handlers/qwen-image-handler.test.ts`
Expected: PASS（按新 delegate 形态更新测试；断言改为 mock ImageGenerationPort）

- [ ] **Step 4: typecheck + 提交**

Run: `bun run --filter @cube-ai/agent-engine typecheck`
Expected: PASS

```bash
git add packages/agent/engine/src
git commit -m "feat(agent-engine): qwen-image-handler delegates to ImageGenerationPort (sunset env bypass)"
```

---

## WS3 — 多租户身份基座

**背景：** `USE_GHCLOUD_IDENTITY` 仍 opt-in（默认 Mock）。需转默认、并把 tenant 作为隔离上下文注入。`projectLookup` 机制将在 WS4 删除；本 WS 先打通 identity 默认链路、把 tenant 写入上下文。

**File Structure:**
- Modify: `apps/ai-center/src/bootstrap.ts:135-161` — identity 默认开（除非 `USE_GHCLOUD_IDENTITY=0`）；缺 `JWT_KEY_URL` fail-fast。
- Modify: `apps/ai-center/src/test-helpers/ai-center-test-env.ts` — 测试默认走 mock identity（保持离线测试可跑）。
- Reference: `packages/platform-adapters/ghcloud/src/readers.ts`（`createGhcloudExecutionAuthReaders`/`createGhcloudIdentityMiddleware`）。

### Task 3.1: identity 默认开

- [ ] **Step 1: 写失败测试**（扩 `apps/ai-center/src/identity-e2e.test.ts`）

新增用例：不设 `USE_GHCLOUD_IDENTITY` 但设 `JWT_KEY_URL` 时，默认启用 ghcloud 中间件链；`USE_GHCLOUD_IDENTITY=0` 时才回退 mock。

```ts
it('enables ghcloud identity by default when JWT_KEY_URL is set', async () => {
  delete process.env.USE_GHCLOUD_IDENTITY;
  process.env.JWT_KEY_URL = keyUrl;
  const app = await bootstrapAiCenter(/* test opts */);
  const res = await app.handle(new Request('http://x/v1/sessions', { headers: { /* no jwt */ } }));
  expect(res.status).toBe(401); // 默认要求 JWT
});
```

- [ ] **Step 2: 跑确认失败**

Run: `bun test apps/ai-center/src/identity-e2e.test.ts`
Expected: FAIL（当前默认 mock 放行）

- [ ] **Step 3: 改 bootstrap 默认逻辑**

Modify `bootstrap.ts`：
```ts
const useGhcloudIdentity =
  (Bun.env.USE_GHCLOUD_IDENTITY ?? process.env.USE_GHCLOUD_IDENTITY) !== '0';
```
（默认 true；显式 `=0` 才走 mock）。缺 `JWT_KEY_URL` 时若 `useGhcloudIdentity` 仍 throw（现有逻辑保留）。`ai-center-test-env.ts` 默认注入 `USE_GHCLOUD_IDENTITY=0` 保离线测试。

- [ ] **Step 4: 跑测试 + typecheck**

Run: `bun test apps/ai-center/src/identity-e2e.test.ts && bun run --filter @cube-ai/ai-center typecheck`
Expected: PASS

- [ ] **Step 5: 同步 `.env.example` / runbook**（`USE_GHCLOUD_IDENTITY` 默认语义反转说明）

- [ ] **Step 6: 提交**

```bash
git add apps/ai-center/src deploy docs/migration/cutover-runbook.md
git commit -m "feat(ai-center): enable ghcloud identity by default (opt-out via USE_GHCLOUD_IDENTITY=0)"
```

---

## WS4 — project/flow 鉴权退役 + `project_id → tenant_id` 改名

**背景（高风险，触面最广）：** 删除 cube-ai project 概念与 flow 自有鉴权；`project_id`→`tenant_id` 全量改名（flow/kb 本体 + Qdrant payload 键 + server-shared 读符号）。依据 ADR-0012 addendum。

**File Structure（按子工作分批，每批独立提交 + 回归）：**
- 4A 删 flow 鉴权/projects 接线：`packages/flow/core/src/flow.module.ts`、删 `auth/`、`api-keys/`、`projects/` 目录。
- 4B 删 projectLookup 机制：`apps/ai-center/src/bootstrap.ts`、`packages/flow/core/src/middleware/`、`flow-auth-adapters.ts`、`server-base` execution-auth 的 projectLookup 依赖。
- 4C tenant 注入：`flow-platform-ports.ts`、`server-base`/`server-shared` 上下文。
- 4D 改名 `project_id→tenant_id`：`server-shared`、`flow/core/src/db`、`kb/core`（含 Qdrant payload 键、access-scope）。
- 4E DB schema：`flow` `init_mysql.sql` / `sqlite.ts`、`kb` `kb-mysql-schema.ts` — 删 `projects` 表、列改名。

> **执行守则：** 每个子批做完即 `bun run typecheck` + 相关包 `bun test` + commit。改名用编辑器符号级替换，**不要**整目录 sed（避免误伤注释/字符串语义）。

### Task 4A: 删 flow 自有鉴权与 projects 接线

- [ ] **Step 1: 从 `flow.module.ts` 移除 controllers/providers**

删除 import 与数组项：`AuthController`、`UsersController`、`AuthService`、`ApiKeysController`、`ApiKeysService`、`ProjectsController`、`ProjectsService`（保留 `FlowsController`/`webhook`/`components`/`run`/`mcp`/`flow-files`/`custom-component-templates`）。

- [ ] **Step 2: 删目录**

```bash
git rm -r packages/flow/core/src/auth packages/flow/core/src/api-keys packages/flow/core/src/projects
```

- [ ] **Step 3: 修 `flow/core/src/index.ts`**

删除 `createFlowAccessTokenReader`/`createFlowDeveloperApiKeyReader`/`createFlowProjectLookup` 导出（来自被删的 `auth/flow-auth-adapters`）；删 `PROJECT_REPOSITORY_TOKEN`/`ProjectRepository` 导出（WS4D 一并）。

- [ ] **Step 4: 处理 `allowed_tools` 引用**

Run: `rg -n "allowed_tools|developerApiAls|applyToolCallPolicy" packages/flow/core/src --glob '!**/*.test.ts'`
对每处：`lf-sse-stream.ts` 删 `applyToolCallPolicy` 调用与 import；`webhook.controller.ts`/`flow-crud.service.ts` 删 allowed_tools 分支；`developer-api-context.ts` 若仅服务于此可删。

- [ ] **Step 5: typecheck（预期大量 break，逐个修干净）**

Run: `bun run --filter @cube-ai/flow-core typecheck`
Expected: 先 FAIL → 按报错删尽引用 → PASS

- [ ] **Step 6: 跑 flow 单测，删/改失效测试**

Run: `bun test packages/flow/core/src`
Expected: 删除 `auth`/`api-keys`/`projects` 相关测试文件后 PASS

- [ ] **Step 7: 提交**

```bash
git add -A packages/flow/core
git commit -m "refactor(flow-core): drop cube-ai-shell auth/api-keys/projects + allowed_tools (host is sole auth authority)"
```

### Task 4B: 删 projectLookup 机制

- [ ] **Step 1: bootstrap 去 projectLookup**

Modify `apps/ai-center/src/bootstrap.ts`：`createExecutionAuthMiddleware` 的 `projectLookup: createFlowProjectLookup()` 删除；`createProjectContextMiddleware()` 改为 tenant 注入版（见 4C）。`createExecutionAuthMiddleware` 若强制要求 `projectLookup`，改其签名（4B Step 2）。

- [ ] **Step 2: 改 `server-base` execution-auth 中间件**

Modify `apps/ai-center/src/platform/server-base/src/security/execution-auth.middleware.ts`：把 `projectLookup.hasProject/listProjectIds` 改为：tenant 合法性由上游 `createTenantValidationMiddleware`(JWT tenants[]) 保证；本中间件直接以 principal.tenant 注入隔离上下文（projectContext→tenantContext，见 4C/4D）。删 `ProjectLookup` 依赖。

- [ ] **Step 3: 删 `flow/core/src/middleware/project-lookup-cache.ts`** 及其引用。

- [ ] **Step 4: typecheck + 提交**

Run: `bun run typecheck`
Expected: PASS（修齐 server-base/ai-center 引用）

```bash
git add -A
git commit -m "refactor(identity): remove projectLookup; tenant validity from JWT tenants[]"
```

### Task 4C: tenant 直注入隔离上下文

- [ ] **Step 1: `flow-platform-ports.ts` 去常量映射**

Modify `packages/flow/core/src/platform/flow-platform-ports.ts:15-22`：删 `DEFAULT_FLOW_PROJECT_ID` 与 `tenantToProjectId`，`invoke`/`list` 直接用 `String(req.tenant)` 作隔离值（或读 `currentTenantId()`，见 4D 改名后）。

```ts
// before: const projectId = tenantToProjectId(req.tenant)
const tenantId = String(req.tenant)
```

- [ ] **Step 2: typecheck + flow 单测**

Run: `bun run --filter @cube-ai/flow-core typecheck && bun test packages/flow/core/src/platform`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add packages/flow/core/src/platform
git commit -m "refactor(flow-core): derive isolation key directly from tenant (drop default-project stub)"
```

### Task 4D: `project_id → tenant_id` 符号级改名

- [ ] **Step 1: 盘点改名面**

Run: `rg -n "project_id|projectId|currentProjectId|isGlobalAccessEnabled|projectContextAls|ProjectContext" packages/flow/core/src packages/kb/core/src apps/ai-center/src/platform --glob '!**/*.test.ts' | wc -l`
记录总数作为收敛指标。

- [ ] **Step 2: server-shared 读符号改名**

Modify `apps/ai-center/src/platform/server-shared/src/`：`projectContextAls`→`tenantContextAls`、`ProjectContext{projectId}`→`TenantContext{tenantId}`、`currentProjectId()`→`currentTenantId()`、`access-scope.ts` 同步。保留 `bypassProjectIsolation`→`bypassTenantIsolation`。更新 `index.ts` 导出。

- [ ] **Step 3: kb-core 改名**

按 `rg` 命中逐文件改：`kb-mysql-schema.ts`（列 `project_id`→`tenant_id`）、`access-scope.ts`、`qdrant-vector.repository.ts`（**payload 键 `projectId`→`tenantId`**、buildSearchFilter/buildDeleteFilter）、`document-chunk.repository.ts`、`document.entity.ts`/`document-directory.entity.ts`、`knowledge-query.port-impl.ts`、`document.service.ts` 等。

- [ ] **Step 4: flow-core 改名**

`db/sqlite.ts`、`db/mysql-repositories.ts`、`db/shared-repositories.ts`、`db/repository-contracts.ts`：列/字段 `project_id`→`tenant_id`；删 `ProjectRepository`（projects 已删）。

- [ ] **Step 5: typecheck + 全域单测**

Run: `bun run typecheck && bun test packages/kb/core/src && bun test packages/flow/core/src`
Expected: PASS（更新引用了旧符号的测试）

- [ ] **Step 6: 收敛校验**

Run: `rg -n "currentProjectId|projectContextAls|\.project_id|projectId" packages/flow/core/src packages/kb/core/src apps/ai-center/src/platform --glob '!**/*.test.ts'`
Expected: 0 命中（除注释/迁移说明）。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "refactor(identity): rename project_id->tenant_id across flow-core, kb-core, server-shared (incl. qdrant payload key)"
```

### Task 4E: DB schema 落地

- [ ] **Step 1: flow schema**

Modify `packages/flow/core/src/db/sqlite.ts`（建表 DDL）+ flow MySQL init SQL：删 `projects`/`auth_users`/`oauth_access_tokens`/`oauth_refresh_tokens`/`api_keys` 表；其余表列 `project_id`→`tenant_id`。

- [ ] **Step 2: kb schema**

Modify `packages/kb/core/src/infrastructure/orm/kb-mysql-schema.ts` 及任何 kb DDL：列 `project_id`→`tenant_id`。

- [ ] **Step 3: 起空库冒烟（fresh-start 验证）**

Run: `bun test apps/ai-center/src/routes/domain-routes.test.ts apps/ai-center/src/routes/flow-sse-e2e.test.ts`
Expected: PASS（新 schema 下建库→基本路由/SSE 通）

- [ ] **Step 4: 提交**

```bash
git add -A packages/flow/core/src/db packages/kb/core/src
git commit -m "refactor(db): tenant_id schema; drop projects/auth/api_keys tables (fresh-start)"
```

---

## WS5 — KB 平台源文档桥（cube2 content gRPC）

**背景：** 补「从 cube 平台知识库导入源文档进 kb」。gRPC client 仿现有 `cube2-file-client.ts` 模式置于 platform-adapter；kb 摄入侧经 seam 消费。

**File Structure:**
- Create: `packages/platform-adapters/ghcloud/src/grpc-gen/guhecloud/cube/apps/content/management/grpc/v1/knowledge_base_pb.ts` — 从原仓 grpc-gen 复制。
- Create: `packages/platform-adapters/ghcloud/src/cube2-content-client.ts` (+ `.test.ts`) — 仿 `cube2-file-client.ts`。
- Modify: `packages/platform-adapters/ghcloud/src/index.ts` — 导出 content client。
- Create: `packages/kb/core/src/port/platform-source.port.ts` — `PlatformKbSourcePort`（kb 侧 seam，contracts/本地）。
- Create: kb 摄入侧消费服务 `packages/kb/core/src/modules/ingestion/platform-source-import.service.ts` (+ `.test.ts`)。
- Reference: 原仓 `ai-application/src/services/knowledge-document-source.service.ts`（导入逻辑）；`ai-application-grpc-gen/src/gen/guhecloud/cube/apps/content/management/grpc/v1/knowledge_base_pb.ts`。

### Task 5.1: 复制 content gRPC 生成物 + client

- [ ] **Step 1: 复制 pb 生成物**

```bash
mkdir -p packages/platform-adapters/ghcloud/src/grpc-gen/guhecloud/cube/apps/content/management/grpc/v1
cp /Users/dg/work-ghy/ghcloud/prod/cube-services/ai-application-grpc-gen/src/gen/guhecloud/cube/apps/content/management/grpc/v1/knowledge_base_pb.ts \
   packages/platform-adapters/ghcloud/src/grpc-gen/guhecloud/cube/apps/content/management/grpc/v1/knowledge_base_pb.ts
```

- [ ] **Step 2: 调整 import 路径**

确认 pb 文件内部 import（`@bufbuild/protobuf`、common_pb 等）在本仓可解析；缺的 common/error pb 一并从原仓 grpc-gen 复制到对应路径。

- [ ] **Step 3: typecheck**

Run: `bun run --filter @cube-ai/platform-adapter-ghcloud typecheck`
Expected: PASS

- [ ] **Step 4: 写 content client（仿 file client）+ 失败测试**

Create `cube2-content-client.ts`：`getKnowledgeBaseClient()` 复用 `resolveFileServiceBaseUrl` 同款 Nacos/直连解析（抽公共 `resolveCube2BaseUrl(serviceEnvPrefix)` 或单独 `CUBE2_CONTENT_SERVICE_*` env）+ `createInnerInvokeInterceptor`。测试 mock transport 断言惰性初始化。

- [ ] **Step 5: 跑测试 + typecheck + 导出 + 提交**

Run: `bun test packages/platform-adapters/ghcloud/src/cube2-content-client.test.ts && bun run --filter @cube-ai/platform-adapter-ghcloud typecheck`
Expected: PASS

```bash
git add packages/platform-adapters/ghcloud/src
git commit -m "feat(platform-adapter): cube2 content (KnowledgeBase) gRPC client"
```

### Task 5.2: kb 摄入侧消费 seam

- [ ] **Step 1: 定义 `PlatformKbSourcePort`（失败测试先行）**

```ts
export interface PlatformKbSourceDoc { externalId: string; fileName: string; bytes: Uint8Array; mimeType?: string }
export interface PlatformKbSourcePort {
  listSourceDocs(platformKbId: string, signal?: AbortSignal): Promise<PlatformKbSourceDoc[]>;
}
```

- [ ] **Step 2: 实现 `platform-source-import.service.ts`**

注入 `PlatformKbSourcePort` + 现有 `DocumentService`：`importFromPlatformKb(platformKbId, targetTenantId)` → 拉源文档 → 复用 `DocumentService.upload`/摄入流水线。逻辑参考原仓 `knowledge-document-source.service.ts`（映射 cube2 KnowledgeBase 文档 → kb 摄入）。

- [ ] **Step 3: adapter 实现（platform-adapter → kb port）**

在 `apps/ai-center` 组合根用 `cube2-content-client` 实现 `PlatformKbSourcePort` 并注入 kb 模块（与 `KbPlatformModule` 同款装配）。

- [ ] **Step 4: HTTP 入口**

在 kb documents 控制器加 `POST /documents/import-from-platform`（body `{ platformKbId }`，tenant 来自上下文）→ `platform-source-import.service.importFromPlatformKb`。

- [ ] **Step 5: 测试（mock port）+ typecheck**

Run: `bun test packages/kb/core/src/modules/ingestion/platform-source-import.service.test.ts && bun run typecheck`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add -A packages/kb/core/src apps/ai-center/src
git commit -m "feat(kb-core): import source documents from platform KB via cube2 content bridge"
```

---

## Self-Review（spec 覆盖核对）

| 清单项（capability-supplement-plan §1） | 对应任务 |
|---|---|
| 1.1 多租户身份（identity 默认 + tenant 注入 + 删 projectLookup） | WS3 + WS4B/4C |
| 1.2 剔除 flow 自有鉴权（auth/api-keys/allowed_tools/model-providers） | WS4A |
| 1.3 LLM provider 补全（anthropic + dashscope-text2image + geekai） | WS2.1/2.3/2.4 |
| 1.4 KB 平台源文档桥（cube2 content gRPC） | WS5 |
| 1.5 权威系统级 catalog seed | WS1 |
| project 退役 + `project_id→tenant_id` 改名 | WS4C/4D/4E |

**未覆盖项（按裁决「可后补」，不在本计划）：** SDK 覆盖面对齐旧 app、cube2 `file_ref`。

**注意事项：**
- `settings/model-providers` 退役：WS4A 删 flow 鉴权时一并移除 `settings/model-providers.controller`（若仍在 flow.module 引用，按 4A Step 1 一并删）。补充 grep：`rg -n "model-providers|model_provider:" packages/flow/core/src`，逐处清。
- WS2 文生图 `endpointType` 字符串须与 contracts `LlmEndpointType` 13 枚举一致（`packages/contracts/src/platform/llm-catalog.ts`）。
- WS4 改名涉及 Qdrant payload 键：fresh-start 下无存量数据，无需迁移既有向量；仅保证新写入用 `tenantId`。

---

## 执行交接

计划已存 `docs/migration/2026-06-09-capability-supplement-implementation-plan.md`。两种执行方式：

1. **Subagent 驱动（推荐）** — 每任务派新 subagent、任务间评审、快迭代。
2. **本会话内联执行** — 用 executing-plans，批量执行 + 检查点评审。

选哪种？另：WS4（大改名，高风险）建议单独成 PR、独立评审。
