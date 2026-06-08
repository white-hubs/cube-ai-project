/**
 * Build Cube component catalog from Langflow **GET /api/v1/all** (default) or a local api-all-shaped JSON.
 *
 * Output `generated/cube-component-catalog.json` is used by:
 * - GET /components/（对外经网关常为 `/api/components/`）
 * - ComponentSchemaService → GET /components/schema（单条）、GET /components/schema/all（目录全量）
 *
 * Per-node **fieldUi** (`fieldEnabled`, `fieldAdvanced`, `nodeToolMode`) lives on the flow graph and
 * round-trips via graph-translator with LF template `show` / `advanced` / `data.node.tool_mode` — **not**
 * part of this catalog.
 *
 * Default source uses the same env as cube-ai server: `LANGFLOW_BASE_URL`, optional `LANGFLOW_API_KEY` /
 * `LANGFLOW_BEARER_TOKEN`.
 *
 * Usage:
 *   LANGFLOW_BASE_URL=http://127.0.0.1:7860 LANGFLOW_API_KEY=... bun run scripts/sync-langflow-components.ts
 *   bun run scripts/sync-langflow-components.ts --from-file mock-langflow/api-all.json --out generated/cube-component-catalog.json
 *   bun run scripts/sync-langflow-components.ts --limit 80
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { langflowConfigFromEnv } from '../src/langflow/langflow-client'

const root = join(import.meta.dir, '..')

function arg(name: string, def: string): string {
  const i = Bun.argv.indexOf(name)
  if (i === -1 || !Bun.argv[i + 1]) return def
  return Bun.argv[i + 1]!
}

function optionalArg(name: string): string | undefined {
  const i = Bun.argv.indexOf(name)
  if (i === -1 || !Bun.argv[i + 1]) return undefined
  return Bun.argv[i + 1]
}

const fromFile = optionalArg('--from-file')
const outFile = arg('--out', join(root, 'generated/cube-component-catalog.json'))
const limit = Number(arg('--limit', '0'))

async function loadApiAllDocument(): Promise<{ raw: Record<string, unknown>; source: string }> {
  if (fromFile) {
    const inputPath = fromFile.startsWith('/') ? fromFile : join(root, fromFile)
    const raw = (await Bun.file(inputPath).json()) as Record<string, unknown>
    return { raw, source: inputPath }
  }

  const cfg = langflowConfigFromEnv()
  if (!cfg) {
    throw new Error(
      'LANGFLOW_BASE_URL is not set. Export it (and LANGFLOW_API_KEY if your instance requires auth), or pass --from-file <path>.',
    )
  }

  const url = `${cfg.baseUrl.replace(/\/$/, '')}/api/v1/all`
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (cfg.bearerToken) headers['Authorization'] = `Bearer ${cfg.bearerToken}`
  else if (cfg.apiKey) headers['x-api-key'] = cfg.apiKey

  const res = await fetch(url, { headers })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`GET ${url} failed: ${res.status} ${text.slice(0, 500)}`)
  }
  const trimmed = text.trim()
  const ct = (res.headers.get('content-type') ?? '').toLowerCase()
  if (ct.includes('text/html') || trimmed.startsWith('<!')) {
    throw new Error(
      `GET ${url} returned HTML, not JSON — LANGFLOW_BASE_URL may point at the web UI. Use the Langflow API base (same host as GET /api/v1/flows/... on Langflow).`,
    )
  }
  const raw = JSON.parse(text) as Record<string, unknown>
  return { raw, source: url }
}

type CatalogEntry = {
  cubeType: string
  lfComponentKey: string
  category: string
  displayName: string
  outputNames: string[]
}

async function main() {
  const { raw, source: sourceLabel } = await loadApiAllDocument()
  const entries: CatalogEntry[] = []

  for (const [category, group] of Object.entries(raw)) {
    if (!group || typeof group !== 'object' || Array.isArray(group)) continue
    for (const [name, def] of Object.entries(group as Record<string, unknown>)) {
      if (!def || typeof def !== 'object') continue
      const d = def as Record<string, unknown>
      if (!d['template']) continue
      const outputs = Array.isArray(d['outputs'])
        ? (d['outputs'] as { name?: string }[]).map((o) => o.name).filter(Boolean)
        : []
      entries.push({
        cubeType: `cube.lf.${name}`,
        lfComponentKey: name,
        category,
        displayName: String(d['display_name'] ?? name),
        outputNames: outputs as string[],
      })
      if (limit > 0 && entries.length >= limit) break
    }
    if (limit > 0 && entries.length >= limit) break
  }

  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: sourceLabel,
    components: entries,
  }

  const outPath = outFile.startsWith('/') ? outFile : join(root, outFile)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf-8')
  console.log(`Wrote ${entries.length} components to ${outPath}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
