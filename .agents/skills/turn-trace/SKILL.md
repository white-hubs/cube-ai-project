---
name: turn-trace
description: >-
  Reconstructs a cube-agentic-engine turn from debug stdout logs (turnId/traceId
  grep) into a timeline, gap analysis, and trace report (HTML if report-html is
  available, else Markdown). Use ONLY when the user explicitly names this skill
  (turn-trace / turn trace / 链路溯源) AND supplies logs or a turnId — not for normal
  coding questions.
disable-model-invocation: true
---

# Turn Trace — Agentic Engine 链路溯源

**默认不启用。** 仅在用户 **明确指定本技能** 且提供 **日志片段 / turnId / 问题描述** 时执行。

从 `AGENTIC_ENGINE_LOG_LEVEL=debug` 的 stdout JSON 日志，按 `turnId` 单点还原整轮：prompt → intent → planning → tool loop → final answer，并输出 **链路完整性评估** + **溯源报告**（结构见 [REPORT-TEMPLATE.md](./REPORT-TEMPLATE.md)）。

## Iron rules

1. **Explicit only** — 用户未点名 `turn-trace` / 「链路溯源」/ 「还原 turn」→ 停止，勿自动跑。
2. **Logs are source of truth** — 只陈述日志里有的字段；缺失标「未观测到」，不臆造 I/O。
3. **No repo pollution** — 报告只写用户 tmp（`~/.tmp/reports/`，见 tmp-file-convention）；不写 git 工作区。
4. **Chat is not the report** — 聊天只给摘要 + 报告路径；正文在 `report.html` 或 `report.md`。
5. **No machine-specific paths in deliverables** — 禁止在报告/聊天里写 `/Users/…`、`/home/…` 等本机绝对路径；统一用 `~/.tmp/reports/…` 或 `$HOME/.tmp/reports/…`。

## Prerequisites (tell user if unmet)

| 需要 | 说明 |
|------|------|
| `AGENTIC_ENGINE_LOG_LEVEL=debug` 或 `trace` | 否则无 `promptBody` / `requestBody` / `resultBody` 等 full I/O |
| 可 grep 的 turnId 或 traceId | 通常相等；从 `turn.started` 或用户粘贴获取 |
| 日志来源 | 容器 stdout、`docker logs` 导出、或用户粘贴的 JSON 行 |

字段目录见 [LOG-CATALOG.md](./LOG-CATALOG.md)。

## Workflow

```
- [ ] Step 0: Confirm invocation + inputs (turnId, symptom, log source)
- [ ] Step 1: Isolate log lines for turnId/traceId
- [ ] Step 2: Build ordered timeline (phases + LLM rounds + tool invokes)
- [ ] Step 3: Extract verbatim system prompts per LLM call
- [ ] Step 4: Completeness / gap assessment
- [ ] Step 5: Detect report-html → HTML or Markdown report
- [ ] Step 6: Chat footer (+ install hint if Markdown fallback)
```

### Step 0 — Inputs

Collect (ask **one** consolidated question if ambiguous):

| Input | Required | Use |
|-------|----------|-----|
| turnId / traceId | yes* | grep 主键 |
| Raw logs | yes* | 粘贴或文件路径 |
| User symptom | recommended | 驱动 gap 评估（如「工具没调用」「回答幻觉」） |

\*At least one of turnId or logs containing turn identifiers.

### Step 1 — Isolate logs

```bash
docker logs <container> 2>&1 \
  | grep '"turnId":"<TURN_ID>"' \
  | grep -E 'turn\.(started|llm\.phase)|llm\.bridge|tool\.invoke|engine\.event\.(tool_|llm_)'
```

Optional helper（仓库内相对路径，从 repo root 执行）：

```bash
python3 .agents/skills/turn-trace/scripts/extract-turn-logs.py \
  --turn-id <TURN_ID> < logs.txt > ~/.tmp/turn-trace-<TURN_ID>.json
```

### Step 2 — Timeline

| Phase | 典型 msg / eventType | 关键字段 |
|-------|---------------------|----------|
| 入口 | `turn.started` | `promptBody`, `sessionId`, `modelCode` |
| LLM 开始 | `turn.llm.phase.start` | `promptBody`, `intentRoutingBody` |
| Intent | `llm.bridge.chat.start/done` | `requestBody`, `responseBody` |
| Planning | `engine.event.tool_activation`, `skill_activation` | `visibleTools`, `decision` |
| Tool loop | `engine.event.tool_loop_step_*`, `llm.bridge.chatStream.*` | `step`, `toolCalls` |
| Tool I/O | `tool.invoke.start/completed` | `argsBody`, `resultBody` |
| Final answer | `llm_call_start` purpose=`final-answer` | `requestBody`, `responseBody` |
| 结束 | `turn.llm.phase.completed` | `answerBody`, `engineOutputBody`, `usage` |

