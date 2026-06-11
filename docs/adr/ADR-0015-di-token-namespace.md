# ADR-0015: DI token 保留 `agentic.*` 命名空间

- Status: Accepted
- Date: 2026-06-06（自迁移期决策 M0.T6 升格，2026-06-11）
- Tags: di, contracts, naming

## Context

包命名已按 ADR-0011 统一为 `@cube-ai/*`（原 `agentic-*`），但 DI token 仍是 `Symbol.for('agentic.adapter.platform.*')` 等 `agentic.*` 字符串。token 使用 `Symbol.for`，字符串是跨包全局符号键，是否随包名一起改名需要单独决策。

## Decision

**保留 `agentic.*` 命名空间**，不迁移至 `agent.*`。

- 一次性全仓替换有遗漏即运行时注入失败，风险高、无功能收益。
- ADR-0011 规范的是 **npm 包名**，不强制重写 token 字符串。
- token 单一真源在 `packages/contracts/src/platform/tokens.ts`，文件顶部注释指向本 ADR。

## Consequences

- 代码中 `agentic.*` token 字符串与 `@cube-ai/*` 包名长期并存，属有意为之，不是待清理项。
- 若未来确需迁 `agent.*`：必须全仓一次性替换 + 符号回归测试 + 无混用窗口，单独立项执行。
