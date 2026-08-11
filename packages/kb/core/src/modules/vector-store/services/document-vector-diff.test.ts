import { describe, expect, test } from "bun:test";

import { diffDocumentVectors } from "./document-vector-diff";

describe("diffDocumentVectors", () => {
  test("computes missing and orphan sets without duplicates", () => {
    const diff = diffDocumentVectors(["a", "b", "a"], ["b", "c", "c"]);
    expect(diff.mysqlPointIds).toEqual(["a", "b"]);
    expect(diff.qdrantPointIds).toEqual(["b", "c"]);
    expect(diff.missingInQdrant).toEqual(["a"]);
    expect(diff.orphanInQdrant).toEqual(["c"]);
  });

  test("soft-deleted / empty MySQL yields all Qdrant ids as orphans", () => {
    const diff = diffDocumentVectors([], ["p1", "p2"]);
    expect(diff.missingInQdrant).toEqual([]);
    expect(diff.orphanInQdrant).toEqual(["p1", "p2"]);
  });
});
