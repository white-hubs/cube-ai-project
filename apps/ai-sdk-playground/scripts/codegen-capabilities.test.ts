import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { generateCapabilitiesManifest } from "./codegen-capabilities";

const REPO_ROOT = join(import.meta.dir, "../../..");

describe("codegen-capabilities", () => {
  test("generates entries for agent-sdk-client sessions.list and llm-sdk-console listProviders", () => {
    const manifest = generateCapabilitiesManifest(REPO_ROOT);
    const ids = manifest.entries.map((e) => e.id);
    expect(ids).toContain("agent-sdk-client.sessions.list");
    expect(ids).toContain("llm-sdk-console.listProviders");
    expect(ids).toContain("flow-sdk-client.runFlowStream");
    expect(ids).toContain("kb-sdk-console.uploadDocument");
  });

  test("merges manual composable and mock entries", () => {
    const manifest = generateCapabilitiesManifest(REPO_ROOT);
    const ids = manifest.entries.map((e) => e.id);
    expect(ids).toContain("agent-sdk-client-vue.provideAssistant");
    expect(ids).toContain("agent-sdk-client-mock.startMockEngine");
  });

  test("covers all HTTP client packages with at least one method each", () => {
    const manifest = generateCapabilitiesManifest(REPO_ROOT);
    const packages = new Set(manifest.entries.map((e) => e.package));
    expect(packages.has("@cube-ai/agent-sdk-client")).toBe(true);
    expect(packages.has("@cube-ai/agent-sdk-console")).toBe(true);
    expect(packages.has("@cube-ai/flow-sdk-client")).toBe(true);
    expect(packages.has("@cube-ai/flow-sdk-console")).toBe(true);
    expect(packages.has("@cube-ai/kb-sdk-client")).toBe(true);
    expect(packages.has("@cube-ai/kb-sdk-console")).toBe(true);
    expect(packages.has("@cube-ai/llm-sdk-console")).toBe(true);
  });

  test("extracts sessionId and opts for sessions.listMessages", () => {
    const manifest = generateCapabilitiesManifest(REPO_ROOT);
    const entry = manifest.entries.find((e) => e.id === "agent-sdk-client.sessions.listMessages");
    expect(entry).toBeDefined();
    expect(entry?.params.map((p) => p.name)).toEqual(["sessionId", "opts"]);
    expect(entry?.params[0]?.placement).toBe("path");
    expect(entry?.params[1]?.placement).toBe("query");
  });
});
