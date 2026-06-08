/**
 * 生成图对外 URL 路径前缀（与 {@link GeneratedMediaController} 挂载路径一致）。
 * 默认 `/agentic/media`；可通过 `AGENTIC_GENERATED_MEDIA_PATH_PREFIX` 覆盖。
 */
export function normalizeGeneratedMediaPathPrefix(raw?: string | null): string {
  const fallback = '/agentic/media';
  const s = (raw ?? fallback).trim();
  if (!s) return fallback;
  let p = s.startsWith('/') ? s : `/${s}`;
  p = p.replace(/\/+$/, '');
  return p || fallback;
}
