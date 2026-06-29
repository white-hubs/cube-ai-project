import { describe, expect, test } from "bun:test";

import { defaultArgsForCapability, normalizeInvokeArgs } from "./invoke-args";
import { type CapabilityEntry } from "./types";

const listMessagesCap: CapabilityEntry = {
  apiPath: "sessions",
  domain: "agent",
  face: "client",
  factory: "createAgenticClient",
  id: "agent-sdk-client.sessions.listMessages",
  kind: "json",
  method: "listMessages",
  package: "@cube-ai/agent-sdk-client",
  params: [
    {
      name: "sessionId",
      type: "string",
      required: true,
      position: 0,
      placement: "path",
      description: "19-digit SFID",
    },
    {
      name: "opts",
      type: "json",
      required: false,
      position: 1,
      placement: "query",
      description: "Query options",
    },
  ],
};

describe("invoke-args", () => {
  test("defaultArgsForCapability includes sessionId for listMessages", () => {
    const text = defaultArgsForCapability(listMessagesCap);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed.sessionId).toBe("1000000000000000001");
    expect(parsed.opts).toEqual({ limit: 20 });
  });

  test("normalizeInvokeArgs maps named keys to positional SDK args", () => {
    const args = normalizeInvokeArgs({ opts: { limit: 5 }, sessionId: "1000000000000000003" }, listMessagesCap);
    expect(args).toEqual(["1000000000000000003", { limit: 5 }]);
  });

  test("normalizeInvokeArgs fills defaults when input is empty object", () => {
    const args = normalizeInvokeArgs({}, listMessagesCap);
    expect(args[0]).toBe("1000000000000000001");
    expect(args[1]).toEqual({});
  });

  test("normalizeInvokeArgs supports __positional array", () => {
    const args = normalizeInvokeArgs({ __positional: ["1000000000000000009", { limit: 1 }] }, listMessagesCap);
    expect(args).toEqual(["1000000000000000009", { limit: 1 }]);
  });
});
