# Turn Trace — Report Template

本模板定义 **内容结构**（与输出格式无关）。`slug=turn-<turnId>`，目录 `~/.tmp/reports/<slug>__<report-id>/`。

## Output format

| 条件 | 主交付物 | 说明 |
|------|----------|------|
| `report-html` 技能可用 | `report.html` | 走 report-html 的 `analysis` preset + HTML-TEMPLATE |
| 否则（降级） | `report.md` | 同章节顺序；Mermaid 用 fenced block；system prompt 用 fenced code |

两种格式均可在同目录附带 `system-prompt-*.md`、`companion.md`。

**禁止**在报告中写本机绝对路径（如 `/Users/…`）；Footer 只用 `~/.tmp/reports/…`。

---

## Required sections

编号固定，便于跨 turn 对比。缺失数据标注「未观测到（需 debug 档）」。

### Header

- Title: `<用户 prompt 摘要> — Turn 链路还原`
- Subtitle: `turn-<id> · <report-id> · <ISO-8601>`
- Badges: outcome、routing（simple/complex → direct/tool-use）、verdict（FULL_TRACE / PARTIAL / INSUFFICIENT）

### §1 标识与用量

| 字段 | 来源 |
|------|------|
| turnId / traceId / sessionId / tenant | `turn.started` / 任意行 |
| model | `turn.llm.phase.start.resolvedModel` |
| 用户 prompt | `turn.started.promptBody` |
| 总耗时 | `engineOutputBody.metadata.durationMs` |
| Token | `turn.llm.phase.completed.usage` |

### §2 阶段总览

Mermaid `sequenceDiagram`：用户 → TurnService → Intent → Planning → Tool Loop → MCP → Final Answer。

### §3 Turn 入口

- `turn.started` / `turn.llm.phase.start`
- `intentRoutingBody` 若存在

### §4 Intent 阶段

- `llm.bridge.chat.start/done` 时间与 usage
- responseBody 中 intent JSON
- `engine.event.progress` decision

### §5 各阶段 LLM System Prompt（完整 verbatim）

| 子节 | LLM 调用 |
|------|----------|
| 5.A Intent | `llm.bridge.chat.start` |
| 5.B Tool loop | `chatStream.start`（Step 1–N 是否相同） |
| 5.C Final answer | `chatStream.start` + `purpose=final-answer` |

- **HTML**：`<details>` 折叠 + `<pre>`
- **Markdown**：`### system[i]` + fenced code block

Companion: `system-prompt-A-intent.md` 等。

### §6 Planning 元数据

`tool_activation`、`skill_activation`、`context_budget`、`memory_recall`、`knowledge_prefetch_*`

### §7 Tool Loop（按 step）

step 号、stepId、`chatStream.done` 摘要、toolCalls、并行 invoke 表。

### §8 工具调用明细

`tool.invoke.start/completed`：callId、args 摘要、result 摘要、duration。

### §9 Final Answer 阶段

`llm_call_start` purpose、observations 结构、与 tool loop 终稿 diff。

### §10 最终用户可见答复

`answerBody` 摘要或关键发现。

### §11 链路完整性评估（核心）

**Completeness table** + **Verdict** + **Symptom analysis** + **Anomalies**

### §12 运维 grep 备忘

```bash
docker logs … | grep '"turnId":"<ID>"' | grep -E '…'
```

注明 debug env 与 info 档差距。

### Footer

`Report: ~/.tmp/reports/turn-<id>__<report-id>/report.{html|md}`

---

## Chat summary（不进报告正文）

≤5 行：turnId + verdict、routing、symptom、报告路径（`~/.tmp/…`）、PARTIAL/降级说明。

若 Markdown 降级：一句提示安装全局 `report-html`（`~/.agents/skills/report-html/` 或对话 @ 技能）。
