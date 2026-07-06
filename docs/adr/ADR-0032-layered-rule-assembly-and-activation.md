# ADR-0032: 分层规则组装与规则激活轴 —— 自持 RuleActivation 词汇 + fail-closed loader，组装委托 tachu 原生 activation 管线（always/manual 每轮进 system 段、不入 memory），semantic/path 留档

- **Status**: Accepted
- **Date**: 2026-07-03
- **Deciders**: 架构组（经两轮 `/grill-with-docs` 收敛；随 tachu rc.10→rc.12 迁移落地）
- **Tags**: agent, engine, rule, descriptor, prompt-assembly, activation

## Context

本仓 `RuleDescriptor`（`bc/descriptor/rule-registry.service.ts`）此前只有 `name/content` 等字段，**所有规则一律拼进会话 system prompt**（`snapshotRuleTexts` 无差别取全部）。`descriptors/rules/safety-baseline.yaml` 里写的 `type: rule` / `scope: [safety, output]` 两个字段**被 loader 静默丢弃**——即「配置在骗人」：作者以为声明了作用域，运行时却毫无消费点。

这源于上游 tachu rc.10 的 `RuleScope`（`"turnStart" | "preLLM" | "turnStop" | "*"`）自身缺陷：深单 loop 每轮只调一次 `promptAssembler.assemble({ phase: "preLLM" })`，`turnStart`/`turnStop` 声明了但永不生效。当时（见 backlog「rule 模型 type+scope 回归（暂缓）」）判断不应把 tachu 的「配置骗人」原样搬进本仓，故**暂缓**，等上游修正。

tachu rc.11/rc.12 把 `RuleScope` 换成了 **`RuleActivation`**——语义从「规则在 loop 的哪个 phase 生效」（phase 轴，已证伪）改为「规则**何时**进入上下文」（activation 轴，与 Cursor / Copilot / Continue / Cline 等业界 rule 系统一致）：`always` / `manual` / `semantic` / `path`。这是一个**可落地**的轴，deferred 前提消失，本轮随 rc.12 迁移一并收口。

**关键新事实（rc.12 源码核对）**：rc.12 引擎**原生**就把 activation 组装做完了，且天生「每轮重算、不入 memory」——

- `SessionScope` 原生带 `additionalRules: RuleDescriptor[]` + `explicitRuleNames: readonly string[]`；`RuleDescriptor.activation` 的联合类型与本仓自持者**逐字段一致**。
- `engine.js` 把 `registry.list("rule") ∪ scope.additionalRules` 作为 `activeRules` 喂 `PromptAssembler.assemble()`；`assemble` 按 activation gate 过滤（`always` 恒进、`manual` 命中 `explicitRuleNames` 才进、`semantic` 看 `semanticActiveRuleNames`、`path` 看 `contextFilePaths` glob 命中），激活规则渲染进 **system 消息**（`## Hard Rules`/`## Preferences`），**每轮 `assemble` 时重算**。
- memory 只 append 归一化后的**用户输入**，system 段每轮重新组装、**从不落 memory**。

这直接推翻了本 ADR 初稿的「manual → User Message」方案：User Message **必然入 memory**，与「不入 memory」冲突；真正满足「每轮重算 + 不入 memory」的只有 **system 段注入**。而 rc.12 引擎已把该能力做全，本仓自建 prompt 文本拼装（ADR-0016 §7）在规则这条线上成了重复造轮子。故本轮**反转** ADR-0016 §7 在规则组装上的自建路径，改为**复用 tachu 原生 activation 管线**。

约束基线不变：跨域只走 contracts port（ADR-0002）；已建会话靠 snapshot 冻结、不受 descriptor 变更影响（ADR-0016）。另有两条**当前运行环境**事实：本仓 chat 场景 **无 per-turn 文件上下文**，且 `engine.js` 目前**只从 scope 透传 `explicitRuleNames`**，未透传 `contextFilePaths` / `semanticActiveRuleNames`。

## Decision

### 1. 规则模型 = 激活轴（activation），本仓自持类型

`RuleDescriptor` 增可选字段 `activation?: RuleActivation`，本仓**自持**该联合类型（词汇对齐 tachu `RuleActivation`，但不 import vendor 内部，保持解耦）：

```ts
type RuleActivation =
  | { mode: 'always' }
  | { mode: 'manual' }
  | { mode: 'semantic' }
  | { mode: 'path'; globs: readonly string[] };
```

缺省（未声明 `activation`）**回落 `always`**，读取统一走单一收口点 `resolveRuleActivation()`——不散落默认逻辑。激活轴只回答「规则正文**何时**进入本轮上下文」，**不表达** block/annotate/validate（那些属 guard/hook，另论）。

