import { describe, expect, test } from "bun:test";

import { type CubeFlowGraph } from "../contracts/cube-flow";
import { type LangflowClient } from "./langflow-client";
import {
  cubeMcpServerToLangflowMcpInputValue,
  cubeMcpServerToLfRegistration,
  isLangflowMcpInputServerValue,
  normalizeGraphMcpServersForLangflowPush,
} from "./lf-mcp-server-sync";

describe("lf-mcp-server-sync", () => {
  test("cubeMcpServerToLfRegistration: string name", () => {
    expect(cubeMcpServerToLfRegistration("lf-starter_project")).toEqual({
      lfBody: {},
      lfName: "lf-starter_project",
    });
  });

  test("cubeMcpServerToLfRegistration: legacy name + config", () => {
    expect(
      cubeMcpServerToLfRegistration({
        config: { headers: { a: "b" }, url: "http://h/mcp" },
        name: "my-svc",
      }),
    ).toEqual({
      lfBody: { headers: { a: "b" }, url: "http://h/mcp" },
      lfName: "my-svc",
    });
  });

  test("cubeMcpServerToLfRegistration: name + bizData (flow export shape after config→bizData)", () => {
    expect(
      cubeMcpServerToLfRegistration({
        bizData: { timeout: 5000, url: "http://h/sse" },
        name: "my-svc",
      }),
    ).toEqual({
      lfBody: { timeout: 5000, url: "http://h/sse" },
      lfName: "my-svc",
    });
  });

  test("cubeMcpServerToLfRegistration: cube bucket shape", () => {
    expect(
      cubeMcpServerToLfRegistration({
        bizData: {
          headers: {},
          timeout: 5000,
          url: "http://192.168.0.1/sse/",
        },
      }),
    ).toEqual({
      lfBody: {
        timeout: 5000,
        url: "http://192.168.0.1/sse/",
      },
      lfName: "bizData",
    });
  });

  test("cubeMcpServerToLfRegistration: service-first bucket (mcpPayloadFromService)", () => {
    expect(
      cubeMcpServerToLfRegistration({
        AlarmSvc: {
          headers: { Authorization: "Bearer t" },
          url: "http://x/sse",
        },
      }),
    ).toEqual({
      lfBody: {
        headers: { Authorization: "Bearer t" },
        url: "http://x/sse",
      },
      lfName: "AlarmSvc",
    });
  });

  test("cubeMcpServerToLfRegistration: empty", () => {
    expect(cubeMcpServerToLfRegistration(null)).toBeNull();
    expect(cubeMcpServerToLfRegistration({})).toBeNull();
  });

  test("cubeMcpServerToLfRegistration: endpoint maps to url in lfBody", () => {
    expect(
      cubeMcpServerToLfRegistration({
        Svc: { endpoint: "http://host/sse" },
      }),
    ).toEqual({
      lfBody: { url: "http://host/sse" },
      lfName: "Svc",
    });
  });

  test("cubeMcpServerToLangflowMcpInputValue: bizData bucket → name + config", () => {
    expect(
      cubeMcpServerToLangflowMcpInputValue(
        {
          bizData: {
            headers: {},
            sse_read_timeout: 50,
            timeout: 50,
            url: "http://192.168.0.194:8002/sse/",
          },
        },
        true,
      ),
    ).toEqual({
      config: {
        sse_read_timeout: 50,
        timeout: 50,
        url: "http://192.168.0.194:8002/sse/",
        verify_ssl: true,
      },
      name: "bizData",
    });
  });

  test("isLangflowMcpInputServerValue", () => {
    expect(isLangflowMcpInputServerValue({ config: { url: "http://x" }, name: "bizData" })).toBe(true);
    expect(isLangflowMcpInputServerValue({ name: "bizData" })).toBe(true);
    expect(isLangflowMcpInputServerValue({ bizData: { url: "http://x" } })).toBe(false);
  });

  test("normalizeGraphMcpServersForLangflowPush keeps name+config on clone for LF PATCH", async () => {
    const lf = {
      addMcpV2Server: async () => {},
    } as unknown as LangflowClient;
    const graph: CubeFlowGraph = {
      edges: [],
      nodes: [
        {
          id: "cell-1",
          lfNodeId: "MCPTools-1",
          cubeType: "cube.lf.MCPTools",
          x: 0,
          y: 0,
          width: 320,
          height: 400,
          config: {
            mcp_server: { bizData: { url: "http://192.168.0.1/sse/", timeout: 50 } },
            verify_ssl: true,
          },
        },
      ],
      schemaVersion: 1,
    };
    const out = await normalizeGraphMcpServersForLangflowPush(lf, graph);
    const ms = out.nodes[0]!.config["mcp_server"] as Record<string, unknown>;
    expect(ms["name"]).toBe("bizData");
    expect(ms["config"]).toEqual({
      timeout: 50,
      url: "http://192.168.0.1/sse/",
      verify_ssl: true,
    });
  });
});
