# ADR 目录结构验收报告（2026-06-06）

> subagent 只读验收 + 主 agent 汇总。基准：ADR-0001/0011/0012、`repo-layout-and-dependencies.md` v6。

## 符合率

| 维度 | 符合率 |
|---|---:|
| v6 **包名**清单（`@cube-ai/*`） | **100%**（18/18） |
| v6 **物理路径**严格符合 | **~32%**（12/38） |
| **综合**（名 50% + 路径 50%） | **~66%** |

## 核心结论

**功能已齐，目录处于 M0–M4 扁平过渡态**，与 v6 示意树系统性偏离，但**无 P0 阻塞**。

### 主要偏差（P1）

| ADR 期望 | 实际 |
|---|---|
| `packages/platform-adapters/ghcloud` | `platform-adapter-ghcloud/`（仓库根） |
| workspaces `packages/*/*` | `platform-adapter-*` + `packages/platform-host/*` |
| identity 收进 host/contracts | 过渡态 `@cube-ai/server-base` + `platform-host/*` |

### 主要偏差（P2）

| ADR 期望 | 实际 |
|---|---|
| `packages/agent/engine` | `packages/agent-engine`（全域扁平） |
| `infra/bun-server-ext/sse` | `infra/bun-server-ext-sse` |
| `apps/ai-center/src/routes/` | `src/http/` + `middleware/` |
| `deploy/` · `descriptors/` | 缺失 |

### 文档外扩展（可接受）

- `packages/platform-host/*`、`packages/shared`、`apps/ai-console`、`tools/migration/`

## 与测试的关系

| 现象 | 原因 |
|---|---|
| 以前 `bun test` 15 fail | 根缺 `tsconfig.json` → legacy decorator 失败；ai-center 测试污染 `CUBE_AI_SQLITE_PATH` |
| case 看似变少 | 失败时大量用例未执行（error between tests）；修复后 **1792 ran / 1626 pass** |
| `test:offline` 子集 | 已统一为 `scripts/test-all.ts`（23 个有测包，per-package cwd） |
| `@cube-ai/shared` 曾漏测 | 已补进 test-all |

## 建议修复优先级

1. **P1** — `platform-adapter-ghcloud` → `packages/platform-adapters/ghcloud` + workspaces 对齐
2. **P1** — `platform-host` 退役路线（ADR-0012 identity 收口）
3. **P2** — 按域 re-home（agent → llm → flow → kb）或文档标注「扁平布局例外」
4. **P2** — `src/http` ↔ `src/routes` 命名统一

详见 subagent 完整表格与 phased plan（Phase 0–6）。
