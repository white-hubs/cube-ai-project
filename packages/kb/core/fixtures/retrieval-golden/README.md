# Retrieval golden fixtures (W1.4)

CI-facing synthetic / desensitized cases for the offline retrieval eval gate.

## Files

| File | Purpose |
| --- | --- |
| `cases.v1.json` | Committed golden set (`version` + `cases[]`) |

Live cases with real document IDs stay **out of git**:

```text
.tmp/kb-eval/cases.live.v1.json
```

Enable with `KB_GOLDEN_LIVE=1`. Missing live file → skip (no CI failure).

## Case fields

```json
{
  "id": "clause-normative-refs",
  "query": "…",
  "profileHint": "semantic | entity | navigation | table | timeline",
  "relevant": [
    { "documentId": "doc-a", "chunkId": "chunk-1", "grade": 2 }
  ],
  "k": [1, 3, 5]
}
```

- `grade > 0` counts as relevant; higher grades weight nDCG more.
- Match key is `(documentId, chunkId)`.
- Bump `version` when the schema semantics change; additive cases may keep `version: 1`.

## Metrics

Computed in `src/modules/vector-store/eval/metrics.ts` (no `RetrievalService` dependency):

- `hit_rate@k`
- `MRR`
- `nDCG@k`

Machine-readable reports write to `.tmp/kb-eval/` (gitignored).

## Profiles covered (v1)

`semantic` / `entity` / `navigation` / `table` — at least three PDF-like clause scenarios (synthetic).
