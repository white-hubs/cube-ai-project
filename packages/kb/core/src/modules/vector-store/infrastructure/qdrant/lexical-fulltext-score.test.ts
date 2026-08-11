import { describe, expect, test } from "bun:test";

import { LEXICAL_FIELD_WEIGHTS } from "./lexical-field-weights";
import {
  buildFulltextAgainstQuery,
  calculateShortFieldLexicalBonus,
  escapeFulltextBooleanToken,
  LEXICAL_FULLTEXT_FIELDS,
  LEXICAL_SHORT_LIKE_FIELDS,
  maxJsComparableFulltextScore,
  normalizeFulltextScores,
} from "./lexical-fulltext-score";

describe("lexical-fulltext-score (W3.4-H1/H4)", () => {
  test("maxJsComparableFulltextScore is sum of FULLTEXT field exact weights only", () => {
    const expected = LEXICAL_FULLTEXT_FIELDS.reduce((sum, field) => sum + LEXICAL_FIELD_WEIGHTS[field].exact, 0);
    expect(maxJsComparableFulltextScore()).toBe(expected);
    expect(maxJsComparableFulltextScore()).toBe(4 + 3.5 + 3.2 + 2.8 + 2.2);
    for (const field of LEXICAL_SHORT_LIKE_FIELDS) {
      expect(LEXICAL_FULLTEXT_FIELDS.includes(field as (typeof LEXICAL_FULLTEXT_FIELDS)[number])).toBe(false);
    }
  });

  test("normalizeFulltextScores: log1p then min-max to [0, maxJsComparable]", () => {
    const maxJs = 10;
    // raw 0, e-1, e^2-1 → log1p = 0, 1, 2 → scaled 0, 5, 10
    const out = normalizeFulltextScores([0, Math.E - 1, Math.E ** 2 - 1], maxJs);
    expect(out).toHaveLength(3);
    expect(out[0]).toBeCloseTo(0, 10);
    expect(out[1]).toBeCloseTo(5, 10);
    expect(out[2]).toBeCloseTo(10, 10);
  });

  test("normalizeFulltextScores: all-equal positive raw maps to maxJsComparable", () => {
    expect(normalizeFulltextScores([3, 3, 3], 15.7)).toEqual([15.7, 15.7, 15.7]);
  });

  test("normalizeFulltextScores: all-zero raw maps to 0 (short-field-only window)", () => {
    expect(normalizeFulltextScores([0, 0], 15.7)).toEqual([0, 0]);
  });

  test("normalizeFulltextScores: never returns NaN; clamps negative raw", () => {
    const out = normalizeFulltextScores([-5, 1, Number.NaN], 8);
    expect(out.every((value) => Number.isFinite(value))).toBe(true);
    expect(out[0]).toBe(0);
    expect(out[2]).toBe(0);
    expect(out[1]).toBe(8);
  });

  test("buildFulltextAgainstQuery strips boolean specials and de-dupes", () => {
    expect(escapeFulltextBooleanToken("a+b-c")).toBe('"a b c"');
    expect(buildFulltextAgainstQuery("hello", ["hello", "world", "+bad"])).toBe("hello world bad");
    expect(buildFulltextAgainstQuery("foo bar", [])).toBe('"foo bar"');
  });

  test("calculateShortFieldLexicalBonus uses LEXICAL_FIELD_WEIGHTS only", () => {
    const row = {
      end_time: null,
      property_namespace: "ns-hit",
      sheet_name: null,
      start_time: "00:01:00",
      text_content: "should not count",
    };
    const score = calculateShortFieldLexicalBonus(row, "ns-hit", ["00:01"]);
    expect(score).toBe(LEXICAL_FIELD_WEIGHTS.property_namespace.exact + LEXICAL_FIELD_WEIGHTS.start_time.term);
  });
});
