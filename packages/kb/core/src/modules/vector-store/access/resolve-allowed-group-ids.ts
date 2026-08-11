/**
 * W4.1 — sole identity → ACL group ids seam.
 * Retrieval / Qdrant / MySQL filter builders consume resolved ids only;
 * swap platform identity sources by changing this function (or its caller wiring).
 */

export type KbAclIdentity = {
  /**
   * Server-injected group ids from host auth / ALS.
   * Never accept these from client search `filters`.
   */
  groupIds?: readonly string[];
  /**
   * Opaque token from KnowledgeQueryRequest.userToken (or equivalent). It is
   * deliberately ignored here: only the host identity adapter may verify and
   * project group claims into `groupIds`.
   */
  userToken?: string;
};

function normalizeGroupIds(raw: readonly unknown[] | undefined): string[] {
  if (!raw || raw.length === 0) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string" && typeof item !== "number") {
      continue;
    }
    const id = String(item).trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Map platform identity → allowed ACL group ids for dual-leg retrieval filters.
 * Returns `[]` when no groups are known (ACL-tagged docs denied; legacy empty ACL still visible).
 */
export function resolveAllowedGroupIds(identity: KbAclIdentity | null | undefined): string[] {
  if (!identity) {
    return [];
  }
  const fromExplicit = normalizeGroupIds(identity.groupIds);
  if (fromExplicit.length > 0) {
    return fromExplicit;
  }
  return [];
}
