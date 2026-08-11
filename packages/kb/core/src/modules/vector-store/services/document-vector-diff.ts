/**
 * Pure MySQL ⊖ Qdrant point-id diff for document-scoped dual-write reconcile (W3.1-H5).
 * Orchestration (index / delete / job) must reuse this helper — do not copy-paste set math.
 */

export interface DocumentVectorDiff {
  /** Point ids present in MySQL but missing in Qdrant (need upsert). */
  missingInQdrant: string[];
  /** Point ids present in Qdrant but absent from MySQL (orphans — need delete). */
  orphanInQdrant: string[];
  mysqlPointIds: string[];
  qdrantPointIds: string[];
}

export function diffDocumentVectors(mysqlPointIds: Iterable<string>, qdrantPointIds: Iterable<string>): DocumentVectorDiff {
  const mysql = [
    ...new Set(
      Array.from(mysqlPointIds)
        .map(String)
        .filter((id) => id !== ""),
    ),
  ].toSorted();
  const qdrant = [
    ...new Set(
      Array.from(qdrantPointIds)
        .map(String)
        .filter((id) => id !== ""),
    ),
  ].toSorted();
  const mysqlSet = new Set(mysql);
  const qdrantSet = new Set(qdrant);
  return {
    missingInQdrant: mysql.filter((id) => !qdrantSet.has(id)),
    mysqlPointIds: mysql,
    orphanInQdrant: qdrant.filter((id) => !mysqlSet.has(id)),
    qdrantPointIds: qdrant,
  };
}
