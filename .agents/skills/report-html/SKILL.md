---
name: report-html
description: >-
  Convert agent answers or structured content into a self-contained HTML report
  under ~/.tmp/reports/. Use when the user explicitly asks to export, render, or
  convert a reply, analysis, audit, summary, or historical chat content to HTML
  (e.g. "转成 html", "report-html", "生成 html 报告"). Manual invocation only —
  never auto-trigger from ambient context.
disable-model-invocation: true
---

# Report HTML

Turn agent-produced content into a **self-contained HTML file** the user can open in a browser. The chat reply stays short; the HTML file is the full deliverable.

Write report artifacts under `~/.tmp/reports/`, never into the git repo. Create a unique directory for every run and keep a `<slug>-latest` symlink for convenient access.

## Iron Rules

1. **Explicit invocation only.** The user must name this skill or clearly ask for HTML export. If you arrived without that, stop.
2. **Content before layout.** Identify and structure the source material first; then render. Do not invent findings the source did not contain.
3. **No repo pollution.** The only write without extra permission is the report artifact under `~/.tmp/reports/`.
4. **Chat is not the report.** Do not paste the full HTML or duplicate long sections in chat — see [HTML-TEMPLATE.md §Chat summary](HTML-TEMPLATE.md).

## Workflow

```
- [ ] Step 1: Resolve content source
- [ ] Step 2: Choose layout preset + naming
- [ ] Step 3: Structure sections from source
- [ ] Step 4: Write report.html (see HTML-TEMPLATE.md)
- [ ] Step 5: Open in browser + short chat footer
```

### Step 1 — Resolve content source

Pick **one** primary source. If ambiguous, ask **one** consolidated question.

| User intent | Source | How to load |
|-------------|--------|-------------|
| "把刚才的回答转成 html" | Current session | Last assistant message(s) in this thread, or the message the user @-references |
| "把这段转成 html" + paste | Pasted block | Use pasted text verbatim; preserve headings/lists/code |
| "把某次对话/export 转成 html" | Historical | User-supplied transcript, export file, or agent-transcripts path — read the file |
| Combined with another skill (e.g. cross-review) | That skill's logical output | Render the structured sections that skill defines; base scaffold still from [HTML-TEMPLATE.md](HTML-TEMPLATE.md) |

**Defaults when unspecified:**

- Scope: the most recent substantive assistant answer in the current thread
- Language: match the source (中文 source → 中文 headings in HTML)
- Title: first ~6 words of the main topic, sanitized

### Step 2 — Layout preset + naming

| Preset | When | Sections (minimum) |
|--------|------|-------------------|
| `generic` | Default — summaries, explanations, plans | Header, body sections from source headings, optional appendix |
| `audit-review` | Cross-review / code-review verdicts | Scope, Evidence, Findings, Claims table, Completeness, Verdict, Actions |
| `analysis` | Architecture / design / comparison write-ups | Header, context, findings/cards, comparison table, recommendations |
| `decision-log` | ADR-style or decision records | Context, decision, options considered, consequences |

User may override with a custom section list — honor it.

**Naming** (see [HTML-TEMPLATE.md §Artifact layout](HTML-TEMPLATE.md)):

| Token | Rule |
|-------|------|
| **slug** | User label, else topic/path/branch snippet. Sanitize: `[a-z0-9-]`, max 48, lowercase |
| **report-id** | `YYYYMMDD-HHMMSS-<6hex>` |

```bash
mkdir -p ~/.tmp/reports
SLUG="<slug>"
REPORT_ID="$(date +%Y%m%d-%H%M%S)-$(openssl rand -hex 3 2>/dev/null || echo $RANDOM)"
OUT_DIR="$HOME/.tmp/reports/${SLUG}__${REPORT_ID}"
mkdir -p "$OUT_DIR"
REPORT_PATH="$OUT_DIR/report.html"
ln -sfn "$OUT_DIR" "$HOME/.tmp/reports/${SLUG}-latest"
```

Record `REPORT_PATH`, `SLUG`, `REPORT_ID` for the chat footer.

### Step 3 — Structure sections

Map source markdown → HTML sections:

1. **One H1-equivalent title** in the header hero — not repeated in body
2. **Preserve hierarchy** — `##` → section card, `###` → subsection
3. **Code blocks** → `<pre><code>` with monospace styling; keep language label if present
4. **Tables** → responsive `<table>`; do not drop columns
5. **Lists** → `<ul>`/`<ol>`; keep nesting
6. **Callouts** — blockquotes, warnings, verdicts → tinted card variants (see template)
7. **Diagrams** — if source has mermaid fences or graph-worthy structure, add Mermaid blocks

Do not flatten structured content into one paragraph. Do not add sections the source lacks unless the preset requires empty placeholders labeled "未提供".

### Step 4 — Write HTML

Follow [HTML-TEMPLATE.md](HTML-TEMPLATE.md) for scaffold, CSS classes, card patterns, tables, and optional companion files.

**Required in every report:**

- Self-contained single file (`report.html`)
- Tailwind + Mermaid from CDN
- Header: title, subtitle (slug · report-id · ISO-8601), optional badge/summary line
- All mapped body sections
- Footer with absolute path to this file

**Optional companion** — only when user asks or preset implies it:

| File | When |
|------|------|
| `companion.md` | User wants a markdown mirror alongside HTML |
| `backlog.md` | Action-item backlog (audit FAIL/PARTIAL, or user requests task list export) |

Write companions in the **same** `OUT_DIR`. Never write `.review_backlog.md` or similar into the repo.

### Step 5 — Open + chat footer

```bash
open "$REPORT_PATH"          # macOS
# xdg-open "$REPORT_PATH"    # Linux
```

**Chat reply (short only):**

1. One line: what was exported (source + preset)
2. Absolute path: `Report: ~/.tmp/reports/<slug>__<report-id>/report.html`
3. Companion paths if any
4. Note: `<slug>-latest` symlink points at this run; browser open attempted

Do **not** paste HTML body or repeat the full report in chat.

## Integration with other skills

When another skill defines **what** to report but not **how** to render:

| Skill | Preset | Output dir |
|-------|--------|------------|
| `cross-review-agent-work` | `audit-review` | Prefer `~/.tmp/cross-review/` per that skill's convention; scaffold from this skill's template |
| `improve-codebase-architecture` | `analysis` | `~/.tmp/reports/` |
| Ad-hoc user request | `generic` | `~/.tmp/reports/` |

The audit skill keeps its own output directory and backlog rules; this skill supplies the shared HTML scaffold and rendering workflow.

## Forbidden

- ❌ Auto-invoking when the user only asked a normal question
- ❌ Writing reports into the git working tree
- ❌ Overwriting a prior run (every run gets its own `<slug>__<report-id>/` directory)
- ❌ Dumping full HTML into chat
- ❌ Fabricating content not present in the source

## Reference

- HTML scaffold, styling, section patterns: [HTML-TEMPLATE.md](HTML-TEMPLATE.md)
- Audit preset fields: Scope, Evidence, Findings, Claims table, Completeness, Verdict, Actions
