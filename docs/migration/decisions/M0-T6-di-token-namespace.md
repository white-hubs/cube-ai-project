# M0.T6 — DI token 命名空间决策

**日期**：2026-06-06  
**状态**：已采纳

## 决策

**保留 `agentic.*` 命名空间**（`Symbol.for('agentic.adapter.platform.*')` 等），**不**迁移至 `agent.*`。

## 理由

- DI token 使用 `Symbol.for`，字符串是跨包全局符号键；一次性全仓替换有遗漏即运行时注入失败，风险高。
- ADR-0011 规范的是 **npm 包名**（`agentic-*` → `@cube-ai/*`），不强制重写 token 字符串。
- M0 目标是最小风险立起 contracts 内核；token 重命名无功能收益，留待后续若有明确 break-glass 需求再单独立项。

## 落地

| 时机 | 动作 |
|------|------|
| M0.T4 完成后 | 在 `packages/contracts/src/platform/tokens.ts` 文件顶部加一行注释，指向本文 |
| 全里程碑 | `docs/migration/milestones/M0-foundations-and-contracts.md`「决策记录」T6 行已回填 |

## 若未来迁 `agent.*`

必须满足：全仓一次性替换 + 符号回归测试 + 无混用窗口；不在 M0 执行。