自持的是**词汇 + 加载/校验/冻结**：本仓 YAML → loader 解析 `activation` → snapshot 冻结本仓 `RuleDescriptor`。**组装/注入**则委托 tachu（见 §2/§3），本仓不再手写规则的 prompt 文本。

### 2. 分层组装：静态与动态统一交 tachu PromptAssembler，按 activation 每轮组装进 system 段

规则不再非黑即白全塞 prompt，而是**分层**——但分层的执行者是 **tachu 引擎**，本仓只负责「把 snapshot 规则每轮投影给 `SessionScope.additionalRules`」：

| activation | 触发输入（本仓→scope） | 落点 | 本轮状态 |
| ---------- | ---------------------- | ---- | -------- |
| `always` | 恒激活（无需输入） | tachu system 段 `## Hard Rules`，**每轮重算、不入 memory** | ✅ 落地 |
| `manual` | `scope.explicitRuleNames`（点名命中） | 同上（命中才进） | ✅ 落地 |
| `semantic` | `semanticActiveRuleNames` | 同上 | ⏸ 留档（engine 未从 scope 透传该输入 → fail-closed 不注入） |
| `path` | `contextFilePaths` glob 命中 | 同上 | ⏸ inert（engine 未透传 + 本仓无 per-turn 文件上下文，**双重**原因） |

snapshot 仍是整会话的**规则权威**——`hydrateSnapshotRules` 冻结**全部** activation 的规则（版本冻结，不受后续 descriptor 变更影响）。每轮由 `EngineFactory.buildSessionScope` 调 `snapshotRulesToTachuDescriptors(snapshot.rules)` 把本仓规则忠实投影成 tachu `RuleDescriptor[]`（本仓无 rule/preference 之分，`type` 一律 `"rule"`）→ `scope.additionalRules`。tachu registry 侧本仓**不注册任何 rule**，故 `activeRules = scope.additionalRules` 独一来源，无双注入。

### 3. manual 规则经 `explicitRuleNames` 进 system 段（**每轮重算、不入 memory**），且**只认显式点名**

manual 规则不进 User Message、不入 memory。其激活集 `scope.explicitRuleNames` = **prompt 内 `@rule`/`/rule` 点名 ∪ 调用方 `explicitRuleNames`**，二者取并集后**与 snapshot 里的 manual 规则求交**（非 manual 名即便被点到也不放入，因 tachu 只对 manual 消费 explicitRuleNames）。tachu 据此在**本轮** `assemble` 时把命中的 manual 规则渲染进 system 段；下一轮不再命中就不注入——天然单轮、不残留。

- 点名检测 `findExplicitRuleMentions` **只认 sigil 形式**（`@name`/`/name`），**不做**裸名子串匹配——这是对 skill 的 `findExplicitSkillMentions`（含裸名匹配）的**刻意背离**：规则名常是普通词（`safety`），裸名匹配会让任何提到该词的 prompt 误命中、静默注入用户没主动调用的约束，破坏 `manual` 的「iff 显式调用」语义。
- turn-policy 关键字路由用**原始 prompt**，不受影响（规则注入发生在 scope 层，不改 `InputEnvelope.content`）。
- 注入可观测：命中时发 host engine 事件 `manual_rule_injected`（`phase: "session"`，payload 携命中规则名）。

### 4. loader fail-closed 校验 activation

`parseRuleActivation` 对**显式声明**的 activation 做 fail-closed 校验：未知 `mode`、或 `path` 缺非空 `globs` → **抛错**。本仓 loader 按既有「弹性加载」约定捕获 per-file 异常 → **跳过该文件**（不是把整批加载打挂，与 `broken.yaml` 同语义）。关键在于：非法 activation **不静默降级到最宽松档**（不会"看不懂就当 always"），而是拒绝装载。缺省（完全不写 activation）才回落 always。

### 5. `path` = 接受但运行时 inert（而非拒绝）

loader **接受** `path` 规则（校验 `globs` 非空），但运行时因 ①engine 未透传 `contextFilePaths` ②本仓无 per-turn 文件上下文而**始终不注入**。选择「接受 + inert」而非「加载即拒绝」：保持词汇完整（作者可预先声明 path 规则），待将来接线即可激活，无需回改 descriptor。

## Consequences

