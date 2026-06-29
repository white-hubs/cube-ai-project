import { describe, expect, it } from "bun:test";

import { DescriptorListingViewSchema, ListDescriptorRequestSchema } from "./index";

describe("descriptor listing schemas", () => {
  it("requires listing a positive published version", () => {
    expect(ListDescriptorRequestSchema.parse({ versionNo: 1 })).toEqual({ versionNo: 1 });
    expect(ListDescriptorRequestSchema.safeParse({ versionNo: 0 }).success).toBe(false);
    expect(ListDescriptorRequestSchema.safeParse({ versionNo: -1 }).success).toBe(false);
  });

  it("projects listing state and shared version pointer", () => {
    const parsed = DescriptorListingViewSchema.parse({
      descriptorId: "agt_123",
      listed: true,
      listedTime: 1710000000000,
      publisherUserId: "author-1",
      sharedVersionNo: 2,
      unlistedTime: null,
    });

    expect(parsed.sharedVersionNo).toBe(2);
    expect(parsed.unlistedTime).toBeNull();
  });
});
