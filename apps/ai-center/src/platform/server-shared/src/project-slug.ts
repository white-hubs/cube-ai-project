/**
 * Tenant-facing `projects.project_id` (slug): lowercase [a-z0-9_-], max 64 chars.
 */
export function slugifyTenantProjectId(name: string): string {
  const raw = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return raw || 'project'
}

/** Append numeric suffix without exceeding maxLen (default 64). */
export function tenantSlugWithSuffix(base: string, n: number, maxLen = 64): string {
  const suf = `-${n}`
  if (base.length + suf.length <= maxLen) return `${base}${suf}`
  const cut = base.slice(0, Math.max(1, maxLen - suf.length))
  return `${cut}${suf}`
}