- **Positive**：消除「配置骗人」——`activation` 是**真被消费**的轴，`safety-baseline.yaml` 去掉了被忽略的 `type`/`scope`、改写为显式 `activation: {mode: always}`；always/manual 统一由 tachu **每轮重算、不入 memory**，`@rule` 严格单轮、无跨轮残留；组装委托引擎，本仓删掉自建的 `snapshotRuleTexts`（always 冻 prompt）+ User Message 注入 + `manual-rule-context` 渲染，代码更少、与 tachu 演进同步；system prompt 更稳定/可缓存、token 更省；snapshot 仍是单一权威，向后兼容（旧 snapshot 无 activation → 全部回落 always → 行为不变）；fail-closed 让非法声明在加载期暴露。`semantic`/`path` 一旦 engine 接线（透传 `semanticActiveRuleNames`/`contextFilePaths`）即免费获得，无需本仓再造注入通道。
- **Negative**：规则组装落点从「本仓 snapshot.prompt 内联」变为「tachu system 段 `## Hard Rules`」——位置与分节由 vendor 决定，本仓失去对规则在 system prompt 中确切排布的控制（换来与业界一致的分节结构）。`semantic` 通道本轮**只留词汇不接线**（engine 未透传输入），作者声明 `semantic` 规则暂无运行时效果。反转 ADR-0016 §7 在规则线上的自建路径，需同步该 ADR 注记。
- **Neutral**：`always` 规则的最终呈现与既有等价（仍在 system 段、仍每轮可见），只是从「会话创建时冻文本」变为「每轮投影重算」——对模型可见内容无差别，且更贴合 snapshot=权威、prompt=每轮投影 的分层；租户级 rule（`rul_` 前缀）经 tenant-resolver 暂不透传 activation（缺省 always），待管理面暴露 activation 编辑再补；tachu 侧规则管线仅本仓**规则**这条线复用（tools/skills 的镜像/组装路径不变）。

## Options Considered

- **继续暂缓（沿用 backlog「type+scope 回归」defer）**：零改动，但 rc.11/rc.12 的 `RuleActivation` 已修正 rc.10 `RuleScope` 的证伪缺陷，deferred 前提消失。否。
- **全部规则仍无差别进 system prompt（只加字段不分层）**：最小改动，但 system prompt 持续膨胀、无法表达"按需规则"。否。
- **manual 规则注入 User Message（本 ADR 初稿）**：贴合「归属用户话轮」的 `@rule` 心智，但 User Message **必然入 memory**，与本轮拍板的「每轮重算、不入 memory」直接冲突；且本仓要自建注入 + block 渲染。否（被「不入 memory」决策否决）。
- **保留本仓自建管线、仅把 manual 从 User Message 挪到 `scope.systemInstruction`**：改动最小、也满足「每轮重算不入 memory」，但不吃 tachu 原生 activation，`semantic`/`path` 将来仍需本仓自建，且 always/manual 两套机制不统一。否（选了「复用 tachu 原生」以统一四模式、减代码）。
- **复用 tachu 原生 `additionalRules` + `explicitRuleNames`（本决策）**：always/manual/semantic/path 四模式统一由引擎按 activation 每轮组装进 system 段、不入 memory；本仓只做 snapshot→tachu 投影 + 点名集计算。代价是反转 ADR-0016 §7。**是**。
- **点名检测复用 skill 的裸名子串匹配**：省一个函数，但规则名多为普通词，裸名匹配误命中率高、破坏 `manual` 显式语义。否（sigil-only 新函数）。
- **loader 遇非法 activation 打挂整批加载**（rc.12 迁移指南的 `throw ValidationError`）：更严格，但违背本仓 loader「一个坏 descriptor 不拖垮启动」的弹性约定。否（跳过坏文件 + warn，但绝不降级到宽松默认）。
- **`path` 规则加载即拒绝**：更"诚实"，但会阻断作者预声明、将来接线时还要回改。否（接受 + 运行时 inert）。
- **本轮就把 semantic 接成工具回调**：一步到位，但需设计规则检索工具 + 注入协议，范围过大；manual 已覆盖「显式规则」主诉求。暂否（留档）。

## Open Questions

- `semantic` 接线形态：等 engine 从 scope 透传 `semanticActiveRuleNames` 后，是暴露 `search_rules` 让模型自取，还是调用方按 `description` 预筛后注入。
- `path` 激活时机：待 chat 运行时引入 per-turn 文件上下文 + engine 透传 `contextFilePaths` 后如何喂 `globs` 匹配。
- 租户级 rule 的 `activation` 编辑何时经 **agent 管理面** 暴露（当前租户 rule 一律缺省 always）。
- 多个规则命中时 tachu 的排序/预算行为是否满足本仓需求（当前完全交由 `PromptAssembler` 的 trim 逻辑）。
