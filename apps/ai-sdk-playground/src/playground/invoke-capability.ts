import { createAgenticClient } from "@cube-ai/agent-sdk-client";
import { createAgentConsoleClient } from "@cube-ai/agent-sdk-console";
import { createFlowClient } from "@cube-ai/flow-sdk-client";
import { createFlowConsoleClient } from "@cube-ai/flow-sdk-console";
import { createKbClient } from "@cube-ai/kb-sdk-client";
import { createKbConsoleClient } from "@cube-ai/kb-sdk-console";
import { createLlmConsoleClient } from "@cube-ai/llm-sdk-console";

import { buildSdkClientConfig } from "./connection-profile";
import { normalizeInvokeArgs } from "./invoke-args";
import { type CapabilityEntry, type ConnectionProfile, type InvokeResult } from "./types";

interface FetchOverride {
  fetchImpl?: typeof fetch;
}

function parseAuthHeader(headers: Record<string, string>): {
  provider: () => string;
  headersProvider?: () => Record<string, string>;
} {
  const auth = headers.authorization ?? "";
  const token = auth.replace(/^Bearer\s+/iu, "");
  const { authorization: _auth, ...rest } = headers;
  return {
    headersProvider: () => rest,
    provider: () => token,
  };
}

export function createClientForCapability(cap: CapabilityEntry, profile: ConnectionProfile, overrides?: FetchOverride): unknown {
  const sdkCfg = buildSdkClientConfig(profile, cap.domain, cap.face as "client" | "console");
  const headersFn = sdkCfg.headers;
  const fetchImpl = overrides?.fetchImpl;

  switch (cap.factory) {
    case "createAgenticClient": {
      const auth = parseAuthHeader(profile.headers);
      return createAgenticClient({
        auth,
        baseUrl: sdkCfg.baseUrl,
        fetchImpl,
        headersProvider: auth.headersProvider,
      });
    }
    case "createAgentConsoleClient": {
      return createAgentConsoleClient({
        baseUrl: sdkCfg.baseUrl,
        pathPrefix: sdkCfg.pathPrefix,
        headers: headersFn,
        fetchImpl,
      });
    }
    case "createFlowClient": {
      return createFlowClient({
        baseUrl: sdkCfg.baseUrl,
        pathPrefix: sdkCfg.pathPrefix,
        headers: headersFn,
        fetchImpl,
      });
    }
    case "createFlowConsoleClient": {
      return createFlowConsoleClient({
        baseUrl: sdkCfg.baseUrl,
        pathPrefix: sdkCfg.pathPrefix,
        headers: headersFn,
        fetchImpl,
      });
    }
    case "createKbClient": {
      return createKbClient({
        baseUrl: sdkCfg.baseUrl,
        pathPrefix: sdkCfg.pathPrefix,
        headers: headersFn,
        fetchImpl,
      });
    }
    case "createKbConsoleClient": {
      return createKbConsoleClient({
        baseUrl: sdkCfg.baseUrl,
        pathPrefix: sdkCfg.pathPrefix,
        headers: headersFn,
        fetchImpl,
      });
    }
    case "createLlmConsoleClient": {
      return createLlmConsoleClient({
        baseUrl: sdkCfg.baseUrl,
        pathPrefix: sdkCfg.pathPrefix,
        headers: headersFn,
        fetchImpl,
      });
    }
    default: {
      throw new Error(`Unsupported factory: ${cap.factory}`);
    }
  }
}

function resolveCallTarget(client: unknown, cap: CapabilityEntry): unknown {
  if (cap.apiPath) {
    const api = (client as Record<string, unknown>)[cap.apiPath];
    if (api === null || api === undefined) {
      throw new Error(`API path not found: ${cap.apiPath}`);
    }
    return api;
  }
  return client;
}

function resolveMethod(client: unknown, cap: CapabilityEntry): (...args: unknown[]) => unknown {
  const target = resolveCallTarget(client, cap);
  const fn = (target as Record<string, unknown>)[cap.method];
  if (typeof fn !== "function") {
    throw new TypeError(`Method not found: ${cap.method}`);
  }
  return fn as (...args: unknown[]) => unknown;
}

function normalizeArgs(raw: unknown, cap: CapabilityEntry): unknown[] {
  return normalizeInvokeArgs(raw, cap);
}

async function collectSseEvents(
  iterable: AsyncIterable<{ event?: string; data?: unknown }>,
  maxEvents = 200,
): Promise<{ event: string; data: unknown }[]> {
  const events: { event: string; data: unknown }[] = [];
  for await (const item of iterable) {
    events.push({ data: item.data ?? item, event: item.event ?? "message" });
    if (events.length >= maxEvents) {
      break;
    }
  }
  return events;
}

export async function invokeCapability(
  cap: CapabilityEntry,
  profile: ConnectionProfile,
  args: unknown,
  overrides?: FetchOverride,
): Promise<InvokeResult> {
  if (cap.kind === "composable" || cap.kind === "mock") {
    return {
      error: "Use dedicated panel for composable/mock capabilities",
      kind: cap.kind,
      ok: false,
    };
  }

  try {
    const client = createClientForCapability(cap, profile, overrides);
    const target = resolveCallTarget(client, cap);
    const fn = resolveMethod(client, cap);
    const callArgs = normalizeArgs(args, cap);

    if (cap.kind === "sse" && cap.method === "propose") {
      const deltas: string[] = [];
      const [kind, req] = callArgs.length >= 2 ? callArgs : ["agent", { prompt: "hello" }];
      const result = await (fn as (...a: unknown[]) => Promise<unknown>).call(target, kind, req, {
        onDelta: (d: string) => deltas.push(d),
      });
      return {
        data: result,
        kind: cap.kind,
        ok: true,
        sseEvents: deltas.map((d) => ({ event: "delta", data: d })),
      };
    }

    if (cap.kind === "sse" && cap.method === "streamEvents") {
      const events = await collectSseEvents(fn.call(target, ...callArgs) as AsyncIterable<{ event?: string; data?: unknown }>);
      return { kind: cap.kind, ok: true, sseEvents: events };
    }

    if (cap.kind === "sse" && cap.method === "runFlowStream") {
      const response = (await fn.apply(target, callArgs)) as Response;
      const text = await response.text();
      return {
        data: { body: text, status: response.status },
        error: response.ok ? undefined : `HTTP ${response.status}`,
        kind: cap.kind,
        ok: response.ok,
      };
    }

    const data = await fn.apply(target, callArgs);
    return { data, kind: cap.kind, ok: true };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : String(e),
      kind: cap.kind,
      ok: false,
    };
  }
}
