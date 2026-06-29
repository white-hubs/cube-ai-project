import { existsSync, readFileSync } from "node:fs";

const caches = new Map<string, Map<string, Record<string, unknown>>>();

function buildIndex(apiAllPath: string): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  if (!existsSync(apiAllPath)) {
    console.warn(`[cube-ai] api-all not found: ${apiAllPath}`);
    return map;
  }
  const root = JSON.parse(readFileSync(apiAllPath, "utf8")) as Record<string, unknown>;
  for (const [_category, group] of Object.entries(root)) {
    if (!group || typeof group !== "object" || Array.isArray(group)) {
      continue;
    }
    for (const [name, def] of Object.entries(group as Record<string, unknown>)) {
      if (!def || typeof def !== "object") {
        continue;
      }
      const d = def as Record<string, unknown>;
      if (d["template"] && typeof d["template"] === "object") {
        map.set(name, d);
      }
    }
  }
  return map;
}

/** Langflow 组件 key（如 AIMLModel）→ api-all 中的完整节点定义（与 flow.data.nodes[].data.node 同形） */
export function getLfComponentDef(lfKey: string, apiAllPath: string): Record<string, unknown> | null {
  let idx = caches.get(apiAllPath);
  if (!idx) {
    idx = buildIndex(apiAllPath);
    caches.set(apiAllPath, idx);
  }
  return idx.get(lfKey) ?? null;
}

export function clearLfApiAllCaches(): void {
  caches.clear();
}
