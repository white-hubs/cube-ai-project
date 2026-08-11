import { describe, expect, test } from "bun:test";

import { parseSearchMetadataFilters } from "./search-filters";

describe("parseSearchMetadataFilters", () => {
  test("parses createdAt/docType/lang/tags AND filters", () => {
    expect(
      parseSearchMetadataFilters({
        createdAtFrom: "2026-01-01T08:00:00+08:00",
        createdAtTo: "2026-12-31T23:59:59.999Z",
        docType: "standard",
        lang: "zh",
        tags: ["消防"],
      }),
    ).toEqual({
      createdAtFrom: "2026-01-01T00:00:00.000Z",
      createdAtTo: "2026-12-31T23:59:59.999Z",
      docType: "standard",
      lang: "zh",
      tags: ["消防"],
    });
  });

  test("rejects invalid ranges and unknown fields instead of silently dropping them", () => {
    expect(() => parseSearchMetadataFilters({ createdAtFrom: "not-a-date" })).toThrow(/ISO-8601/);
    expect(() =>
      parseSearchMetadataFilters({
        createdAtFrom: "2026-02-01T00:00:00.000Z",
        createdAtTo: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow(/earlier/);
    expect(() => parseSearchMetadataFilters({ customField: "silently ignored before" })).toThrow(/unsupported/);
  });

  test("rejects client-supplied ACL group fields", () => {
    expect(() => parseSearchMetadataFilters({ allowedGroupIds: ["g1"] })).toThrow(/server-injected/);
    expect(() => parseSearchMetadataFilters({ aclGroupIds: ["g1"] })).toThrow(/server-injected/);
    expect(() => parseSearchMetadataFilters({ groupIds: ["g1"] })).toThrow(/server-injected/);
  });
});