画 Mermaid `sequenceDiagram`（写入报告，不只在 chat 里）。

### Step 3 — System prompts

从 `llm.bridge.*.start` 的 `requestBody.messages[]` 提取全部 `role=system` 的 `content`（Intent 1 条；Tool loop 通常 2 条且 Step 1–N 共用；Final answer 1 条）。

Companion：`system-prompt-A-intent.md` 等，与主报告同目录。

### Step 4 — Completeness / gap assessment

对照 [LOG-CATALOG.md](./LOG-CATALOG.md) §「info vs debug」填表；Verdict：`FULL_TRACE` | `PARTIAL_TRACE` | `INSUFFICIENT_LOGS`。

### Step 5 — Write report（HTML 优先，否则 Markdown）

**5a. 检测 `report-html` 是否可用**（静默检测，不要把检测用的本机路径写进给用户看的文案）：

| 条件 | 判定 |
|------|------|
| 用户本次对话 **@/attach 了 `report-html` 技能** | 可用 |
| 否则：shell `test -f "$HOME/.agents/skills/report-html/SKILL.md"` | 存在 → 可用 |
| 以上皆否 | **降级 Markdown** |

**5b. 输出目录**（两种格式共用）：

```bash
mkdir -p ~/.tmp/reports
SLUG="turn-<turnId-sanitized>"
REPORT_ID="$(date +%Y%m%d-%H%M%S)-$(openssl rand -hex 3 2>/dev/null || echo $RANDOM)"
OUT_DIR="$HOME/.tmp/reports/${SLUG}__${REPORT_ID}"
mkdir -p "$OUT_DIR"
ln -sfn "$OUT_DIR" "$HOME/.tmp/reports/${SLUG}-latest"
```

**5c-A. `report-html` 可用**

- 读取 **`report-html` 技能**（用户 attach 或 `$HOME/.agents/skills/report-html/SKILL.md`），preset=`analysis`
- 章节按 [REPORT-TEMPLATE.md](./REPORT-TEMPLATE.md)；HTML scaffold 按该技能的 `HTML-TEMPLATE.md`
- 主文件：`$OUT_DIR/report.html`；`open`（macOS）或提示用户打开
- Companion 仍可为 `system-prompt-*.md`

**5c-B. 降级 Markdown**（无 `report-html`）

- 按 [REPORT-TEMPLATE.md](./REPORT-TEMPLATE.md) **同一章节结构** 写 `$OUT_DIR/report.md`
- System prompt 用 `###` + fenced code block，不用 HTML `<details>`
- Mermaid 仍用 fenced ` ```mermaid ` 块
- **不要**尝试手写 HTML/CSS
- Chat footer **必须**加一行安装提示（见 Step 6）

### Step 6 — Chat footer

1. turnId + verdict + symptom 是否解释（各一行以内）
2. 报告路径：**仅** `~/.tmp/reports/<slug>__<report-id>/report.{html|md}`（及 `-latest` symlink 说明）
3. 若 `INSUFFICIENT_LOGS`：缺什么 env / 字段、如何复采
4. **若 Step 5 走了 Markdown 降级**，追加：

   > 当前未检测到全局 **report-html** 技能，已输出 Markdown 报告。安装后可获得可浏览 HTML（Mermaid、折叠 section 等）：将 `report-html` 放到 `~/.agents/skills/report-html/`，或在对话中 @ 该技能后重跑 turn-trace。

## Integration

| 技能 | 关系 |
|------|------|
| `report-html` | 可选；有则 HTML，无则本技能自带 Markdown 降级 |
| `diagnose` | 修 bug 时 trace 报告作证据 |
| `tmp-file-convention` | 临时产物在 `~/.tmp/` |

## Forbidden

- ❌ 未点名技能时自动做 turn 还原
- ❌ 报告写入 git 工作区
- ❌ 在 chat 粘贴完整 system prompt / SQL / 长日志
- ❌ 无日志时编造调用链
- ❌ 向用户暴露 `/Users/<name>/…` 等本机绝对路径

## Reference

- [LOG-CATALOG.md](./LOG-CATALOG.md)
- [REPORT-TEMPLATE.md](./REPORT-TEMPLATE.md)
- 实现：`packages/agent/engine/src/infra/observability/turn-debug-log.ts`
