# @cube-ai/agent-sdk-console

租户级 **agent 管理面** 的 HTTP SDK（控制台 / 后台用）。对接 ai-center 的 `/agent/console/*` 接口，统一管理租户自有的 **agent / skill / rule** descriptor：结构化 CRUD、`text/plain` 文档导入、草稿/发布生命周期。

> 这是「管理面」SDK（创建/编辑/发布资产）。运行时「消费面」（创建会话、发消息、流式）用的是 `@cube-ai/agent-sdk-client`，两者不要混用。

## 安装

**场景 A：本仓库内（monorepo workspace）** —— 用 workspace 协议，bun 直接软链本地源码：

```jsonc
// 你的包 package.json
"dependencies": { "@cube-ai/agent-sdk-console": "workspace:*" }
```

```bash
bun install
```

**场景 B：外部前端工程（独立仓库）** —— 从私有 npm registry 安装发布版本（包是私有 scope，需先配好 registry）：

```bash
# 一次性：把 @cube-ai scope 指向私有 registry（或写进项目 .npmrc）
npm config set @cube-ai:registry http://nexus.guhecloud.com:8888/repository/npm-hosted/

# 安装（按需锁版本；当前为 alpha）
npm i @cube-ai/agent-sdk-console        # 或 pnpm add / yarn add / bun add
```

```ini
# 推荐：项目根 .npmrc，避免每人手动配
@cube-ai:registry=http://nexus.guhecloud.com:8888/repository/npm-hosted/
```

> 发布产物是浏览器 ESM（`dist/index.js` + d.ts），仅依赖 `@cube-ai/contracts` 类型与 `zod`，无 Node 内置依赖，可直接在前端打包器中用。

## 30 秒上手

```ts
import { createAgentConsoleClient } from '@cube-ai/agent-sdk-console';

const console = createAgentConsoleClient({
  baseUrl: 'https://ai-center.example.com', // 不含 /agent/console 前缀
  // 鉴权 / 租户头：每次请求都会带上（支持同步或异步函数，便于刷新 token）
  headers: () => ({ authorization: `Bearer ${getToken()}` }),
});

// 1) 结构化创建一个 agent（落为草稿）
const agent = await console.createAgent({
  prompt: '你是客服助手。',
  ruleRefs: ['rul_123'],
  displayName: 'support',
});

// 2) 发布后才会被运行时解析（未发布 = 草稿，对运行时不可见）
await console.publishAgent(agent.id);
```

## 关键概念（务必理解）

- **租户隔离**：所有读写自动限定在当前租户，租户身份由请求头解析（你只需在 `headers` 里带上鉴权 / 租户头），SDK 不接收 `tenantId` 入参。
- **前缀 id**：服务端生成、不可变，`agt_` / `skl_` / `rul_` + 雪花 id。裸 name（无前缀）永远指系统级资产，不归本 SDK 管。
- **草稿/发布两态**：`create` / `update` / `createFromDocument` 都只产生**草稿**（`status: 'draft'`，`headVersionNo` 递增）。**只有 `publish*` 之后运行时才解析到该版本**。版本历史 append-only，「回滚」= 把旧内容重新提交为新草稿再发布。
- **错误**：非 2xx 抛 `Error`（消息形如 `agent-sdk-console POST /agents: HTTP 404`）。内容/文档校验失败为 412。

## 配置 `AgentConsoleConfig`

| 字段 | 必填 | 说明 |
|---|---|---|
| `baseUrl` | 是 | ai-center 根地址，**不要**带 `/agent/console` |
| `pathPrefix` | 否 | 默认 `/agent/console` |
| `headers` | 否 | 对象或 `() => headers`（可 async）；放鉴权 / 租户头 |
| `fetchImpl` | 否 | 自定义 fetch（测试 / 非浏览器环境） |

## 完整方法表

三种 kind 对称。`create/update/createFromDocument` 返回 `TenantDescriptorView`（含 `id/kind/name/status/headVersionNo/publishedVersionNo/content/createTime/updateTime`）。

| 能力 | agent | skill | rule |
|---|---|---|---|
| 建草稿 | `createAgent(content)` | `createSkill(content)` | `createRule(content)` |
| 列表 | `listAgents()` | `listSkills()` | `listRules()` |
| 取单个 | `getAgent(id)` | `getSkill(id)` | `getRule(id)` |
| 更新（新草稿版本） | `updateAgent(id, content)` | `updateSkill(id, content)` | `updateRule(id, content)` |
| 软删 | `deleteAgent(id)` | `deleteSkill(id)` | `deleteRule(id)` |
| 发布 head | `publishAgent(id)` | `publishSkill(id)` | `publishRule(id)` |
| 文档导入 | `createFromDocument('agent', raw)` | `createFromDocument('skill', raw)` | `createFromDocument('rule', raw)` |

结构化创建/更新直接传 kind 对应的 `content` 对象（由 contracts schema 校验，服务端会补默认值）：
- **agent**：`prompt`(必填) + 可选 `modelConfig` / `ruleRefs` / `skillRefs` / `availableTools` / `subAgentRefs` / `maxDepth`
- **skill**：`description` + `instructions`（均必填）+ 可选 `trigger`
- **rule**：`content`(必填) + 可选 `description`
- 三者共有可选 meta：`displayName` / `tags` / `version`

## 用法二：从 Markdown 文档导入（ADR-0018）

把一份带 YAML frontmatter 的文档原文（`text/plain`）直接提交，服务端解析出 `name` + 结构化内容并 upsert（按 `name` 判定 created / updated），结果仍为草稿，需再 `publish*`。

```ts
const doc = `---
name: review-pr
description: 审查一个 PR
tags: [code-review]
---
仔细阅读 diff，指出风险与改进点。`;

const res = await console.createFromDocument('skill', doc);
// res = { id: 'skl_…', name: 'review-pr', action: 'created' | 'updated', headVersionNo, status: 'draft' }
await console.publishSkill(res.id);
```

## 典型对接流程（建议 UI 顺序）

1. `listAgents()` / `listSkills()` / `listRules()` 渲染列表。
2. 表单结构化创建 → `createXxx`，或上传文档 → `createFromDocument`。
3. 编辑保存 → `updateXxx`（生成新草稿版本，运行时仍跑旧的已发布版本）。
4. 「发布」按钮 → `publishXxx`，此后新会话才会用上新版本。
5. agent 的 `ruleRefs` / `skillRefs` 填对应 rule/skill 的前缀 id；这些被引用项也必须各自 **已发布**，否则创建会话时报 `RESOURCE_NOT_FOUND_DESCRIPTOR`。
