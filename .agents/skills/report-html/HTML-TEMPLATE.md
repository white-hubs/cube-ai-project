# HTML Report Template

Self-contained HTML reports live under `~/.tmp/reports/` (or a sibling skill's directory, e.g. `~/.tmp/cross-review/`). Tailwind and Mermaid load from CDNs. The chat reply stays short; this file defines layout and styling.

Create a unique artifact directory for every run and never write generated reports into the repository.

## Artifact layout

Each run gets its own directory — nothing overwrites a prior report:

```
~/.tmp/reports/
  <slug>__<report-id>/
    report.html          # always
    companion.md         # optional — markdown mirror
    backlog.md           # optional — action backlog
  <slug>-latest -> <slug>__<report-id>/   # symlink (recommended)
```

### Naming inputs

| Token | Rule |
|-------|------|
| **slug** | User label (e.g. `phase-iii-plan`, `auth-review`). Else first ~6 words of topic. Sanitize: `[a-z0-9-]`, max 48, lowercase |
| **report-id** | `YYYYMMDD-HHMMSS` + `-` + 6 hex chars. Example: `20260528-143052-a1b2c3` |

```bash
mkdir -p ~/.tmp/reports
SLUG="phase-iii-plan"
REPORT_ID="$(date +%Y%m%d-%H%M%S)-$(openssl rand -hex 3)"
OUT_DIR="$HOME/.tmp/reports/${SLUG}__${REPORT_ID}"
mkdir -p "$OUT_DIR"
REPORT_PATH="$OUT_DIR/report.html"
ln -sfn "$OUT_DIR" "$HOME/.tmp/reports/${SLUG}-latest"
```

## Scaffold

```html
<!doctype html>
<html lang="{{lang}}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{{title}} — {{slug}}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script type="module">
      import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
      mermaid.initialize({ startOnLoad: true, theme: "neutral", securityLevel: "loose" });
    </script>
    <style>
      /* Verdict / status badges */
      .badge-pass { background: #ecfdf5; border-color: #10b981; color: #065f46; }
      .badge-warn { background: #fffbeb; border-color: #f59e0b; color: #92400e; }
      .badge-fail { background: #fef2f2; border-color: #ef4444; color: #991b1b; }
      .badge-neutral { background: #f8fafc; border-color: #64748b; color: #334155; }
      .badge-info { background: #eff6ff; border-color: #3b82f6; color: #1e40af; }
      /* Progress bars */
      .bar-track { height: 6px; border-radius: 3px; background: #e2e8f0; }
      .bar-fill { height: 100%; border-radius: 3px; background: #6366f1; }
      /* Finding / callout left borders */
      .accent-critical { border-left-color: #ef4444; }
      .accent-major { border-left-color: #f97316; }
      .accent-minor { border-left-color: #eab308; }
      .accent-info { border-left-color: #6366f1; }
      .accent-muted { border-left-color: #94a3b8; }
    </style>
  </head>
  <body class="bg-stone-50 text-slate-900 font-sans antialiased">
    <main class="max-w-5xl mx-auto px-6 py-12 space-y-10">
      <!-- header hero -->
      <!-- body sections -->
      <!-- footer -->
    </main>
  </body>
</html>
```

Set `lang` to `zh-CN` or `en` to match source language.

## Header hero

One block at the top of `<main>`:

```html
<header class="space-y-4 pb-8 border-b border-slate-200">
  <p class="text-sm font-medium text-slate-500 uppercase tracking-wide">Report</p>
  <h1 class="text-3xl font-semibold tracking-tight">{{title}}</h1>
  <p class="text-sm text-slate-600 font-mono">{{slug}} · {{report-id}} · {{ISO-8601}}</p>
  <!-- optional: badge pill, one-line summary, progress bar -->
</header>
```

**Optional header elements** (use when source provides them):

| Element | Markup hint |
|---------|-------------|
| Status badge | `<span class="inline-block px-3 py-1 rounded-full border text-sm font-medium badge-pass">` |
| Score / completeness | Number + `.bar-track` > `.bar-fill` with `style="width: N%"` |
| One-line summary | `<p class="text-lg text-slate-700">` under the title |

## Section cards

Default body unit — one `<section>` per major heading:

```html
<section class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
  <h2 class="text-xl font-semibold">{{section title}}</h2>
  <div class="prose prose-slate max-w-none text-slate-800 space-y-3">
    <!-- paragraphs, lists, subsections -->
  </div>
</section>
```

**Subsections:** `<h3 class="text-lg font-medium mt-4">`

**Blockquote / user quote:**

```html
<blockquote class="border-l-4 border-slate-300 pl-4 italic text-slate-600">
  {{quoted text}}
</blockquote>
```

## Callout cards

For warnings, findings, highlights:

```html
<article class="rounded-lg border border-slate-200 bg-white p-4 border-l-4 accent-major space-y-2">
  <div class="flex items-center gap-2">
    <span class="text-xs font-mono font-semibold uppercase text-slate-500">Major</span>
    <span class="text-sm font-medium">{{one-line title}}</span>
  </div>
  <p class="text-sm text-slate-700">{{detail}}</p>
  <pre class="font-mono text-xs bg-slate-100 rounded p-3 overflow-x-auto">{{evidence snippet}}</pre>
</article>
```

Severity → accent class: Critical/Major → `accent-critical` / `accent-major`; Minor → `accent-minor`; Info → `accent-info`; Pre-existing / muted → `accent-muted`.

## Tables

Full-width, responsive:

```html
<div class="overflow-x-auto">
  <table class="w-full text-sm border-collapse">
    <thead>
      <tr class="border-b border-slate-200 bg-slate-50">
        <th class="text-left p-2 font-medium">Col</th>
      </tr>
    </thead>
    <tbody>
      <tr class="border-b border-slate-100 even:bg-slate-50/50">
        <td class="p-2">…</td>
      </tr>
    </tbody>
  </table>
</div>
```

**Score columns** (audit preset): number + mini bar; color red &lt; 50, amber 50–89, green ≥ 90.

## Code and evidence

```html
<pre class="font-mono text-xs bg-slate-100 rounded-lg p-4 overflow-x-auto"><code>{{content}}</code></pre>
```

Truncate very long lines in evidence blocks; never truncate tables or user-facing prose without marking `…`.

## Mermaid diagrams

When relationships are graph-shaped:

```html
<div class="rounded-lg border border-slate-200 bg-white p-4">
  <pre class="mermaid">
flowchart LR
  A[Before] --> B[After]
  </pre>
</div>
```

Keep diagrams small. Prefer one diagram per idea.

## Preset section maps

### generic

1. Header
2. Sections mirroring source `##` headings
3. Optional appendix (links, references)
4. Footer

### analysis

1. Header + context badge
2. Context / scope
3. Findings (callout cards)
4. Comparison table (if applicable)
5. Recommendations (`<ol>`)
6. Footer

### decision-log

1. Header
2. Context
3. Decision (highlight card)
4. Options considered (table)
5. Consequences (pros/cons columns)
6. Footer

### audit-review

Use this section order: Scope, Evidence, Findings, Claims table, Completeness, Verdict, Actions. Map verdict classes:

| Verdict | Badge class |
|---------|-------------|
| PASS | `badge-pass` |
| PASS-with-issues | `badge-pass` (lighter summary) |
| PARTIAL | `badge-warn` |
| FAIL | `badge-fail` |
| INSUFFICIENT-EVIDENCE | `badge-neutral` |

When the source contains audit smell codes, map `.smell-L` → `accent-major` and `.smell-D`/`.smell-F`/`.smell-R` → `accent-critical`.

## Footer

```html
<footer class="pt-8 border-t border-slate-200 text-xs text-slate-500 font-mono space-y-1">
  <p>Generated by report-html · {{ISO-8601}}</p>
  <p>{{absolute path to report.html}}</p>
</footer>
```

## Style guidance

- Editorial, readable: generous whitespace, `max-w-5xl`, stone/slate palette
- Strong chroma only on badges and callout left borders
- Tables: `text-sm`, optional zebra rows
- Scripts: Tailwind CDN + Mermaid ESM only — no app JS
- Language: match source (中文 → 中文 section headings)

## Opening the report

```bash
open "$REPORT_PATH"          # macOS
# xdg-open "$REPORT_PATH"    # Linux
```

Tell the user the absolute path.

## Chat summary

In chat, output only:

1. What was exported (source + preset, one line)
2. Path: `Report: ~/.tmp/reports/<slug>__<report-id>/report.html`
3. Companion paths if any
4. `<slug>-latest` symlink note; browser open attempted

Do **not** paste the full HTML or duplicate long report sections in chat.

## Companion files

### companion.md (optional)

Markdown mirror of the same sections when the user wants both formats. Header:

```markdown
# {{title}}

> HTML: ~/.tmp/reports/<slug>__<report-id>/report.html
> Generated: {{ISO-8601}}
```

### backlog.md (optional)

When exporting action items (audit FAIL/PARTIAL or explicit user request):

```markdown
# Action Backlog

> Generated by report-html at {{ISO-8601}}.
> Report: ~/.tmp/reports/<slug>__<report-id>/report.html

## Items

### [ ] BL-001 — {{title}}
- Action: …
- Acceptance: …
```
