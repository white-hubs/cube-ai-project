import { describe, expect, test } from "bun:test";

import { resolveAllowedGroupIds } from "./resolve-allowed-group-ids";

describe("W4.1-H5 resolveAllowedGroupIds", () => {
  test("returns empty for null/undefined identity", () => {
    expect(resolveAllowedGroupIds(null)).toEqual([]);
    expect(resolveAllowedGroupIds(undefined)).toEqual([]);
    expect(resolveAllowedGroupIds({})).toEqual([]);
  });

  test("prefers explicit server-injected groupIds over userToken", () => {
    expect(
      resolveAllowedGroupIds({
        groupIds: [" g1 ", "g2", "g1"],
        userToken: JSON.stringify({ groupIds: ["token-only"] }),
      }),
    ).toEqual(["g1", "g2"]);
  });

  test("never treats opaque or JSON-shaped userToken as verified group claims", () => {
    expect(resolveAllowedGroupIds({ userToken: JSON.stringify({ groupIds: ["a", "b"] }) })).toEqual([]);
    expect(resolveAllowedGroupIds({ userToken: JSON.stringify({ groups: ["x"] }) })).toEqual([]);
    expect(resolveAllowedGroupIds({ userToken: JSON.stringify({ aclGroupIds: ["z"] }) })).toEqual([]);
    expect(resolveAllowedGroupIds({ userToken: "eyJhbGciOiJIUzI1NiJ9.payload.sig" })).toEqual([]);
    expect(resolveAllowedGroupIds({ userToken: "not-json" })).toEqual([]);
  });
});
